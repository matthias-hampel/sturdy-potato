import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from agmeo_geo.colormaps import SCALES, colormap
from agmeo_geo.zonal import field_stats

# 100 x 100 pixels of 10 m in UTM 32N, origin at E 560000 / N 5800000 (Lower Saxony).
ORIGIN = (560000.0, 5800000.0)


@pytest.fixture
def raster(tmp_path):
    data = np.full((100, 100), 0.8, dtype="float32")
    data[:, 50:] = 0.4  # eastern half
    data[0:20, 0:20] = np.nan  # a "cloud" in the north-west corner
    path = tmp_path / "ndvi.tif"
    profile = {
        "driver": "GTiff",
        "width": 100,
        "height": 100,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:32632",
        "transform": from_origin(*ORIGIN, 10, 10),
        "nodata": np.nan,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
    with rasterio.open(path) as dataset:
        yield dataset


def square(x0, y0, size):
    """WGS 84 polygon of a UTM square; corners converted with rasterio."""
    from rasterio.warp import transform_geom

    utm = {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x0 + size, y0], [x0 + size, y0 - size], [x0, y0 - size], [x0, y0]]],
    }
    return transform_geom("EPSG:32632", "EPSG:4326", utm)


def test_uniform_field(raster):
    stats = field_stats(raster, 1, square(ORIGIN[0] + 250, ORIGIN[1] - 250, 200), inner_buffer_m=0)
    assert stats.valid_fraction == pytest.approx(1.0)
    assert stats.mean == pytest.approx(0.8, abs=1e-6)
    assert stats.p10 == stats.p90 == pytest.approx(0.8, abs=1e-6)
    assert stats.total_pixels == pytest.approx(400, rel=0.05)


def test_field_across_two_zones(raster):
    # 300 m square centred on the zone boundary at x = 500 m.
    stats = field_stats(raster, 1, square(ORIGIN[0] + 350, ORIGIN[1] - 300, 300), inner_buffer_m=0)
    assert stats.mean == pytest.approx(0.6, abs=0.02)
    assert stats.p10 == pytest.approx(0.4, abs=1e-6)
    assert stats.p90 == pytest.approx(0.8, abs=1e-6)


def test_cloud_reduces_coverage(raster):
    # 300 m square over the north-west corner; the 200 m cloud covers 4/9 of it.
    stats = field_stats(raster, 1, square(ORIGIN[0], ORIGIN[1], 300), inner_buffer_m=0)
    assert stats.valid_fraction == pytest.approx(5 / 9, abs=0.02)
    assert stats.mean == pytest.approx(0.8, abs=1e-6)


def test_inner_buffer_excludes_edge_pixels(raster):
    # Field straddles the zone boundary by 10 m; the 10 m inward buffer removes the strip.
    stats = field_stats(raster, 1, square(ORIGIN[0] + 290, ORIGIN[1] - 300, 220), inner_buffer_m=10)
    assert stats.mean == pytest.approx(0.8, abs=1e-6)


def test_outside_raster(raster):
    assert field_stats(raster, 1, square(ORIGIN[0] + 5000, ORIGIN[1] - 5000, 100)) is None


def test_colormap_is_sequential():
    for index in SCALES:
        cmap = colormap(index)
        assert len(cmap) == 256
        # Monotonically darker: perceived lightness of the first stop above the last.
        light = sum(cmap[0][:3])
        dark = sum(cmap[255][:3])
        assert light > dark
