"""Zonal statistics of an index raster over a field boundary."""

from dataclasses import dataclass

import numpy as np
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds
from shapely.geometry import mapping, shape

ZONAL_VERSION = "zonal-1"


@dataclass(frozen=True)
class FieldStats:
    mean: float | None
    median: float | None
    p10: float | None
    p90: float | None
    stddev: float | None
    valid_pixels: int
    total_pixels: int
    # Quartile-like bounds the scene statistics show (the reference's q20/q80).
    p20: float | None = None
    p80: float | None = None

    @property
    def valid_fraction(self) -> float:
        return self.valid_pixels / self.total_pixels if self.total_pixels else 0.0


def analysis_area(geometry_utm, inner_buffer_m: float):
    """Shrink the boundary to avoid mixed pixels at hedges, ditches and tracks.

    Small or narrow fields keep their full boundary when the buffer would remove more than half.
    """
    inner = geometry_utm.buffer(-inner_buffer_m)
    return inner if not inner.is_empty and inner.area >= 0.5 * geometry_utm.area else geometry_utm


def field_stats(dataset, band: int, geometry_wgs84: dict, inner_buffer_m: float = 10.0) -> FieldStats | None:
    """Statistics of the pixels whose centres fall inside the (buffered) field.

    NaN pixels (cloud, shadow, haze buffer, outside the swath) count against coverage.
    Returns None when the field does not overlap the raster at all.
    """
    area = analysis_area(shape(transform_geom("EPSG:4326", dataset.crs, geometry_wgs84)), inner_buffer_m)
    window = from_bounds(*area.bounds, transform=dataset.transform)
    window = Window(
        int(np.floor(window.col_off)) - 1,
        int(np.floor(window.row_off)) - 1,
        int(np.ceil(window.width)) + 3,
        int(np.ceil(window.height)) + 3,
    )
    raster = Window(0, 0, dataset.width, dataset.height)
    if (
        window.col_off >= raster.width
        or window.row_off >= raster.height
        or window.col_off + window.width <= 0
        or window.row_off + window.height <= 0
    ):
        return None
    data = dataset.read(band, window=window, boundless=True, fill_value=np.nan, masked=False).astype(
        "float64"
    )
    inside = geometry_mask(
        [mapping(area)], out_shape=data.shape, transform=dataset.window_transform(window), invert=True
    )
    total = int(inside.sum())
    if total == 0:
        return None
    values = data[inside]
    values = values[np.isfinite(values)]
    if values.size == 0:
        return FieldStats(None, None, None, None, None, 0, total)
    p10, p20, median, p80, p90 = np.percentile(values, [10, 20, 50, 80, 90])
    return FieldStats(
        mean=float(values.mean()),
        median=float(median),
        p10=float(p10),
        p90=float(p90),
        p20=float(p20),
        p80=float(p80),
        stddev=float(values.std()),
        valid_pixels=int(values.size),
        total_pixels=total,
    )
