"""Productivity zones from several seasons of field rasters.

Method (``ALGO_VERSION`` pz-4; the scene selection follows OneSoil's productivity maps):

1. Season windows from the NDVI curve: the field-median NDVI of every valid acquisition is
   interpolated to days and smoothed (Savitzky–Golay, 91 days); peaks of at least 0.33, at
   least 90 days apart and between 1 March and 1 October are crop seasons, named by the year
   of the peak (one per year, the highest). A season's window runs from its peak towards the
   following trough while the curve stays at or above max(0.25, 0.3 × peak). Years without a
   peak fall back to 1 March–1 October, where a field-mean NDVI between 0.35 and 0.92 is
   required.
2. Candidates: NDVI field rasters of the current boundary inside a window with at least 90 %
   of the field clear. User-excluded acquisitions are dropped, and so are seasons whose main
   crop is vegetables, grassland, fruit, vines or flowers, if the crop is known.
3. Cross-season consistency: every candidate is smoothed (Gaussian σ = 2 pixels) and compared
   with the others on the field shrunk by 2 pixels. One acquisition per season is chosen so
   that every pair correlates above 0.545 (Pearson), maximising the number of seasons first
   and the mean correlation second; one of the two most recent seasons must be included.
   Fewer than two consistent seasons fail with ``not_enough_seasons``. The other seasons are
   listed as ``inconsistent``.
4. Pixels within 10 m of the boundary (mixed with hedges, ditches, tracks) are left out;
   they take the nearest interior value. Each acquisition is normalised by its field mean (1 = field average). A season's map is
   the mean of its acquisitions; the productivity map is the mean over the seasons, so every
   season weighs the same however many clear dates it had. A light Gaussian smoothing
   (σ = 1 pixel) removes pixel noise.
5. Stability: for each season, the Pearson correlation of its map with the mean of the other
   seasons; ``suitability`` is the mean of those correlations (negative ones count as 0).
   Tercile stability is the share of pixels in the bottom tercile of every chosen acquisition
   plus the share in the top tercile of every one (smoothed maps; at most 2/3). The label is
   ``suitable`` with more than two acquisitions, a minimum pairwise correlation of at least
   0.545 and stability ≥ 0.6, ``partially_suitable`` with stability ≥ 0.4, else (and always
   with fewer than two acquisitions) ``not_suitable``.
6. Zones: 1-D k-means of the productivity values (2 % tails clipped) into 3, 5 and 7 classes, small patches
   sieved into their neighbours, vectorised, simplified as a coverage and clipped to the
   boundary. Zone 1 is the least productive; each zone carries its mean productivity as % of
   the field mean.
"""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import psycopg
import shapely
from pyproj import Transformer
from rasterio.features import shapes, sieve
from scipy.ndimage import binary_erosion, distance_transform_edt, gaussian_filter
from scipy.signal import find_peaks, savgol_filter
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import unary_union

from .config import Settings
from .fieldgrid import RESOLUTION, FieldGrid, analysis_mask, field_grid, read_layer, write_raster
from .pipeline import connect

log = logging.getLogger("agmeo_geo.productivity")

ALGO_VERSION = "pz-4"
ZONE_COUNTS = (3, 5, 7)
MIN_CLEAR_PCT = 90.0
MIN_SEASONS = 2

# Season windows (OneSoil's season detection).
SAVGOL_WINDOW_DAYS = 91
SAVGOL_ORDER = 3
PEAK_HEIGHT = 0.33
PEAK_DISTANCE_DAYS = 90
WINDOW_FLOOR = 0.25
WINDOW_PEAK_SHARE = 0.3
# The main canopy period of arable crops in Europe: peaks outside it are not crop seasons.
# Without a peak it is the window, with a sanity check on the field mean (green canopy, not
# bare soil, not fully saturated).
FALLBACK_WINDOW = ((3, 1), (10, 1))
FALLBACK_NDVI_RANGE = (0.35, 0.92)

# Seasons with these crops do not show soil-driven productivity (OneSoil's BAD_CROPS). agmeo's
# catalogue has no fruit, vine or flower category yet; they are listed for when it does.
BAD_CROP_CATEGORIES = frozenset({"vegetable", "grassland", "fruit", "vine", "flower"})

# Cross-season consistency.
CONSISTENCY_THRESHOLD = 0.545
CONSISTENCY_SIGMA = 2.0
CONSISTENCY_ERODE_PX = 2
PER_SEASON = 1
# The search is exponential in the worst case; the clearest-canopy candidates per season are kept.
MAX_CANDIDATES_PER_SEASON = 8


@dataclass
class Candidate:
    scene_id: str
    day: date
    path: Path
    mean: float
    # Set when the acquisition falls into a season window.
    season: int | None = None


