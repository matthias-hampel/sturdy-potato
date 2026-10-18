import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from affine import Affine
from fastapi.testclient import TestClient
from rasterio.io import MemoryFile
from shapely.geometry import box

from agmeo_geo import tiles
from agmeo_geo.config import Settings
from agmeo_geo.fieldgrid import FieldGrid, write_raster
from agmeo_geo.tiles import relative_bytes

DAY = "2025-06-01"
# Web Mercator tile z12/2048/2047 spans x, y = 0 .. 9784 m; one tile pixel is ~38.2 m.
TILE = "12/2048/2047"


def square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    # 2560 m field raster at the origin: western half masked, eastern half NDVI 0.7.
    grid = FieldGrid("EPSG:3857", Affine(10, 0, 0, 0, -10, 2560), 256, 256, box(0, 0, 2560, 2560))
    ndvi = np.full((256, 256), 0.7)
    ndvi[:, :128] = np.nan
    write_raster(tmp_path / "rasters/f/a.tif", grid, {"ndvi": ndvi})

    # Organization "a" has one field over the raster's north-east quarter; "b" has none.
    fields = {"a": [square(1280, 1280, 2560, 2560)], "b": []}

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params):
            class Result:
                def fetchall(self):
                    if params["day"] != DAY:
                        return []
                    return [
                        {
                            "id": "f",
                            "geometry": json.dumps(g),
                            "path": "rasters/f/a.tif",
                            "bands": ["ndvi"],
                            "has_rgb": False,
                        }
                        for g in fields[params["org"]]
                    ]

            return Result()

    monkeypatch.setattr(tiles, "connect", lambda _settings: FakeConn())
    settings = Settings(
        database_url="", nats_url="", archive=Path(tmp_path), tiles_host="", tiles_port=0, scan_interval_s=0
    )
    return TestClient(tiles.create_app(replace(settings, data_dir=tmp_path)))


def alpha(png: bytes) -> np.ndarray:
    with MemoryFile(png) as memory, memory.open() as image:
        return image.read(image.count)


def test_tile_is_clipped_to_the_organization_fields(client):
    response = client.get(f"/imagery/{DAY}/ndvi/{TILE}.png?organization=a")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    a = alpha(response.content)
    # Row ~205 / column ~50 lies in the field and in valid data: visible.
    assert a[205, 50] == 255
    # Same valid data south of the field (row ~240): clipped away.
    assert a[240, 50] == 0
    # Inside the field's row band but in the masked western half: transparent.
    assert a[205, 20] == 0


def test_relative_stretch_renders(client):
    response = client.get(f"/imagery/{DAY}/ndvi/{TILE}.png?organization=a&stretch=relative")
    assert response.status_code == 200
    assert alpha(response.content)[205, 50] == 255


def test_no_raster_gives_empty_tile(client):
    response = client.get(f"/imagery/{DAY}/ndvi/{TILE}.png?organization=b")
    assert alpha(response.content).max() == 0
    response = client.get(f"/imagery/2020-01-01/ndvi/{TILE}.png?organization=a")
    assert alpha(response.content).max() == 0


def test_unknown_layer_and_missing_organization(client):
    assert client.get(f"/imagery/{DAY}/savi/{TILE}.png?organization=a").status_code == 404
    assert client.get(f"/imagery/{DAY}/ndvi/{TILE}.png").status_code == 422
    assert client.get(f"/imagery/{DAY}/ndvi/{TILE}.png?organization=a&stretch=x").status_code == 422


def test_relative_bytes_centres_the_median():
    values = np.array([0.2, 0.5, 0.8, 1.2])
    assert list(relative_bytes(values, 0.2, 0.5, 0.8)) == [0, 127, 255, 255]
