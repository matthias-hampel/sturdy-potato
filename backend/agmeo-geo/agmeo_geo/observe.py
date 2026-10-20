"""One field × one acquisition: statistics, field raster, and the rows that record them."""

import logging
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import numpy as np
import psycopg

from .config import Settings
from .fieldgrid import FieldGrid, analysis_mask, field_grid, grid_stats, write_raster, write_rgb
from .sources import INDICES
from .zonal import FieldStats

log = logging.getLogger("agmeo_geo.observe")

# Statistics on the aligned field grid (zonal-1 sampled the source raster directly); zonal-3 adds p20/p80.
OBS_VERSION = "zonal-3"


@dataclass
class FieldTarget:
    field_id: str
    organization_id: str
    geometry_version_id: str
    geometry: dict  # GeoJSON, WGS 84
    _grid: FieldGrid | None = field(default=None, repr=False)

    @property
    def grid(self) -> FieldGrid:
        if self._grid is None:
            self._grid = field_grid(self.geometry)
        return self._grid


@dataclass
class Outcome:
    target: FieldTarget
    stats: dict[str, FieldStats]
    clear_fraction: float
    raster: tuple[str, list[str], bool] | None  # relative path, bands, has true colour


def raster_path(target: FieldTarget, scene_uuid: str) -> Path:
    return Path("rasters") / target.field_id / target.geometry_version_id / f"{scene_uuid}.tif"


def rgb_path(path: Path) -> Path:
    return path.with_name(path.stem + ".rgb.tif")


def observe(reader, target: FieldTarget, settings: Settings, scene_uuid: str) -> Outcome:
    grid = target.grid
    analysis = analysis_mask(grid, settings.inner_buffer_m)
    clear = reader.clear(grid)
    total = int(analysis.sum())
    clear_px = int((clear & analysis).sum())
    fraction = clear_px / total if total else 0.0
    if fraction < settings.min_read_fraction or clear_px < settings.min_valid_pixels:
        # Mostly cloudy over this field: the bands are not even fetched.
        empty = FieldStats(None, None, None, None, None, clear_px, total)
        return Outcome(target, {index: empty for index in INDICES}, fraction, None)

    layers = reader.indices(grid, clear)
    stats = {index: grid_stats(layer, analysis) for index, layer in layers.items()}
    relative = raster_path(target, scene_uuid)
    bands = write_raster(settings.data_dir / relative, grid, layers)
    has_rgb = False
    rgb = reader.rgb(grid)
    if rgb is not None and rgb.any():
        write_rgb(settings.data_dir / rgb_path(relative), grid, rgb)
        has_rgb = True
    return Outcome(target, stats, fraction, (str(relative), bands, has_rgb))


def _round(value: float | None) -> float | None:
    # Columns are numeric(6,4); index values outside ±99 would be meaningless anyway.
    return None if value is None else round(max(-99.0, min(99.0, value)), 4)


def store(
    conn: psycopg.Connection,
    outcome: Outcome,
    scene_uuid: str,
    observed_on: date,
    processing_version: str,
    settings: Settings,
) -> int:
    """Upserts the observations (and field raster) of one outcome; does not commit."""
    t = outcome.target
    # Observations of earlier boundaries or processing versions are superseded.
    conn.execute(
        """
        DELETE FROM field_observations
        WHERE field_id = %s AND scene_id = %s AND (geometry_version_id <> %s OR processing_version <> %s)
        """,
        (t.field_id, scene_uuid, t.geometry_version_id, processing_version),
    )
    written = 0
    for index, stats in outcome.stats.items():
        ok = (
            stats.valid_fraction >= settings.min_valid_fraction
            and stats.valid_pixels >= settings.min_valid_pixels
        )
        conn.execute(
            """
            INSERT INTO field_observations (organization_id, field_id, geometry_version_id, scene_id,
                observed_on, index_type, mean, median, p10, p20, p80, p90, stddev, valid_pixel_pct, status,
                source, processing_version)
            VALUES (%(org)s, %(field)s, %(gv)s, %(scene)s, %(day)s, %(index)s, %(mean)s, %(median)s,
                %(p10)s, %(p20)s, %(p80)s, %(p90)s, %(std)s, %(pct)s, %(status)s, 'sentinel-2', %(version)s)
            ON CONFLICT (field_id, scene_id, index_type, processing_version) DO UPDATE SET
              geometry_version_id = EXCLUDED.geometry_version_id, observed_on = EXCLUDED.observed_on,
              mean = EXCLUDED.mean, median = EXCLUDED.median, p10 = EXCLUDED.p10, p20 = EXCLUDED.p20, p80 = EXCLUDED.p80, p90 = EXCLUDED.p90,
              stddev = EXCLUDED.stddev, valid_pixel_pct = EXCLUDED.valid_pixel_pct, status = EXCLUDED.status
            """,
            {
                "org": t.organization_id,
                "field": t.field_id,
                "gv": t.geometry_version_id,
                "scene": scene_uuid,
                "day": observed_on,
                "index": index,
                "mean": _round(stats.mean),
                "median": _round(stats.median),
                "p10": _round(stats.p10),
                "p90": _round(stats.p90),
                "p20": _round(stats.p20),
                "p80": _round(stats.p80),
                "std": _round(stats.stddev),
                "pct": round(100 * stats.valid_fraction, 2),
                "status": "valid" if ok else "insufficient_coverage",
                "version": processing_version,
            },
        )
        written += 1
    if outcome.raster:
        path, bands, has_rgb = outcome.raster
        conn.execute(
            """
            INSERT INTO field_rasters (organization_id, field_id, geometry_version_id, scene_id, observed_on,
                valid_pixel_pct, path, bands, has_rgb, processing_version)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (geometry_version_id, scene_id) DO UPDATE SET
              observed_on = EXCLUDED.observed_on, valid_pixel_pct = EXCLUDED.valid_pixel_pct,
              path = EXCLUDED.path, bands = EXCLUDED.bands, has_rgb = EXCLUDED.has_rgb,
              processing_version = EXCLUDED.processing_version
            """,
            (
                t.organization_id,
                t.field_id,
                t.geometry_version_id,
                scene_uuid,
                observed_on,
                round(100 * float(np.clip(outcome.clear_fraction, 0, 1)), 2),
                path,
                bands,
                has_rgb,
                processing_version,
            ),
        )
    return written