@dataclass
class Window:
    season: int
    start: date
    end: date
    # "curve" (from an NDVI peak) or "calendar" (fallback).
    source: str
    peak: float | None = None

    def contains(self, c: Candidate) -> bool:
        if not self.start <= c.day <= self.end:
            return False
        if self.source == "calendar":
            return FALLBACK_NDVI_RANGE[0] <= c.mean <= FALLBACK_NDVI_RANGE[1]
        return True


def in_season(day: date) -> bool:
    (m0, d0), (m1, d1) = FALLBACK_WINDOW
    return date(day.year, m0, d0) <= day <= date(day.year, m1, d1)


def season_windows(series: Sequence[tuple[date, float]], years: set[int]) -> list[Window]:
    """Season windows from the field-median NDVI series; calendar windows for the other years."""
    windows: dict[int, Window] = {}
    points = sorted((d, v) for d, v in series if v is not None and np.isfinite(v))
    if points and (points[-1][0] - points[0][0]).days + 1 >= SAVGOL_WINDOW_DAYS:
        first = points[0][0]
        offsets = np.array([(d - first).days for d, _ in points], dtype=float)
        days = np.arange(int(offsets[-1]) + 1)
        # Acquisitions on the same day (overlapping orbits) are averaged.
        unique, inverse = np.unique(offsets, return_inverse=True)
        values = np.bincount(inverse, weights=[v for _, v in points]) / np.bincount(inverse)
        curve = savgol_filter(np.interp(days, unique, values), SAVGOL_WINDOW_DAYS, SAVGOL_ORDER)
        peaks, props = find_peaks(curve, height=PEAK_HEIGHT, distance=PEAK_DISTANCE_DAYS)
        heights = props["peak_heights"]
        for i, p in enumerate(int(p) for p in peaks):
            peak_day = first + timedelta(days=p)
            season = peak_day.year
            if not in_season(peak_day):
                continue  # green winter cereals or a catch crop, not a crop season
            if season in windows and windows[season].peak >= heights[i]:
                continue
            following = int(peaks[i + 1]) if i + 1 < len(peaks) else len(curve)
            trough = p + int(np.argmin(curve[p:following]))
            floor = max(WINDOW_FLOOR, WINDOW_PEAK_SHARE * heights[i])
            below = np.nonzero(curve[p : trough + 1] < floor)[0]
            end = p + int(below[0]) - 1 if below.size else trough
            windows[season] = Window(
                season,
                peak_day,
                first + timedelta(days=end),
                "curve",
                float(heights[i]),
            )
    for year in years - windows.keys():
        (m0, d0), (m1, d1) = FALLBACK_WINDOW
        windows[year] = Window(year, date(year, m0, d0), date(year, m1, d1), "calendar")
    return sorted(windows.values(), key=lambda w: w.season)


def assign_seasons(candidates: list[Candidate], windows: list[Window]) -> list[Candidate]:
    """Candidates inside a season window, with their season set. Peak windows win over calendar ones."""
    ordered = sorted(windows, key=lambda w: w.source != "curve")
    result = []
    for c in candidates:
        window = next((w for w in ordered if w.contains(c)), None)
        if window:
            c.season = window.season
            result.append(c)
    return result


