from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import shape

from agmeo_geo.fieldgrid import analysis_mask, field_grid
from agmeo_geo.productivity import (
    CONSISTENCY_THRESHOLD,
    Candidate,
    assign_seasons,
    classify,
    consistent_selection,
    kmeans_1d,
    productivity_map,
    season_windows,
    select_scenes,
    stability,
    suitability_status,
    tercile_stability,
    zones,
)

# ~400 × 300 m field near Marschhof.
FIELD = {
    "type": "Polygon",
    "coordinates": [[[7.285, 53.299], [7.291, 53.299], [7.291, 53.3017], [7.285, 53.3017], [7.285, 53.299]]],
}


def pattern(grid, noise, seed):
    """West-east productivity gradient (0.8 → 1.2) plus noise, scaled to an NDVI level."""
    rng = np.random.default_rng(seed)
    x = np.linspace(0.8, 1.2, grid.width)[None, :].repeat(grid.height, axis=0)
    return x + rng.normal(0, noise, grid.shape)


def test_consistent_pattern_is_stable_and_zoned_west_to_east():
    grid = field_grid(FIELD)
    inside = grid.mask()
    seasons = {
        year: [0.7 * pattern(grid, 0.03, year * 10 + i) for i in range(2)] for year in (2021, 2022, 2023)
    }
    productivity, season_maps = productivity_map(seasons, inside)
    assert np.nanmean(productivity[inside]) == pytest.approx(1.0, abs=1e-6)
    score = stability(season_maps, inside)
    assert score > 0.8 and suitability_status(score, 0.9, 6) == "suitable"

    classes = classify(productivity, inside, 3)
    assert set(np.unique(classes[inside])) == {1, 2, 3}
    # Zone numbers increase from west to east, like the productivity gradient.
    west, east = classes[inside][:5].mean(), classes[:, -4][inside[:, -4]].mean()
    assert west < east

    result = zones(productivity, classes, inside, grid, 3)
    assert [z.number for z in result] == [1, 2, 3]
    assert result[0].relative_productivity < 100 < result[2].relative_productivity
    # Zones tile the boundary.
    total = sum(z.area_ha for z in result)
    assert total == pytest.approx(grid.geometry.area / 10_000, rel=0.01)
    for z in result:
        assert shape(z.geometry_wgs84).is_valid


def test_random_noise_is_not_stable():
    grid = field_grid(FIELD)
    inside = grid.mask()
    rng = np.random.default_rng(1)
    seasons = {year: [0.7 + rng.normal(0, 0.05, grid.shape)] for year in (2021, 2022, 2023)}
    _, season_maps = productivity_map(seasons, inside)
    assert suitability_status(stability(season_maps, inside), 0.9, 3) == "not_suitable"


def test_kmeans_separates_clusters():
    values = np.concatenate([np.full(50, 0.8), np.full(30, 1.0), np.full(20, 1.3)])
    assert kmeans_1d(values, 3) == pytest.approx([0.8, 1.0, 1.3])


def test_boundary_pixels_do_not_form_their_own_zone():
    grid = field_grid(FIELD)
    inside = grid.mask()
    core = analysis_mask(grid, 10.0)
    ring = inside & ~core
    seasons = {}
    for year in (2021, 2022, 2023):
        ndvi = 0.7 * pattern(grid, 0.03, year)
        ndvi[ring] = 0.3  # hedges and tracks in every season
        seasons[year] = [ndvi]
    productivity, _ = productivity_map(seasons, core)
    classes = classify(productivity, core, 3)
    result = zones(productivity, classes, core, grid, 3)
    shares = [z.area_ha / (grid.geometry.area / 10_000) for z in result]
    # Without the core, the ring would be zone 1 and the interior one big zone.
    assert len(result) == 3 and min(shares) > 0.2


# ---------------------------------------------------------------------------
# pz-4: season windows, consistency search, tercile stability
# ---------------------------------------------------------------------------


def ndvi_series(peaks: dict[int, tuple[str, float]], start="2021-01-01", end="2023-12-31", every=5):
    """Field-median NDVI every few days: a bare-soil base of 0.2 plus one bump per season."""
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    series = []
    day = first
    while day <= last:
        value = 0.2
        for peak_day, height in peaks.values():
            dt = (day - date.fromisoformat(peak_day)).days
            value += (height - 0.2) * np.exp(-0.5 * (dt / 30) ** 2)
        series.append((day, float(value)))
        day += timedelta(days=every)
    return series


