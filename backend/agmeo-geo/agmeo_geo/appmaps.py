"""Satellite base zonings of application maps (``zoning_jobs``), computed from field rasters.

Ported from the reference's satellite source of ``previewBaseZonation``: the API queues a job
with a vegetation index, one to five acquisition dates and a zone count; this worker reads the
index of each date on the field's current boundary, takes the pixel-wise median of several
scenes, classifies it into zones (``zonation.py``) and stores a ``zonings`` row with source
'satellite'. Zone 1 has the lowest index. Each zone's relative yield is the reference's
synthetic spread: 0.8 for the weakest to 1.2 for the strongest zone by index mean, normalised
to an area-weighted mean of 100 %.
"""

from __future__ import annotations

import json
import logging

import numpy as np
import psycopg
import shapely
from pyproj import Transformer
from shapely.geometry import mapping

from .config import Settings
from .fieldgrid import field_grid, read_layer
from .pipeline import connect
from .zonation import ZonationParams, zonate

log = logging.getLogger("agmeo_geo.appmaps")

SYNTHETIC_SPREAD = (0.8, 1.2)


class JobFailed(Exception):
    def __init__(self, code: str, error: str | None = None):
        super().__init__(code)
        self.code = code
        self.error = error


def synthetic_relative(means: list[float | None], ranks: list[int]) -> list[float]:
    """Relative yields 0.8–1.2 by metric, or by rank when a metric is missing or all are equal.

    Port of the reference's ``computeRelativeYields`` ("direct" direction).
    """
    n = len(means)
    if n == 0:
        return []
    if n == 1:
        return [1.0]
    lo, hi = SYNTHETIC_SPREAD
    finite = [m for m in means if m is not None and np.isfinite(m)]
    if len(finite) == n and max(finite) - min(finite) > 0:
        mn, mx = min(finite), max(finite)
        return [lo + (m - mn) / (mx - mn) * (hi - lo) for m in finite]
    rmin, rmax = min(ranks), max(ranks)
    return [lo + ((r - rmin) / (rmax - rmin) if rmax > rmin else 0.0) * (hi - lo) for r in ranks]


def normalised_pct(relative: list[float], areas: list[float]) -> list[float]:
    """Relative yields as % with an area-weighted mean of 100."""
    total = sum(areas)
    mean = sum(r * a for r, a in zip(relative, areas)) / total if total > 0 else 1.0
    mean = mean if mean > 0 else 1.0
    return [round(r / mean * 100, 2) for r in relative]


def median_stack(layers: list[np.ndarray]) -> np.ndarray:
    """Pixel-wise median of the scenes; a pixel no scene covers stays NaN."""
    if len(layers) == 1:
        return layers[0]
    stack = np.stack(layers)
    out = np.full(stack.shape[1:], np.nan, dtype=np.float64)
    covered = np.isfinite(stack).any(axis=0)
    out[covered] = np.nanmedian(stack[:, covered], axis=0)
    return out


def claim(conn: psycopg.Connection):
    row = conn.execute(
        """
        SELECT j.id, j.organization_id, j.field_id, j.index_type, j.scene_dates, j.zone_count, j.params, j.name,
               j.created_by, g.id AS geometry_version_id, ST_AsGeoJSON(g.geometry) AS geometry
        FROM zoning_jobs j
        JOIN field_current_geometry g ON g.field_id = j.field_id
        WHERE j.status = 'queued'
        ORDER BY j.created_at
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
        """
    ).fetchone()
    if row:
        conn.execute("UPDATE zoning_jobs SET status = 'running' WHERE id = %s", (row["id"],))
    conn.commit()
    return row


