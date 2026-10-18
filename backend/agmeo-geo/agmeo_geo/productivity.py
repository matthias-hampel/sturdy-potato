"""Productivity zones from several seasons of field rasters.

Method (``ALGO_VERSION``):

1. Candidates: NDVI field rasters of the current boundary from April to August with at least
   90 % of the field clear and a field-mean NDVI between 0.35 and 0.92: green canopy, not bare
   soil, not fully saturated. User-excluded acquisitions are dropped.
2. Per season (calendar year) the four acquisitions with the highest field mean, at least
   ten days apart, are used.
3. Pixels within 10 m of the boundary (mixed with hedges, ditches, tracks) are left out;
   they take the nearest interior value. Each acquisition is normalised by its field mean (1 = field average). A season's map is
   the mean of its acquisitions; the productivity map is the mean over the seasons, so every
   season weighs the same however many clear dates it had. A light Gaussian smoothing
   (σ = 1 pixel) removes pixel noise.
4. Stability: for each season, the Pearson correlation of its map with the mean of the other
   seasons; suitability is the mean of those correlations (negative ones count as 0).
5. Zones: 1-D k-means of the productivity values (2 % tails clipped) into 3, 5 and 7 classes, small patches
   sieved into their neighbours, vectorised, simplified as a coverage and clipped to the
   boundary. Zone 1 is the least productive; each zone carries its mean productivity as % of
   the field mean.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import psycopg
import shapely
from pyproj import Transformer
from rasterio.features import shapes, sieve
from scipy.ndimage import distance_transform_edt, gaussian_filter
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import unary_union

from .config import Settings
from .fieldgrid import RESOLUTION, FieldGrid, analysis_mask, field_grid, read_layer, write_raster
from .pipeline import connect

log = logging.getLogger("agmeo_geo.productivity")

ALGO_VERSION = "pz-3"
ZONE_COUNTS = (3, 5, 7)
MIN_CLEAR_PCT = 90.0
NDVI_RANGE = (0.35, 0.92)
# Main canopy period of arable crops and grassland in Central Europe (April to August).
GROWING_MONTHS = range(4, 9)
PER_SEASON = 4
MIN_SPACING_DAYS = 10
MIN_SEASONS = 2
MIN_SCENES = 3


@dataclass
class Candidate:
    scene_id: str
    day: date
    path: Path
    mean: float

    @property
    def season(self) -> int:
        return self.day.year


def eligible(c: Candidate) -> bool:
    return c.day.month in GROWING_MONTHS and NDVI_RANGE[0] <= c.mean <= NDVI_RANGE[1]


def select(candidates: list[Candidate], excluded: set[str]) -> list[Candidate]:
    """Up to PER_SEASON acquisitions per season with the highest field mean, spaced apart."""
    chosen: list[Candidate] = []
    by_season: dict[int, list[Candidate]] = {}
    for c in candidates:
        if c.scene_id not in excluded and eligible(c):
            by_season.setdefault(c.season, []).append(c)
    for season in sorted(by_season):
        picked: list[Candidate] = []
        for c in sorted(by_season[season], key=lambda c: -c.mean):
            if all(abs((c.day - p.day).days) >= MIN_SPACING_DAYS for p in picked):
                picked.append(c)
            if len(picked) == PER_SEASON:
                break
        chosen.extend(sorted(picked, key=lambda c: c.day))
    return chosen


def nan_gaussian(values: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing that ignores NaN (normalised convolution)."""
    finite = np.isfinite(values)
    filled = np.where(finite, values, 0.0)
    num = gaussian_filter(filled, sigma, mode="nearest")
    den = gaussian_filter(finite.astype(float), sigma, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    return np.where(finite, out, np.nan)


def productivity_map(layers_by_season: dict[int, list[np.ndarray]], inside: np.ndarray):
    """Relative productivity (1 = field mean) and the per-season maps."""
    seasons = {}
    for season, layers in layers_by_season.items():
        normalised = []
        for ndvi in layers:
            mean = np.nanmean(ndvi[inside])
            if np.isfinite(mean) and mean > 0:
                normalised.append(ndvi / mean)
        if normalised:
            with np.errstate(invalid="ignore"), _quiet():
                seasons[season] = np.nanmean(np.stack(normalised), axis=0)
    if not seasons:
        return None, seasons
    with _quiet():
        combined = np.nanmean(np.stack(list(seasons.values())), axis=0)
    combined = nan_gaussian(np.where(inside, combined, np.nan), 1.0)
    mean = np.nanmean(combined[inside])
    return combined / mean, seasons


class _quiet:
    """Silences 'mean of empty slice' for pixels that are NaN in every input."""

    def __enter__(self):
        import warnings

        self._w = warnings.catch_warnings()
        self._w.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)

    def __exit__(self, *exc):
        return self._w.__exit__(*exc)