def candidate(day: str, mean: float = 0.7, sid: str | None = None) -> Candidate:
    return Candidate(sid or day, date.fromisoformat(day), Path("x"), mean)


def test_season_windows_follow_the_ndvi_peaks():
    peaks = {2021: ("2021-06-01", 0.85), 2022: ("2022-05-10", 0.8), 2023: ("2023-08-01", 0.75)}
    windows = season_windows(ndvi_series(peaks), {2021, 2022, 2023})
    assert [(w.season, w.source) for w in windows] == [(2021, "curve"), (2022, "curve"), (2023, "curve")]
    for w in windows:
        peak_day = date.fromisoformat(peaks[w.season][0])
        assert abs((w.start - peak_day).days) <= 5
        # The window ends on the descending branch, where the curve falls below
        # max(0.25, 0.3 × peak) — well before the next season.
        assert 30 <= (w.end - w.start).days <= 120
    # A May peak covers the following weeks of senescence, not the autumn.
    wheat = windows[1]
    assert wheat.contains(candidate("2022-06-20")) and not wheat.contains(candidate("2022-04-01"))
    assert not wheat.contains(candidate("2022-10-15"))


def test_season_windows_keep_the_highest_peak_per_year():
    # Main crop in May, catch crop in October of the same year.
    peaks = {1: ("2022-05-15", 0.85), 2: ("2022-10-20", 0.5)}
    windows = season_windows(ndvi_series(peaks, "2022-01-01", "2022-12-31"), {2022})
    assert len(windows) == 1 and windows[0].peak > 0.8


def test_winter_peaks_are_not_seasons():
    # Green winter cereals in January; the summer crop of that year stays below 0.33.
    peaks = {1: ("2022-01-10", 0.6), 2: ("2022-07-01", 0.3)}
    windows = season_windows(ndvi_series(peaks, "2021-07-01", "2022-12-31"), {2022})
    assert [(w.season, w.source) for w in windows] == [(2022, "calendar")]


def test_season_windows_fall_back_to_the_calendar():
    # Too short a series for the 91-day filter, and a year without any curve at all.
    short = ndvi_series({2023: ("2023-06-01", 0.8)}, "2023-05-01", "2023-06-30")
    windows = season_windows(short, {2023, 2024})
    assert [(w.season, w.source, w.start, w.end) for w in windows] == [
        (2023, "calendar", date(2023, 3, 1), date(2023, 10, 1)),
        (2024, "calendar", date(2024, 3, 1), date(2024, 10, 1)),
    ]
    # A flat, low curve (no peak ≥ 0.33) falls back too.
    flat = [(d, 0.25) for d, _ in ndvi_series({}, "2022-01-01", "2022-12-31")]
    assert [w.source for w in season_windows(flat, {2022})] == ["calendar"]
    # The calendar window still requires a green, unsaturated canopy.
    calendar = season_windows([], {2024})
    listed = assign_seasons(
        [
            candidate("2024-02-01"),
            candidate("2024-06-01"),
            candidate("2024-06-11", 0.2),
            candidate("2024-07-01", 0.95),
        ],
        calendar,
    )
    assert [c.day.isoformat() for c in listed] == ["2024-06-01"]
    assert listed[0].season == 2024


def corr_matrix(seasons, consistent_pairs, high=0.9, low=0.2):
    n = len(seasons)
    corr = np.full((n, n), low)
    np.fill_diagonal(corr, 1.0)
    for (i, j), value in consistent_pairs.items():
        corr[i, j] = corr[j, i] = value
    return corr


def test_consistency_search_maximises_seasons_then_correlation():
    # Two candidates per season; season 2020 disagrees with everything.
    seasons = [2023, 2023, 2022, 2022, 2021, 2021, 2020]
    pairs = {
        (0, 2): 0.7,
        (0, 4): 0.7,
        (2, 4): 0.7,  # a consistent set over 3 seasons, mean 0.7
        (1, 3): 0.9,
        (1, 5): 0.9,
        (3, 5): 0.9,  # another one, mean 0.9: wins the tie on count
        (0, 3): 0.6,
        (2, 5): 0.6,
    }
    corr = corr_matrix(seasons, pairs)
    assert consistent_selection(seasons, corr) == [1, 3, 5]
    # Several dates per season when asked for, as long as all pairs still agree.
    pairs.update({(0, 1): 0.8, (0, 3): 0.8, (0, 5): 0.8})
    assert consistent_selection(seasons, corr_matrix(seasons, pairs), per_season=2) == [0, 1, 3, 5]