def nan_gaussian(values: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing that ignores NaN (normalised convolution)."""
    finite = np.isfinite(values)
    filled = np.where(finite, values, 0.0)
    num = gaussian_filter(filled, sigma, mode="nearest")
    den = gaussian_filter(finite.astype(float), sigma, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    return np.where(finite, out, np.nan)


def consistency_mask(inside: np.ndarray) -> np.ndarray:
    """The field shrunk by CONSISTENCY_ERODE_PX pixels (the whole field if too little is left)."""
    eroded = binary_erosion(inside, iterations=CONSISTENCY_ERODE_PX)
    return eroded if eroded.sum() >= 10 else inside


def smoothed(ndvi: np.ndarray, inside: np.ndarray) -> np.ndarray:
    return nan_gaussian(np.where(inside, ndvi, np.nan), CONSISTENCY_SIGMA)


def pearson(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    """Correlation over the mask where both maps have values; 0 when undefined."""
    ok = mask & np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 10:
        return 0.0
    x, y = a[ok], b[ok]
    if np.std(x) == 0 or np.std(y) == 0:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def correlation_matrix(maps: list[np.ndarray], mask: np.ndarray) -> np.ndarray:
    n = len(maps)
    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            corr[i, j] = corr[j, i] = pearson(maps[i], maps[j], mask)
    return corr


def consistent_selection(
    seasons: Sequence[int],
    corr: np.ndarray,
    threshold: float = CONSISTENCY_THRESHOLD,
    per_season: int = PER_SEASON,
) -> list[int]:
    """Indices of mutually consistent acquisitions, at most ``per_season`` per season.

    Branch and bound over one acquisition (or none) per season, newest season first: every
    chosen pair must correlate above ``threshold``; the most seasons win, then the highest
    mean pairwise correlation; one of the two newest seasons must be included. Further
    acquisitions of the chosen seasons are then added while they agree with all chosen ones.
    Empty if fewer than MIN_SEASONS seasons agree.
    """
    order = sorted(set(seasons), reverse=True)
    groups = [[i for i, s in enumerate(seasons) if s == season] for season in order]
    best: tuple[int, float, list[int]] = (0, -1.0, [])

    def search(g: int, chosen: list[int], total: float) -> None:
        nonlocal best
        if g == 2 and not chosen:
            return  # neither of the two newest seasons
        if len(chosen) + len(groups) - g < best[0]:
            return
        if g == len(groups):
            pairs = len(chosen) * (len(chosen) - 1) / 2
            mean = total / pairs if pairs else 0.0
            if (len(chosen), mean) > best[:2]:
                best = (len(chosen), mean, list(chosen))
            return
        for i in groups[g]:
            if all(corr[i, j] > threshold for j in chosen):
                search(g + 1, [*chosen, i], total + sum(corr[i, j] for j in chosen))
        search(g + 1, chosen, total)

    search(0, [], 0.0)
    selected = best[2]
    if len(selected) < MIN_SEASONS:
        return []
    for i in list(selected):
        season = seasons[i]
        rest = [j for j in range(len(seasons)) if seasons[j] == season and j not in selected]
        rest.sort(key=lambda j: -np.mean([corr[j, k] for k in selected]))
        for j in rest:
            if sum(seasons[k] == season for k in selected) >= per_season:
                break
            if all(corr[j, k] > threshold for k in selected):
                selected.append(j)
    return sorted(selected)


def tercile_stability(maps: list[np.ndarray], mask: np.ndarray) -> float | None:
    """Share of pixels in the bottom tercile of every map plus the share in the top tercile of every map."""
    if len(maps) < 2:
        return None
    ok = mask.copy()
    for m in maps:
        ok &= np.isfinite(m)
    if ok.sum() < 10:
        return None
    low = np.ones(int(ok.sum()), dtype=bool)
    high = low.copy()
    for m in maps:
        values = m[ok]
        lo, hi = np.percentile(values, [100 / 3, 200 / 3])
        low &= values <= lo
        high &= values >= hi
    return float((low.sum() + high.sum()) / ok.sum())


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


def suitability_status(value: float | None, min_correlation: float | None, scene_count: int) -> str:
    if value is None or scene_count < 2:
        return "not_suitable"
    if (
        value >= 0.6
        and scene_count > 2
        and min_correlation is not None
        and min_correlation >= CONSISTENCY_THRESHOLD
    ):
        return "suitable"
    return "partially_suitable" if value >= 0.4 else "not_suitable"


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


def _ndvi_series(conn: psycopg.Connection, geometry_version_id: str) -> list[tuple[date, float]]:
    """Field-median NDVI of every valid acquisition, for the season windows."""
    rows = conn.execute(
        """
        SELECT observed_on, COALESCE(median, mean) AS value
        FROM field_observations
        WHERE geometry_version_id = %s AND index_type = 'ndvi' AND status = 'valid'
          AND COALESCE(median, mean) IS NOT NULL
        """,
        (geometry_version_id,),
    ).fetchall()
    return [(r["observed_on"], float(r["value"])) for r in rows]


def _bad_crop_seasons(conn: psycopg.Connection, field_id: str) -> set[int]:
    """Harvest years in which a main crop of the field is one that shows no soil-driven pattern."""
    rows = conn.execute(
        """
        SELECT DISTINCT s.harvest_year, c.category
        FROM crop_cycles cc
        JOIN growing_seasons s ON s.id = cc.season_id
        JOIN crops c ON c.id = cc.crop_id
        WHERE cc.field_id = %s AND cc.role = 'main'
        """,
        (field_id,),
    ).fetchall()
    return {int(r["harvest_year"]) for r in rows if r["category"] in BAD_CROP_CATEGORIES}


@dataclass
class Selection:
    # Acquisitions inside a season window, with their season.
    listed: list[Candidate]
    used: list[Candidate]
    # Why a listed acquisition's season was left out: "crop" or "inconsistent".
    reasons: dict[str, str]
    # Smoothed NDVI of the used acquisitions, as compared in the consistency check.
    smoothed: list[np.ndarray]
    min_correlation: float | None


def select_scenes(
    candidates: list[Candidate],
    series: Sequence[tuple[date, float]],
    excluded: set[str],
    bad_seasons: set[int],
    load,
    inside: np.ndarray,
) -> Selection:
    """Season windows, crop and user exclusions, then the cross-season consistency search.

    ``load(candidate)`` returns the acquisition's NDVI on the field grid.
    """
    windows = season_windows(series, {c.day.year for c in candidates})
    listed = assign_seasons(candidates, windows)
    reasons = {c.scene_id: "crop" for c in listed if c.season in bad_seasons}
    by_season: dict[int, list[Candidate]] = {}
    for c in listed:
        if c.scene_id not in excluded and c.season not in bad_seasons:
            by_season.setdefault(c.season, []).append(c)
    pool = [
        c
        for season in sorted(by_season)
        for c in sorted(by_season[season], key=lambda c: -c.mean)[:MAX_CANDIDATES_PER_SEASON]
    ]
    if len(by_season) < MIN_SEASONS:
        return Selection(listed, [], reasons, [], None)

    mask = consistency_mask(inside)
    maps = [smoothed(load(c), inside) for c in pool]
    corr = correlation_matrix(maps, mask)
    chosen = consistent_selection([c.season for c in pool], corr)
    seasons_used = {pool[i].season for i in chosen}
    for c in listed:
        if c.season in by_season and c.season not in seasons_used:
            reasons[c.scene_id] = "inconsistent"
    pairs = [corr[i, j] for i in chosen for j in chosen if i < j]
    return Selection(
        listed,
        [pool[i] for i in chosen],
        reasons,
        [maps[i] for i in chosen],
        float(min(pairs)) if pairs else None,
    )


def compute(conn: psycopg.Connection, settings: Settings, row) -> None:
    analysis_id = str(row["id"])
    geometry_version_id = str(row["geometry_version_id"])
    geometry = json.loads(row["geometry"])
    grid = field_grid(geometry)
    inside = grid.mask()
    # Mixed pixels at the boundary are left out of the analysis, as for field statistics.
    core = analysis_mask(grid, settings.inner_buffer_m)
    excluded = {str(s) for s in row["excluded_scene_ids"] or []}
    candidates = _candidates(conn, geometry_version_id, settings.data_dir)
    layers: dict[str, np.ndarray] = {}

    def load(c: Candidate) -> np.ndarray:
        if c.scene_id not in layers:
            layers[c.scene_id] = read_layer(c.path, "ndvi")
        return layers[c.scene_id]

    selection = select_scenes(
        candidates,
        _ndvi_series(conn, geometry_version_id),
        excluded,
        _bad_crop_seasons(conn, str(row["field_id"])),
        load,
        inside,
    )
    used = selection.used
    used_ids = {c.scene_id for c in used}
    scenes = [
        {
            "sceneId": c.scene_id,
            "date": c.day.isoformat(),
            "season": c.season,
            "ndviMean": round(c.mean, 4),
            "used": c.scene_id in used_ids,
            "reason": selection.reasons.get(c.scene_id),
        }
        for c in selection.listed
    ]
    seasons_used = sorted({c.season for c in used})

    def finish(status: str, code: str | None, **values):
        conn.execute(
            """
            UPDATE productivity_analyses SET status = %(status)s, status_code = %(code)s, scenes = %(scenes)s,
              season_count = %(seasons)s, scene_count = %(count)s, suitability = %(suitability)s,
              suitability_status = %(suitability_status)s, tercile_stability = %(tercile)s,
              min_correlation = %(min_correlation)s, raster_path = %(raster)s, algo_version = %(algo)s,
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
                "suitability_status": values.get("suitability_status"),
                "tercile": values.get("tercile"),
                "min_correlation": values.get("min_correlation"),
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

    by_season: dict[int, list[np.ndarray]] = {}
    for c in used:
        by_season.setdefault(c.season, []).append(load(c))
    productivity, season_maps = productivity_map(by_season, core)
    if productivity is None or not np.isfinite(productivity[core]).any():
        finish("failed", "no_imagery")
        return
    score = stability(season_maps, core)
    terciles = tercile_stability(selection.smoothed, consistency_mask(inside))
    min_correlation = selection.min_correlation
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
    finish(
        "finished",
        "ok",
        suitability=None if score is None else round(score, 3),
        suitability_status=suitability_status(score, min_correlation, len(used)),
        tercile=None if terciles is None else round(terciles, 3),
        min_correlation=None if min_correlation is None else round(min_correlation, 3),
        raster=str(relative),
    )
    log.info(
        "Productivity analysis %s: %d acquisitions over %d seasons, stability %s, terciles %s",
        analysis_id,
        len(used),
        len(seasons_used),
        "n/a" if score is None else f"{score:.2f}",
        "n/a" if terciles is None else f"{terciles:.2f}",
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