def stability(seasons: dict[int, np.ndarray], inside: np.ndarray) -> float | None:
    if len(seasons) < 2:
        return None
    keys = list(seasons)
    scores = []
    for k in keys:
        others = [seasons[o] for o in keys if o != k]
        with _quiet():
            rest = np.nanmean(np.stack(others), axis=0)
        a, b = seasons[k][inside], rest[inside]
        ok = np.isfinite(a) & np.isfinite(b)
        if ok.sum() < 10 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
            continue
        scores.append(max(0.0, float(np.corrcoef(a[ok], b[ok])[0, 1])))
    return float(np.mean(scores)) if scores else None


def suitability_status(value: float | None) -> str | None:
    if value is None:
        return None
    return "suitable" if value >= 0.6 else "partially_suitable" if value >= 0.4 else "not_suitable"


def kmeans_1d(values: np.ndarray, k: int, iterations: int = 50) -> np.ndarray:
    """Sorted class centres of a 1-D k-means, initialised at quantiles (deterministic)."""
    centres = np.quantile(values, (np.arange(k) + 0.5) / k)
    for _ in range(iterations):
        labels = np.argmin(np.abs(values[:, None] - centres[None, :]), axis=1)
        updated = np.array(
            [values[labels == i].mean() if np.any(labels == i) else centres[i] for i in range(k)]
        )
        if np.allclose(updated, centres):
            break
        centres = updated
    return np.sort(centres)


