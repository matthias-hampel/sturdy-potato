"""Readers that put one Sentinel-2 acquisition onto a field grid.

Two sources produce the same result (a clear-sky mask and NDVI/NDRE/NDMI on the field's
10 m grid):

* ``EarthSearchScene``: an L2A item of Earth Search's ``sentinel-2-c1-l2a`` collection,
  read straight from the cloud-hosted COGs. Only the blocks covering the field are fetched.
  Cloud masking matches ``sentinel-archive`` (SCL 4/5/6 kept, a buffer around SCL
  3/8/9/10 removed as haze).
* ``ArchiveScene``: index COGs written by ``sentinel-archive derive`` (already masked).
"""

import logging
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.vrt import WarpedVRT
from rasterio.warp import reproject
from scipy.ndimage import distance_transform_edt

from .fieldgrid import FieldGrid

log = logging.getLogger("agmeo_geo.sources")

SCL_VALID = [4, 5, 6]
SCL_CLOUD = [3, 8, 9, 10]
# Earth Search asset keys for the bands the indices need.
BANDS = {"red": "B04", "nir": "B08", "rededge1": "B05", "nir08": "B8A", "swir16": "B11"}
INDICES = ("ndvi", "ndre", "ndmi")

# Remote COG access: no directory listings, merged range requests, HTTP/2, anonymous S3.
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
    "GDAL_CACHEMAX": 512,
    "AWS_NO_SIGN_REQUEST": "YES",
}


def _nd(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        total = a + b
        return np.where(total > 0, (a - b) / total, np.nan)


def _warp(dataset, grid: FieldGrid, resampling: Resampling) -> np.ndarray:
    nodata = dataset.nodata if dataset.nodata is not None else 0
    with WarpedVRT(
        dataset,
        crs=grid.crs,
        transform=grid.transform,
        width=grid.width,
        height=grid.height,
        resampling=resampling,
        src_nodata=nodata,
        nodata=nodata,
    ) as vrt:
        return vrt.read()


def clear_on_grid(scl: np.ndarray, context: FieldGrid, grid: FieldGrid, buffer_m: float) -> np.ndarray:
    """Clear-sky mask on the field grid from SCL classes on a larger context grid."""
    valid = np.isin(scl, SCL_VALID)
    cloud = np.isin(scl, SCL_CLOUD)
    if buffer_m > 0 and cloud.any():
        valid &= distance_transform_edt(~cloud, sampling=context.transform.a) > buffer_m
    out = np.zeros(grid.shape, dtype="uint8")
    # In-memory arrays with explicit transforms; rasterio still warns about the temporary datasets.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        _reproject_mask(valid, out, context, grid)
    return out.astype(bool)


def _reproject_mask(valid: np.ndarray, out: np.ndarray, context: FieldGrid, grid: FieldGrid) -> None:
    reproject(
        valid.astype("uint8"),
        out,
        src_transform=context.transform,
        src_crs=context.crs,
        dst_transform=grid.transform,
        dst_crs=grid.crs,
        resampling=Resampling.nearest,
    )


@dataclass(frozen=True)
class Asset:
    href: str
    scale: float = 1.0
    offset: float = 0.0


@dataclass(frozen=True)
class StacItem:
    id: str
    acquired_at: datetime
    platform: str
    cloud_cover: float | None
    epsg: int | None
    tile: str | None
    geometry: dict
    assets: dict[str, Asset]

    @property
    def day(self) -> str:
        return self.acquired_at.date().isoformat()


class EarthSearchScene:
    """Datasets are opened once per acquisition and shared by all fields read from it."""

    def __init__(self, item: StacItem, cloud_buffer_m: float):
        self.item = item
        self.cloud_buffer_m = cloud_buffer_m
        self._open: dict[str, rasterio.DatasetReader] = {}

    def __enter__(self):
        self._env = rasterio.Env(**GDAL_ENV)
        self._env.__enter__()
        return self

    def __exit__(self, *exc):
        for dataset in self._open.values():
            dataset.close()
        self._env.__exit__(*exc)
        return False

    def _dataset(self, key: str):
        if key not in self._open:
            self._open[key] = rasterio.open(self.item.assets[key].href)
        return self._open[key]

    def clear(self, grid: FieldGrid) -> np.ndarray:
        context = grid.context(self.cloud_buffer_m + 40, 20.0)
        scl = _warp(self._dataset("scl"), context, Resampling.nearest)[0]
        return clear_on_grid(scl, context, grid, self.cloud_buffer_m)

    def _reflectance(self, key: str, grid: FieldGrid) -> np.ndarray:
        asset = self.item.assets[key]
        dn = _warp(self._dataset(key), grid, Resampling.nearest)[0].astype("float64")
        return np.where(dn > 0, dn * asset.scale + asset.offset, np.nan)

    def indices(self, grid: FieldGrid, clear: np.ndarray) -> dict[str, np.ndarray]:
        r = {key: self._reflectance(key, grid) for key in BANDS}
        layers = {
            "ndvi": _nd(r["nir"], r["red"]),
            "ndre": _nd(r["nir08"], r["rededge1"]),
            "ndmi": _nd(r["nir"], r["swir16"]),
        }
        return {name: np.where(clear, layer, np.nan) for name, layer in layers.items()}

    def rgb(self, grid: FieldGrid) -> np.ndarray | None:
        if "visual" not in self.item.assets:
            return None
        return _warp(self._dataset("visual"), grid, Resampling.nearest)


class ArchiveScene:
    """Index COGs of the local archive; NaN marks masked pixels."""

    def __init__(self, scene_dir: Path, assets: dict):
        self.dir = scene_dir
        self.assets = assets
        self._open: dict[Path, rasterio.DatasetReader] = {}
        self._layers: dict[tuple, np.ndarray] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        for dataset in self._open.values():
            dataset.close()
        return False

    def _layer(self, index: str, grid: FieldGrid) -> np.ndarray | None:
        key = (grid.crs, tuple(grid.transform), grid.width, grid.height, index)
        if key not in self._layers:
            asset = self.assets.get(index)
            path = self.dir / asset["path"] if asset else None
            if path is None or not path.exists():
                return None
            if path not in self._open:
                self._open[path] = rasterio.open(path)
            data = _warp(self._open[path], grid, Resampling.nearest)[int(asset["band"]) - 1]
            self._layers[key] = data.astype("float64")
        return self._layers[key]

    def clear(self, grid: FieldGrid) -> np.ndarray:
        ndvi = self._layer("ndvi", grid)
        return np.zeros(grid.shape, bool) if ndvi is None else np.isfinite(ndvi)

    def indices(self, grid: FieldGrid, clear: np.ndarray) -> dict[str, np.ndarray]:
        out = {}
        for index in INDICES:
            layer = self._layer(index, grid)
            if layer is not None:
                out[index] = np.where(clear, layer, np.nan)
        return out

    def rgb(self, grid: FieldGrid) -> None:
        return None