def scene_layers(conn: psycopg.Connection, settings: Settings, row) -> list[np.ndarray]:
    layers = []
    for day in row["scene_dates"]:
        raster = conn.execute(
            """
            SELECT path FROM field_rasters
            WHERE geometry_version_id = %s AND %s = ANY(bands) AND observed_on = %s
            ORDER BY valid_pixel_pct DESC LIMIT 1
            """,
            (row["geometry_version_id"], row["index_type"], day),
        ).fetchone()
        if not raster:
            raise JobFailed("no_imagery", f"no {row['index_type']} raster on {day}")
        layers.append(read_layer(settings.data_dir / raster["path"], row["index_type"]))
    return layers


def compute(conn: psycopg.Connection, settings: Settings, row) -> str:
    """Classifies the job's scenes and writes the zoning; returns its id."""
    grid = field_grid(json.loads(row["geometry"]))
    layers = scene_layers(conn, settings, row)
    if any(layer.shape != grid.shape for layer in layers):
        raise JobFailed("grid_mismatch")
    values = median_stack(layers)
    params = row["params"] or {}
    try:
        zones = zonate(
            values,
            grid,
            ZonationParams(
                method=params.get("method") or "fcm",
                zone_count=int(row["zone_count"]),
                min_zone_ha=float(params.get("minZoneHa") or 0.25),
                coarseness=float(params["coarseness"]) if params.get("coarseness") is not None else 0.35,
                cleanup=params.get("cleanup") or "merge",
            ),
        )
    except ValueError as exc:
        raise JobFailed("no_values", str(exc)) from exc
    if not zones:
        raise JobFailed("no_zones")

    relative = synthetic_relative([z.mean_value for z in zones], [z.number for z in zones])
    pct = normalised_pct(relative, [z.area_ha for z in zones])
    to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
    dates = [d.isoformat() if hasattr(d, "isoformat") else str(d) for d in row["scene_dates"]]
    zoning = conn.execute(
        """
        INSERT INTO zonings (organization_id, field_id, geometry_version_id, source, zone_count, name, params, created_by)
        VALUES (%s, %s, %s, 'satellite', %s, %s, %s, %s)
        RETURNING id
        """,
        (
            row["organization_id"],
            row["field_id"],
            row["geometry_version_id"],
            len(zones),
            row["name"],
            json.dumps({"index": row["index_type"], "sceneDates": dates, "method": params.get("method") or "fcm", "jobId": str(row["id"])}),
            row["created_by"],
        ),
    ).fetchone()["id"]
    for zone, rel in zip(zones, pct):
        wgs84 = shapely.transform(zone.geometry, to_wgs84.transform, interleaved=False)
        conn.execute(
            """
            INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity)
            SELECT %(org)s, %(zoning)s, %(no)s, g, round((ST_Area(g::geography) / 10000)::numeric, 4), %(rel)s
            FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)), 3)) AS g) s
            """,
            {"org": row["organization_id"], "zoning": zoning, "no": zone.number, "geom": json.dumps(mapping(wgs84)), "rel": rel},
        )
    conn.execute(
        "UPDATE zoning_jobs SET status = 'ready', status_code = 'ok', zoning_id = %s, finished_at = now() WHERE id = %s",
        (zoning, row["id"]),
    )
    log.info("Satellite zoning %s: %d zones (%s, %d scenes)", zoning, len(zones), row["index_type"], len(dates))
    return str(zoning)


def run_queued(settings: Settings) -> int:
    handled = 0
    with connect(settings) as conn:
        while row := claim(conn):
            try:
                compute(conn, settings, row)
                conn.commit()
            except JobFailed as exc:
                conn.rollback()
                conn.execute(
                    "UPDATE zoning_jobs SET status = 'failed', status_code = %s, error = %s, finished_at = now() WHERE id = %s",
                    (exc.code, exc.error, row["id"]),
                )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                log.exception("Zoning job %s failed", row["id"])
                conn.execute(
                    "UPDATE zoning_jobs SET status = 'failed', status_code = 'error', error = %s, finished_at = now() WHERE id = %s",
                    (str(exc)[:500], row["id"]),
                )
                conn.commit()
            handled += 1
    return handled
