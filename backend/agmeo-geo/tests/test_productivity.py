from datetime import date
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import shape

from agmeo_geo.fieldgrid import analysis_mask, field_grid
from agmeo_geo.productivity import (
    Candidate,
    classify,
    kmeans_1d,
    productivity_map,
    select,
    stability,
    suitability_status,
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


def test_select_prefers_peak_canopy_spaced_apart():
    c = lambda d, m, sid=None: Candidate(sid or d, date.fromisoformat(d), Path("x"), m)
    candidates = [
        c("2023-05-01", 0.80),
        c("2023-05-05", 0.85),  # within 10 days of a better one in the same season
        c("2023-05-20", 0.82),
        c("2023-03-01", 0.20),  # bare soil: excluded
        c("2023-07-01", 0.95),  # saturated: excluded
        c("2023-11-20", 0.80),  # outside the growing window
        c("2024-06-01", 0.70, "excluded"),
        c("2024-06-20", 0.75),
    ]
    chosen = select(candidates, excluded={"excluded"})
    assert [x.day.isoformat() for x in chosen] == ["2023-05-05", "2023-05-20", "2024-06-20"]


def test_consistent_pattern_is_stable_and_zoned_west_to_east():
    grid = field_grid(FIELD)
    inside = grid.mask()
    seasons = {
        year: [0.7 * pattern(grid, 0.03, year * 10 + i) for i in range(2)] for year in (2021, 2022, 2023)
    }
    productivity, season_maps = productivity_map(seasons, inside)
    assert np.nanmean(productivity[inside]) == pytest.approx(1.0, abs=1e-6)
    score = stability(season_maps, inside)
    assert score > 0.8 and suitability_status(score) == "suitable"

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
    assert suitability_status(stability(season_maps, inside)) == "not_suitable"


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
