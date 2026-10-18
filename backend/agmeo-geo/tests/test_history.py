from datetime import UTC, datetime

import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box, mapping

from agmeo_geo.fieldgrid import RESOLUTION, FieldGrid, field_grid, grid_stats, read_layer, write_raster
from agmeo_geo.history import best_per_acquisition
from agmeo_geo.observe import FieldTarget
from agmeo_geo.sources import Asset, StacItem, clear_on_grid
from agmeo_geo.stac import parse_item

# A 300 × 200 m field near Marschhof (UTM 32N).
FIELD = {
    "type": "Polygon",
    "coordinates": [
        [[7.285, 53.299], [7.2895, 53.299], [7.2895, 53.3008], [7.285, 53.3008], [7.285, 53.299]]
    ],
}


def test_field_grid_is_aligned_and_in_the_fields_utm_zone():
    grid = field_grid(FIELD)
    assert grid.crs == "EPSG:32632"
    assert grid.transform.a == RESOLUTION and grid.transform.e == -RESOLUTION
    assert grid.transform.c % RESOLUTION == 0 and grid.transform.f % RESOLUTION == 0
    x0, y0, x1, y1 = grid.bounds()
    fx0, fy0, fx1, fy1 = grid.geometry.bounds
    assert x0 <= fx0 - 20 and x1 >= fx1 + 20 and y0 <= fy0 - 20 and y1 >= fy1 + 20
    # Same boundary, same grid.
    assert field_grid(FIELD) == grid


def test_grid_stats_counts_nan_as_unclear():
    values = np.array([[0.5, 0.7], [np.nan, 0.9]])
    stats = grid_stats(values, np.ones((2, 2), bool))
    assert stats.valid_pixels == 3 and stats.total_pixels == 4
    assert stats.mean == pytest.approx(0.7)


def test_raster_round_trip(tmp_path):
    grid = field_grid(FIELD)
    ndvi = np.linspace(-0.2, 0.95, grid.width * grid.height).reshape(grid.shape)
    ndvi[0, 0] = np.nan
    write_raster(tmp_path / "r.tif", grid, {"ndvi": ndvi, "ndmi": ndvi / 2})
    back = read_layer(tmp_path / "r.tif", "ndmi")
    assert np.isnan(back[0, 0])
    assert np.nanmax(np.abs(back - ndvi / 2)) < 1e-4


def test_cloud_buffer_removes_haze_around_clouds():
    # 2 km context at 20 m with a cloud in the middle; field grid covers the centre.
    context = FieldGrid("EPSG:32632", Affine(20, 0, 0, 0, -20, 2000), 100, 100, box(0, 0, 2000, 2000))
    grid = FieldGrid("EPSG:32632", Affine(10, 0, 0, 0, -10, 2000), 200, 200, box(0, 0, 2000, 2000))
    scl = np.full((100, 100), 4, dtype="uint8")
    scl[45:55, 45:55] = 9  # 200 m cloud at the centre
    clear = clear_on_grid(scl, context, grid, buffer_m=300)
    assert not clear[100, 100]  # in the cloud
    assert not clear[100, 130]  # ~200 m from its edge: haze buffer
    assert clear[100, 190] and clear[10, 10]  # far away
    assert clear_on_grid(scl, context, grid, buffer_m=0)[100, 130]


def test_water_is_not_clear():
    context = FieldGrid("EPSG:32632", Affine(20, 0, 0, 0, -20, 2000), 100, 100, box(0, 0, 2000, 2000))
    grid = FieldGrid("EPSG:32632", Affine(10, 0, 0, 0, -10, 2000), 200, 200, box(0, 0, 2000, 2000))
    scl = np.full((100, 100), 5, dtype="uint8")
    scl[:, :50] = 6  # western half classified as water
    clear = clear_on_grid(scl, context, grid, buffer_m=300)
    assert not clear[100, 20]
    assert clear[100, 180]


def item(id_, day, platform="sentinel-2a", epsg=32632, cloud=10.0, geometry=None):
    return StacItem(
        id=id_,
        acquired_at=datetime.fromisoformat(f"{day}T10:30:00+00:00").astimezone(UTC),
        platform=platform,
        cloud_cover=cloud,
        epsg=epsg,
        tile=None,
        geometry=geometry or mapping(box(7.0, 53.0, 8.0, 54.0)),
        assets={},
    )


def test_one_item_per_acquisition_preferring_the_fields_utm_zone():
    target = FieldTarget("f", "o", "g", FIELD)
    items = [
        item("a-31", "2025-05-01", epsg=32631, cloud=1),
        item("a-32", "2025-05-01", epsg=32632, cloud=30),
        item("b-32", "2025-05-01", platform="sentinel-2b"),
        # Footprint only partly covers the field: the other tile wins.
        item("c-edge", "2025-05-04", geometry=mapping(box(7.287, 53.0, 8.0, 54.0)), cloud=0),
        item("c-full", "2025-05-04", cloud=50),
    ]
    chosen = [i.id for i in best_per_acquisition(items, target)]
    assert sorted(chosen) == ["a-32", "b-32", "c-full"]


def test_parse_item_reads_scale_and_offset():
    feature = {
        "id": "S2B_T32ULE_20250501T104619_L2A",
        "geometry": mapping(box(7, 53, 8, 54)),
        "properties": {
            "datetime": "2025-05-01T10:49:14.123000Z",
            "platform": "sentinel-2b",
            "eo:cloud_cover": 2.4,
            "proj:epsg": 32632,
            "grid:code": "MGRS-32ULE",
        },
        "assets": {
            key: {"href": f"https://x/{key}.tif", "raster:bands": [{"scale": 0.0001, "offset": -0.1}]}
            for key in ("blue", "red", "nir", "rededge1", "nir08", "swir16", "swir22", "scl", "visual")
        },
    }
    parsed = parse_item(feature)
    assert parsed.tile == "T32ULE" and parsed.day == "2025-05-01"
    assert parsed.assets["red"] == Asset("https://x/red.tif", 0.0001, -0.1)
    del feature["assets"]["scl"]
    assert parse_item(feature) is None
