import numpy as np
import pytest

from agmeo_geo.appmaps import median_stack, normalised_pct, synthetic_relative
from agmeo_geo.fieldgrid import field_grid
from agmeo_geo.zonation import ZonationParams, zonate

FIELD = {
    "type": "Polygon",
    "coordinates": [[[7.285, 53.299], [7.291, 53.299], [7.291, 53.3017], [7.285, 53.3017], [7.285, 53.299]]],
}


def test_synthetic_relative_spreads_by_metric():
    rel = synthetic_relative([0.3, 0.5, 0.7], [1, 2, 3])
    assert rel == pytest.approx([0.8, 1.0, 1.2])


def test_synthetic_relative_falls_back_to_rank():
    # A missing mean, or all means equal, spreads by zone order instead.
    assert synthetic_relative([0.3, None, 0.7], [1, 2, 3]) == pytest.approx([0.8, 1.0, 1.2])
    assert synthetic_relative([0.5, 0.5], [1, 2]) == pytest.approx([0.8, 1.2])
    assert synthetic_relative([0.5], [1]) == [1.0]
    assert synthetic_relative([], []) == []


def test_normalised_pct_has_area_weighted_mean_100():
    pct = normalised_pct([0.8, 1.2], [3.0, 1.0])
    assert sum(p * a for p, a in zip(pct, [3.0, 1.0])) / 4.0 == pytest.approx(100, abs=0.01)
    assert pct[1] > pct[0]


def test_median_stack_ignores_gaps():
    a = np.array([[0.2, np.nan], [0.4, np.nan]])
    b = np.array([[0.4, 0.6], [np.nan, np.nan]])
    c = np.array([[0.9, 0.8], [0.5, np.nan]])
    out = median_stack([a, b, c])
    assert out[0, 0] == pytest.approx(0.4)
    assert out[0, 1] == pytest.approx(0.7)
    assert out[1, 0] == pytest.approx(0.45)
    assert np.isnan(out[1, 1])
    assert median_stack([a]) is a


def test_a_scene_gradient_gives_ordered_zones():
    grid = field_grid(FIELD)
    rows, cols = grid.shape
    values = np.tile(np.linspace(0.2, 0.8, cols), (rows, 1))
    zones = zonate(values, grid, ZonationParams(method="segment", zone_count=3))
    assert [z.number for z in zones] == [1, 2, 3]
    means = [z.mean_value for z in zones]
    assert means == sorted(means)
    pct = normalised_pct(synthetic_relative(means, [z.number for z in zones]), [z.area_ha for z in zones])
    assert pct[0] < 100 < pct[-1]
