"""The 10 m grid of a field boundary, and what is computed on it.

Every acquisition of a field is resampled onto the same grid (the field's own UTM zone,
aligned to 10 m), whatever tile, UTM zone or source it came from. Statistics, map tiles and
the multi-year productivity analysis all work on these aligned field rasters.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry

from .zonal import FieldStats, analysis_area

RESOLUTION = 10.0
MARGIN_M = 20.0
# Field rasters store indices as int16 × 10⁻⁴ (−3.2768 … 3.2767 covers every index).
SCALE = 1e-4
NODATA = -32768


def utm_epsg(lon: float, lat: float) -> int:
    zone = min(60, int((lon + 180) // 6) + 1)
    return (32600 if lat >= 0 else 32700) + zone


@dataclass(frozen=True)
class FieldGrid:
    crs: str
    transform: Affine
    width: int
    height: int
    geometry: BaseGeometry  # field boundary in the grid CRS

    @property
    def shape(self) -> tuple[int, int]:
        return self.height, self.width

    def bounds(self) -> tuple[float, float, float, float]:
        x0, y1 = self.transform.c, self.transform.f
        return x0, y1 - self.height * RESOLUTION, x0 + self.width * RESOLUTION, y1

    def context(self, margin_m: float, resolution: float = 20.0) -> "FieldGrid":
        """A coarser grid around this one, e.g. for cloud buffers that reach beyond the field."""
        x0, y0, x1, y1 = self.bounds()
        x0, y0 = _snap_down(x0 - margin_m, resolution), _snap_down(y0 - margin_m, resolution)
        x1, y1 = _snap_up(x1 + margin_m, resolution), _snap_up(y1 + margin_m, resolution)
        return FieldGrid(
            self.crs,
            Affine(resolution, 0, x0, 0, -resolution, y1),
            round((x1 - x0) / resolution),
            round((y1 - y0) / resolution),
            self.geometry,
        )

    def mask(self, geometry: BaseGeometry | None = None, all_touched: bool = False) -> np.ndarray:
        """True for pixels whose centre lies inside the geometry (default: the field)."""
        return geometry_mask(
            [mapping(geometry or self.geometry)],
            out_shape=self.shape,
            transform=self.transform,
            invert=True,
            all_touched=all_touched,
        )


def _snap_down(v: float, step: float) -> float:
    return float(np.floor(v / step) * step)


def _snap_up(v: float, step: float) -> float:
    return float(np.ceil(v / step) * step)


def field_grid(geometry_wgs84: dict) -> FieldGrid:
    lon, lat = shape(geometry_wgs84).centroid.coords[0]
    crs = f"EPSG:{utm_epsg(lon, lat)}"
    geometry = shape(transform_geom("EPSG:4326", crs, geometry_wgs84))
    x0, y0, x1, y1 = geometry.bounds
    x0, y0 = _snap_down(x0 - MARGIN_M, RESOLUTION), _snap_down(y0 - MARGIN_M, RESOLUTION)
    x1, y1 = _snap_up(x1 + MARGIN_M, RESOLUTION), _snap_up(y1 + MARGIN_M, RESOLUTION)
    return FieldGrid(
        crs,
        Affine(RESOLUTION, 0, x0, 0, -RESOLUTION, y1),
        round((x1 - x0) / RESOLUTION),
        round((y1 - y0) / RESOLUTION),
        geometry,
    )


def grid_stats(values: np.ndarray, analysis: np.ndarray) -> FieldStats:
    """Statistics of the finite pixels in the analysis mask; non-finite ones count as unclear."""
    total = int(analysis.sum())
    if total == 0:
        return FieldStats(None, None, None, None, None, 0, 0)
    inside = values[analysis]
    inside = inside[np.isfinite(inside)]
    if inside.size == 0:
        return FieldStats(None, None, None, None, None, 0, total)
    p10, median, p90 = np.percentile(inside, [10, 50, 90])
    return FieldStats(
        mean=float(inside.mean()),
        median=float(median),
        p10=float(p10),
        p90=float(p90),
        stddev=float(inside.std()),
        valid_pixels=int(inside.size),
        total_pixels=total,
    )


def analysis_mask(grid: FieldGrid, inner_buffer_m: float) -> np.ndarray:
    return grid.mask(analysis_area(grid.geometry, inner_buffer_m))


def write_raster(path: Path, grid: FieldGrid, layers: dict[str, np.ndarray]) -> list[str]:
    """Writes the index layers (float, NaN = no value) as scaled int16; returns the band order."""
    names = list(layers)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.tif")
    profile = {
        "driver": "GTiff",
        "width": grid.width,
        "height": grid.height,
        "count": len(names),
        "dtype": "int16",
        "crs": grid.crs,
        "transform": grid.transform,
        "nodata": NODATA,
        "compress": "deflate",
        "predictor": 2,
    }
    with rasterio.open(tmp, "w", **profile) as dst:
        for i, name in enumerate(names, start=1):
            data = layers[name]
            scaled = np.where(np.isfinite(data), np.round(np.clip(data, -3.2767, 3.2767) / SCALE), NODATA)
            dst.write(scaled.astype("int16"), i)
            dst.set_band_description(i, name)
        dst.scales = [SCALE] * len(names)
    tmp.replace(path)
    return names


def write_rgb(path: Path, grid: FieldGrid, rgb: np.ndarray) -> None:
    """True colour (3 × uint8, 0 = no data)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.tif")
    profile = {
        "driver": "GTiff",
        "width": grid.width,
        "height": grid.height,
        "count": 3,
        "dtype": "uint8",
        "crs": grid.crs,
        "transform": grid.transform,
        "nodata": 0,
        "compress": "deflate",
        "photometric": "RGB",
    }
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(rgb)
    tmp.replace(path)


def read_layer(path: Path, name: str) -> np.ndarray:
    """One index layer of a field raster as float with NaN for no value."""
    with rasterio.open(path) as src:
        band = list(src.descriptions).index(name) + 1
        data = src.read(band)
    return np.where(data == NODATA, np.nan, data * SCALE)