def fill_nearest(values: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Every pixel takes the value of the nearest known pixel."""
    _, (rows, cols) = distance_transform_edt(~known, return_indices=True)
    return values[rows, cols]


def classify(productivity: np.ndarray, core: np.ndarray, k: int) -> np.ndarray:
    """Zone numbers 1..k on the whole grid, small patches sieved into their neighbours.

    Classes are fitted on the field's core (the boundary shrunk against mixed edge pixels at
    hedges, ditches and tracks, which would otherwise form their own "low" zone), with the
    2 % tails clipped; edge and unknown pixels take the nearest core zone, so the zones cover
    the boundary completely and sieving never merges into "outside".
    """
    known = core & np.isfinite(productivity)
    values = productivity[known]
    lo, hi = np.percentile(values, [2, 98])
    centres = kmeans_1d(np.clip(values, lo, hi), k)
    edges = (centres[1:] + centres[:-1]) / 2
    classes = np.zeros(productivity.shape, dtype="int32")
    classes[known] = np.digitize(productivity[known], edges) + 1
    classes = fill_nearest(classes, known)
    field_pixels = int(core.sum())
    min_patch = max(4, min(30, field_pixels // 40))
    return sieve(classes, size=min_patch).astype("int32")


def vectorise(classes: np.ndarray, grid: FieldGrid, k: int) -> dict[int, MultiPolygon]:
    """Zone polygons in the grid CRS, clipped to the field boundary."""
    parts: dict[int, list] = {z: [] for z in range(1, k + 1)}
    for geometry, value in shapes(classes, transform=grid.transform):
        if int(value) in parts:
            parts[int(value)].append(shape(geometry))
    numbers = [z for z in parts if parts[z]]
    merged = [unary_union(parts[z]) for z in numbers]
    # Simplify the pixel staircase as a coverage (shared edges stay shared), then clip.
    simplified = shapely.coverage_simplify(merged, tolerance=0.6 * RESOLUTION)
    out = {}
    for z, geometry in zip(numbers, simplified, strict=True):
        clipped = shapely.make_valid(geometry).intersection(grid.geometry)
        polygons = [
            g for g in getattr(clipped, "geoms", [clipped]) if g.geom_type == "Polygon" and g.area > 1
        ]
        if polygons:
            out[z] = MultiPolygon(polygons)
    return out


@dataclass
class Zone:
    number: int
    geometry_wgs84: dict
    area_ha: float
    relative_productivity: float | None


def zones(
    productivity: np.ndarray, classes: np.ndarray, inside: np.ndarray, grid: FieldGrid, k: int
) -> list[Zone]:
    to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
    field_mean = np.nanmean(productivity[inside])
    result = []
    for number, polygon in sorted(vectorise(classes, grid, k).items()):
        pixels = inside & (classes == number) & np.isfinite(productivity)
        relative = float(100 * np.nanmean(productivity[pixels]) / field_mean) if pixels.any() else None
        result.append(
            Zone(
                number=number,
                geometry_wgs84=mapping(shapely.transform(polygon, to_wgs84.transform, interleaved=False)),
                area_ha=polygon.area / 10_000,
                relative_productivity=None if relative is None else round(relative, 2),
            )
        )
    return result


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def ensure_analyses(conn: psycopg.Connection) -> int:
    """Queues a first analysis for boundaries whose imagery history is loaded but have none."""
    rows = conn.execute(
        """
        INSERT INTO productivity_analyses (organization_id, field_id, geometry_version_id)
        SELECT j.organization_id, j.field_id, j.geometry_version_id
        FROM field_imagery_jobs j
        JOIN field_current_geometry g ON g.id = j.geometry_version_id
        JOIN fields f ON f.id = j.field_id AND f.status = 'active'
        WHERE j.status = 'finished'
          AND NOT EXISTS (SELECT 1 FROM productivity_analyses a WHERE a.geometry_version_id = j.geometry_version_id)
        RETURNING id
        """
    ).fetchall()
    conn.commit()
    return len(rows)


def claim(conn: psycopg.Connection):
    row = conn.execute(
        """
        SELECT a.id, a.organization_id, a.field_id, a.geometry_version_id, a.excluded_scene_ids,
               ST_AsGeoJSON(g.geometry) AS geometry
        FROM productivity_analyses a
        JOIN field_geometry_versions g ON g.id = a.geometry_version_id
        WHERE a.status = 'queued'
        ORDER BY a.created_at
        LIMIT 1
        FOR UPDATE OF a SKIP LOCKED
        """
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE productivity_analyses SET status = 'running', started_at = now(), error = NULL WHERE id = %s",
            (row["id"],),
        )
    conn.commit()
    return row


def _candidates(conn: psycopg.Connection, geometry_version_id: str, data_dir: Path) -> list[Candidate]:
    rows = conn.execute(
        """
        SELECT DISTINCT ON (r.observed_on) r.scene_id, r.observed_on, r.path, o.mean
        FROM field_rasters r
        JOIN field_observations o ON o.scene_id = r.scene_id AND o.geometry_version_id = r.geometry_version_id
             AND o.index_type = 'ndvi' AND o.status = 'valid'
        WHERE r.geometry_version_id = %s AND r.valid_pixel_pct >= %s AND 'ndvi' = ANY(r.bands)
        ORDER BY r.observed_on, r.valid_pixel_pct DESC
        """,
        (geometry_version_id, MIN_CLEAR_PCT),
    ).fetchall()
    return [
        Candidate(str(r["scene_id"]), r["observed_on"], data_dir / r["path"], float(r["mean"])) for r in rows
    ]


def compute(conn: psycopg.Connection, settings: Settings, row) -> None:
    analysis_id = str(row["id"])
    geometry = json.loads(row["geometry"])
    grid = field_grid(geometry)
    inside = grid.mask()
    # Mixed pixels at the boundary are left out of the analysis, as for field statistics.
    core = analysis_mask(grid, settings.inner_buffer_m)
    excluded = {str(s) for s in row["excluded_scene_ids"] or []}
    candidates = _candidates(conn, str(row["geometry_version_id"]), settings.data_dir)
    used = select(candidates, excluded)
    used_ids = {c.scene_id for c in used}
    scenes = [
        {
            "sceneId": c.scene_id,
            "date": c.day.isoformat(),
            "season": c.season,
            "ndviMean": round(c.mean, 4),
            "used": c.scene_id in used_ids,
        }
        for c in candidates
        if eligible(c)
    ]
    seasons_used = sorted({c.season for c in used})

    def finish(status: str, code: str | None, **values):
        conn.execute(
            """
            UPDATE productivity_analyses SET status = %(status)s, status_code = %(code)s, scenes = %(scenes)s,
              season_count = %(seasons)s, scene_count = %(count)s, suitability = %(suitability)s,
              suitability_status = %(suitability_status)s, raster_path = %(raster)s, algo_version = %(algo)s,
              finished_at = now()
            WHERE id = %(id)s
            """,
            {
                "status": status,
                "code": code,
                "scenes": json.dumps(scenes),
                "seasons": len(seasons_used),
                "count": len(used),
                "suitability": values.get("suitability"),
                "suitability_status": suitability_status(values.get("suitability")),
                "raster": values.get("raster"),
                "algo": ALGO_VERSION,
                "id": analysis_id,
            },
        )

    if not candidates:
        finish("failed", "no_imagery")
        return
    if len(seasons_used) < MIN_SEASONS:
        finish("failed", "not_enough_seasons")
        return
    if len(used) < MIN_SCENES:
        finish("failed", "not_enough_scenes")
        return

    by_season: dict[int, list[np.ndarray]] = {}
    for c in used:
        by_season.setdefault(c.season, []).append(read_layer(c.path, "ndvi"))
    productivity, season_maps = productivity_map(by_season, core)
    if productivity is None or not np.isfinite(productivity[core]).any():
        finish("failed", "no_imagery")
        return
    score = stability(season_maps, core)
    # Edge pixels show the nearest core value, like the zones.
    productivity = fill_nearest(productivity, core & np.isfinite(productivity))
    relative = (
        Path("productivity") / str(row["field_id"]) / str(row["geometry_version_id"]) / f"{analysis_id}.tif"
    )
    write_raster(settings.data_dir / relative, grid, {"productivity": np.where(inside, productivity, np.nan)})

    conn.execute("DELETE FROM zonings WHERE analysis_id = %s AND NOT is_custom", (analysis_id,))
    for k in ZONE_COUNTS:
        classes = classify(productivity, core, k)
        zoning = conn.execute(
            """
            INSERT INTO zonings (organization_id, field_id, geometry_version_id, analysis_id, source, zone_count)
            VALUES (%s, %s, %s, %s, 'productivity', %s) RETURNING id
            """,
            (row["organization_id"], row["field_id"], row["geometry_version_id"], analysis_id, k),
        ).fetchone()
        for zone in zones(productivity, classes, core, grid, k):
            conn.execute(
                """
                INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity)
                VALUES (%s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), %s, %s)
                """,
                (
                    row["organization_id"],
                    zoning["id"],
                    zone.number,
                    json.dumps(zone.geometry_wgs84),
                    round(zone.area_ha, 4),
                    zone.relative_productivity,
                ),
            )
    finish("finished", "ok", suitability=None if score is None else round(score, 3), raster=str(relative))
    log.info(
        "Productivity analysis %s: %d acquisitions over %d seasons, stability %s",
        analysis_id,
        len(used),
        len(seasons_used),
        "n/a" if score is None else f"{score:.2f}",
    )


def run_queued(settings: Settings) -> int:
    handled = 0
    with connect(settings) as conn:
        ensure_analyses(conn)
        while row := claim(conn):
            try:
                compute(conn, settings, row)
                conn.commit()
            except Exception as exc:
                conn.rollback()
                log.exception("Productivity analysis %s failed", row["id"])
                conn.execute(
                    "UPDATE productivity_analyses SET status = 'failed', status_code = 'error', error = %s, "
                    "finished_at = now() WHERE id = %s",
                    (str(exc)[:500], row["id"]),
                )
                conn.commit()
            handled += 1
    return handled