def test_consistency_search_needs_a_recent_season_and_two_seasons():
    seasons = [2024, 2023, 2022, 2021, 2020]
    # 2020–2022 agree with each other, the two most recent seasons with nothing.
    pairs = {(2, 3): 0.9, (2, 4): 0.9, (3, 4): 0.9}
    assert consistent_selection(seasons, corr_matrix(seasons, pairs)) == []
    # Once 2023 agrees with 2021, the best set must contain 2023, even though 2020–2022 are larger.
    pairs[(1, 3)] = 0.8
    assert consistent_selection(seasons, corr_matrix(seasons, pairs)) == [1, 3]
    # The threshold is strict.
    at = {(0, 1): CONSISTENCY_THRESHOLD}
    assert consistent_selection([2024, 2023], corr_matrix([2024, 2023], at)) == []


def test_select_scenes_marks_inconsistent_and_crop_seasons():
    grid = field_grid(FIELD)
    inside = grid.mask()
    peaks = {y: (f"{y}-06-01", 0.85) for y in (2020, 2021, 2022, 2023, 2024)}
    series = ndvi_series(peaks, "2020-01-01", "2024-12-31")
    rasters = {
        "2020": 0.7 * pattern(grid, 0.02, 1),
        "2021": 0.7 * pattern(grid, 0.02, 2),
        "2022": 0.7 * pattern(grid, 0.02, 3)[:, ::-1],  # mirrored: high where the others are low
        "2023": 0.7 * pattern(grid, 0.02, 4),
        "2024": 0.7 * pattern(grid, 0.02, 5),
    }
    candidates = [candidate(f"{y}-06-15", sid=y) for y in rasters] + [
        candidate("2023-06-20", sid="user-excluded"),
        candidate("2023-12-01", sid="winter"),  # outside every window
    ]
    selection = select_scenes(
        candidates,
        series,
        excluded={"user-excluded"},
        bad_seasons={2024},  # grassland
        load=lambda c: rasters.get(c.scene_id, rasters["2023"]),
        inside=inside,
    )
    assert [c.scene_id for c in selection.used] == ["2020", "2021", "2023"]
    assert selection.reasons == {"2022": "inconsistent", "2024": "crop"}
    assert {c.scene_id for c in selection.listed} == set(rasters) | {"user-excluded"}
    assert selection.min_correlation > CONSISTENCY_THRESHOLD
    assert len(selection.smoothed) == 3


def test_select_scenes_without_two_consistent_seasons():
    grid = field_grid(FIELD)
    inside = grid.mask()
    rng = np.random.default_rng(7)
    rasters = {y: 0.7 + rng.normal(0, 0.05, grid.shape) for y in ("2022", "2023")}
    selection = select_scenes(
        [candidate(f"{y}-06-15", sid=y) for y in rasters],
        series=[],
        excluded=set(),
        bad_seasons=set(),
        load=lambda c: rasters[c.scene_id],
        inside=inside,
    )
    assert selection.used == []
    assert selection.reasons == {"2022": "inconsistent", "2023": "inconsistent"}


def test_tercile_stability():
    grid = field_grid(FIELD)
    inside = grid.mask()
    base = pattern(grid, 0.01, 0)  # the noise breaks ties between pixels of a column
    stable = [base * k for k in (0.6, 0.7, 0.8)]
    assert tercile_stability(stable, inside) == pytest.approx(2 / 3, abs=0.03)
    rng = np.random.default_rng(3)
    noise = [rng.normal(0, 1, grid.shape) for _ in range(3)]
    # Independent maps: (1/3)³ in each tercile by chance.
    assert tercile_stability(noise, inside) == pytest.approx(2 / 27, abs=0.03)
    assert tercile_stability(stable[:1], inside) is None


def test_suitability_label():
    assert suitability_status(0.9, 0.8, 1) == "not_suitable"
    assert suitability_status(None, None, 4) == "not_suitable"
    assert suitability_status(0.9, 0.8, 3) == "suitable"
    # Two acquisitions or a weak pair cap the label at partially suitable.
    assert suitability_status(0.9, 0.8, 2) == "partially_suitable"
    assert suitability_status(0.9, 0.5, 4) == "partially_suitable"
    assert suitability_status(0.3, 0.8, 4) == "not_suitable"
