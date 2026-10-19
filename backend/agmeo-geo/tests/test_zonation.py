import numpy as np
import pytest
from scipy import ndimage

from agmeo_geo.fieldgrid import field_grid
from agmeo_geo.zonation import (
    FOUR,
    ZonationParams,
    classify_grid,
    defuzzify,
    ensure_class_count,
    feature_preserving_smoothing,
    fix_kws_polygons,
    fpi,
    fuzzy_c_means,
    k_max_for_area,
    kmeans,
    majority_filter,
    merge_small_components,
    nce,
    rebalance_min_share,
    segment_equal_number_pixels,
    select_optimal_k,
    zonate,
)

# ~400 × 300 m field (12 ha) near Marschhof.
FIELD = {
    "type": "Polygon",
    "coordinates": [[[7.285, 53.299], [7.291, 53.299], [7.291, 53.3017], [7.285, 53.3017], [7.285, 53.299]]],
}


def three_bands(grid, noise=0.01, seed=1):
    """NDVI in three west-east bands (0.4 / 0.6 / 0.8) plus noise."""
    rng = np.random.default_rng(seed)
    band = np.digitize(np.linspace(0, 1, grid.width), [1 / 3, 2 / 3])
    values = np.array([0.4, 0.6, 0.8])[band][None, :].repeat(grid.height, axis=0)
    return values + rng.normal(0, noise, grid.shape)


def test_k_max_grows_with_field_size():
    assert [k_max_for_area(a) for a in (2, 5, 10, 30)] == [2, 3, 4, 5]


def test_fcm_separates_two_clusters_and_is_deterministic():
    rng = np.random.default_rng(0)
    data = np.concatenate([rng.normal(0, 0.1, 200), rng.normal(5, 0.1, 200)])[None, :]
    u1, centroids, _ = fuzzy_c_means(data, 2)
    u2, _, _ = fuzzy_c_means(data, 2)
    assert np.array_equal(u1, u2)
    labels = defuzzify(u1)
    assert len(set(labels[:200])) == 1 and len(set(labels[200:])) == 1 and labels[0] != labels[-1]
    assert sorted(np.round(centroids[:, 0])) == [0, 5]
    assert np.allclose(u1.sum(axis=0), 1)
    assert fpi(u1) < 0.1 and nce(u1) < 0.1


def test_kmeans_and_auto_k_find_three_groups():
    rng = np.random.default_rng(3)
    data = np.concatenate([rng.normal(c, 0.05, 150) for c in (0, 1, 2)])[None, :]
    labels = kmeans(data, 3)
    assert len(set(labels.tolist())) == 3
    assert all(len(set(labels[i * 150 : (i + 1) * 150].tolist())) == 1 for i in range(3))
    # The rank-sum over FPI, NCE and silhouette finds the three groups; the soil planner's
    # default leans towards more zones while the silhouette stays above 0.55.
    assert select_optimal_k(data, 2, 5, prefer_more_zones=False) == 3
    assert select_optimal_k(data, 2, 5) >= 3


def test_equal_area_segments_split_by_rank():
    values = np.arange(100, dtype=float)
    labels = segment_equal_number_pixels(values, 4)
    assert labels[0] == 0 and labels[-1] == 3
    assert np.all(np.diff(labels) >= 0)
    assert abs((labels == 1).sum() - 33) <= 1


def test_feature_preserving_smoothing_keeps_edges_and_removes_noise():
    rng = np.random.default_rng(2)
    step = np.where(np.arange(40)[None, :] < 20, 0.3, 0.8).repeat(40, axis=0)
    noisy = step + rng.normal(0, 0.03, step.shape)
    smooth = feature_preserving_smoothing(noisy, max_norm_diff=20, max_z_diff=0.1, num_iter=5)
    assert smooth[:, 3:17].std() < noisy[:, 3:17].std()
    assert smooth[:, :18].mean() < 0.35 and smooth[:, 22:].mean() > 0.75


def test_cleanup_helpers():
    classes = np.zeros((10, 10), dtype=np.int16)
    classes[:, 5:] = 1
    classes[2, 2] = 1  # single-pixel speck
    assert majority_filter(classes, 2)[2, 2] == 0

    classes[2, 2] = 1
    merge_small_components(classes, 2, 5)
    assert classes[2, 2] == 0

    pinch = np.array([[0, 1], [1, 0]], dtype=np.int16)
    fix_kws_polygons(pinch)
    assert ndimage.label(pinch == pinch[0, 0], structure=FOUR)[1] == 1

    one = np.zeros((6, 6), dtype=np.int16)
    assert ensure_class_count(one, 3) == 2
    assert set(np.unique(one).tolist()) == {0, 1, 2}

    tiny = np.zeros((20, 20), dtype=np.int16)
    tiny[0, 0] = 1
    rebalance_min_share(tiny, 2)
    assert (tiny == 1).sum() >= 100


@pytest.mark.parametrize("method", ["fcm", "kmeans", "segment", "probe", "probe-v2"])
def test_zonate_follows_the_bands_and_covers_the_field(method):
    grid = field_grid(FIELD)
    zones = zonate(three_bands(grid), grid, ZonationParams(method=method, zone_count=3))
    assert [z.number for z in zones] == [1, 2, 3]
    means = [z.mean_value for z in zones]
    assert means == sorted(means)
    total = sum(z.area_ha for z in zones)
    assert total == pytest.approx(grid.geometry.area / 10_000, rel=0.01)
    if method == "segment":
        # lvl0's rank mapping rounds to the nearest class: the outer classes get a quarter
        # of the pixels each, the middle one half.
        assert zones[1].area_ha > zones[0].area_ha and zones[1].area_ha > zones[2].area_ha
    if method.startswith("probe"):
        assert all(len(z.geometry.geoms) == 1 for z in zones)
        assert all(z.area_ha >= total / 3 / 2 * 0.9 for z in zones)


def test_auto_zone_count_respects_the_field_size_cap():
    grid = field_grid(FIELD)
    zones = zonate(three_bands(grid), grid, ZonationParams(method="fcm", zone_count=None))
    assert 2 <= len(zones) <= k_max_for_area(grid.geometry.area / 10_000)


def test_single_zone_is_the_whole_field():
    grid = field_grid(FIELD)
    zones = zonate(three_bands(grid), grid, ZonationParams(method="kmeans", zone_count=1))
    assert len(zones) == 1
    assert zones[0].area_ha == pytest.approx(grid.geometry.area / 10_000, rel=0.01)


def test_missing_values_are_filled():
    grid = field_grid(FIELD)
    values = three_bands(grid)
    values[5:10, 5:10] = np.nan
    result = classify_grid(values, grid.mask(), grid.mask(), ZonationParams(method="fcm", zone_count=3))
    assert (result.classes[grid.mask()] >= 0).all()
