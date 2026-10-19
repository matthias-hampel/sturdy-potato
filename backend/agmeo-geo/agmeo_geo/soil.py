"""Queued soil zonations (``soil_zonations`` with status 'queued'), computed from field rasters.

The API queues one row per field of a batch; this worker picks them up, reads the chosen
layer on the field's current boundary and writes the zones (see ``zonation.py``). A finished
zonation replaces the field's active one in the same transaction, so the soil planner never
sees a field without zones while a new run is computed.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta

import numpy as np
import psycopg
import shapely
from pyproj import Transformer
from shapely.geometry import mapping

from .config import Settings
from .fieldgrid import field_grid, read_layer
from .pipeline import connect
from .zonation import ZonationParams, zonate

log = logging.getLogger("agmeo_geo.soil")

INDEX_SOURCES = ("ndvi", "ndre", "ndmi")
SCENE_LOOKBACK_DAYS = 365
MIN_CLEAR_PCT = 90.0
ZONE_COLORS = (
    "#22c55e",
    "#3b82f6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#ec4899",
    "#84cc16",
    "#6366f1",
    "#f97316",
    "#14b8a6",
    "#a855f7",
    "#eab308",
    "#0ea5e9",
    "#f43f5e",
)


class SourceUnavailable(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def claim(conn: psycopg.Connection):
    row = conn.execute(
        """
        SELECT z.id, z.organization_id, z.field_id, z.source, z.method, z.params,
               g.id AS geometry_version_id, ST_AsGeoJSON(g.geometry) AS geometry
        FROM soil_zonations z
        JOIN field_current_geometry g ON g.field_id = z.field_id
        WHERE z.status = 'queued'
        ORDER BY z.created_at
        LIMIT 1
        FOR UPDATE OF z SKIP LOCKED
        """
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE soil_zonations SET status = 'running', geometry_version_id = %s WHERE id = %s",
            (row["geometry_version_id"], row["id"]),
        )
    conn.commit()
    return row


def source_layer(conn: psycopg.Connection, settings: Settings, row) -> tuple[np.ndarray, date | None]:
    """The raster the zones are cut from, on the field grid, and the acquisition date if any."""
    params = row["params"] or {}
    if row["source"] == "productivity":
        analysis = conn.execute(
            """
            SELECT raster_path FROM productivity_analyses
            WHERE geometry_version_id = %s AND status = 'finished' AND raster_path IS NOT NULL
            ORDER BY finished_at DESC LIMIT 1
            """,
            (row["geometry_version_id"],),
        ).fetchone()
        if not analysis:
            raise SourceUnavailable("no_productivity")
        return read_layer(settings.data_dir / analysis["raster_path"], "productivity"), None
    if row["source"] not in INDEX_SOURCES:
        raise SourceUnavailable("unknown_source")
    wanted = params.get("sceneDate")
    since = date.today() - timedelta(days=SCENE_LOOKBACK_DAYS)
    raster = conn.execute(
        """
        SELECT path, observed_on FROM field_rasters
        WHERE geometry_version_id = %(gv)s AND %(band)s = ANY(bands)
          AND (%(day)s::date IS NULL OR observed_on = %(day)s::date)
          AND (%(day)s::date IS NOT NULL OR (observed_on >= %(since)s AND valid_pixel_pct >= %(clear)s))
        ORDER BY valid_pixel_pct DESC, observed_on DESC
        LIMIT 1
        """,
        {
            "gv": row["geometry_version_id"],
            "band": row["source"],
            "day": wanted,
            "since": since,
            "clear": MIN_CLEAR_PCT,
        },
    ).fetchone()
    if not raster:
        raise SourceUnavailable("no_imagery")
    return read_layer(settings.data_dir / raster["path"], row["source"]), raster["observed_on"]


def params_of(row) -> ZonationParams:
    p = row["params"] or {}
    count = p.get("zoneCount")
    return ZonationParams(
        method=row["method"],
        zone_count=None if count in (None, "auto") else int(count),
        min_zone_ha=float(p.get("minZoneHa") or 0.25),
        coarseness=float(p["coarseness"]) if p.get("coarseness") is not None else 0.35,
        cleanup=p.get("cleanup") or "merge",
    )


def compute(conn: psycopg.Connection, settings: Settings, row) -> None:
    zonation_id = str(row["id"])
    geometry = json.loads(row["geometry"])
    grid = field_grid(geometry)

    def fail(code: str, error: str | None = None):
        conn.execute(
            "UPDATE soil_zonations SET status = 'failed', status_code = %s, error = %s, finished_at = now() WHERE id = %s",
            (code, error, zonation_id),
        )

    try:
        values, scene_date = source_layer(conn, settings, row)
    except SourceUnavailable as exc:
        fail(exc.code)
        return
    if values.shape != grid.shape:
        fail("grid_mismatch")
        return
    try:
        zones = zonate(values, grid, params_of(row))
    except ValueError as exc:
        fail("no_values", str(exc))
        return
    if not zones:
        fail("no_zones")
        return

    to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
    conn.execute(
        """
        UPDATE soil_zonations SET superseded_at = now()
        WHERE field_id = %s AND status = 'ready' AND superseded_at IS NULL AND id <> %s
        """,
        (row["field_id"], zonation_id),
    )
    for zone in zones:
        wgs84 = shapely.transform(zone.geometry, to_wgs84.transform, interleaved=False)
        conn.execute(
            """
            INSERT INTO soil_zones (organization_id, zonation_id, zone_no, label, color, geometry, area_ha, mean_value, sample_point)
            SELECT %(org)s, %(zonation)s, %(no)s, %(label)s, %(color)s, g, %(area)s, %(mean)s, ST_PointOnSurface(g)
            FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)), 3)) AS g) s
            """,
            {
                "org": row["organization_id"],
                "zonation": zonation_id,
                "no": zone.number,
                "label": f"Zone {zone.number}",
                "color": ZONE_COLORS[(zone.number - 1) % len(ZONE_COLORS)],
                "geom": json.dumps(mapping(wgs84)),
                "area": round(zone.area_ha, 4),
                "mean": None if zone.mean_value is None else round(zone.mean_value, 4),
            },
        )
    conn.execute(
        """
        UPDATE soil_zonations SET status = 'ready', status_code = 'ok', zone_count = %s, scene_date = %s,
          finished_at = now()
        WHERE id = %s
        """,
        (len(zones), scene_date, zonation_id),
    )
    log.info("Soil zonation %s: %d zones (%s, %s)", zonation_id, len(zones), row["method"], row["source"])


def run_queued(settings: Settings) -> int:
    handled = 0
    with connect(settings) as conn:
        while row := claim(conn):
            try:
                compute(conn, settings, row)
                conn.commit()
            except Exception as exc:
                conn.rollback()
                log.exception("Soil zonation %s failed", row["id"])
                conn.execute(
                    "UPDATE soil_zonations SET status = 'failed', status_code = 'error', error = %s, finished_at = now() "
                    "WHERE id = %s",
                    (str(exc)[:500], row["id"]),
                )
                conn.commit()
            handled += 1
    return handled
