"""Windowed SAFE processing; read JP2s directly inside the preserved ZIP."""

import hashlib
import json
import math
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile
from contextlib import ExitStack
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.shutil import copy as raster_copy
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_geom
from rasterio.windows import Window
from scipy.ndimage import distance_transform_edt
from shapely.geometry import mapping

from .indices import FORMULAS, INPUTS, NATIVE_10M, calculate

BAND_ORDER = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B09", "B10", "B11", "B12"]
BANDS = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B11", "B12"]
VERSION = "3"
# Vegetation and bare soil; water (6) is not a clear view of a field. 3: water excluded.
SCL_VALID = [4, 5]
# Cloud shadow, medium/high-probability cloud and thin cirrus; haze around them is not classified.
SCL_CLOUD = [3, 8, 9, 10]


def reflectance_metadata(xml):
    root = ET.fromstring(xml)
    # SAFE has mixed namespaced/unqualified elements across versions.
    for element in root.iter():
        element.tag = element.tag.split("}")[-1]
    quantification = root.find(".//BOA_QUANTIFICATION_VALUE")
    if quantification is None or float(quantification.text) <= 0:
        raise ValueError("Missing/invalid BOA_QUANTIFICATION_VALUE")
    quantification = float(quantification.text)
    offsets = {
        BAND_ORDER[int(el.attrib["band_id"])]: float(el.text) for el in root.findall(".//BOA_ADD_OFFSET")
    }
    baseline = root.findtext(".//PROCESSING_BASELINE")
    if baseline is None:
        raise ValueError("Missing processing baseline")
    if float(baseline) >= 4.0 and any(b not in offsets for b in BANDS):
        raise ValueError("Baseline >=04.00 requires explicit BOA offsets for every input band")
    return quantification, {b: offsets.get(b, 0.0) for b in BANDS}, baseline


def band_paths(names):
    result = {}
    for band in [*BANDS, "SCL"]:
        resolution = 10 if band in ("B02", "B03", "B04", "B08") else 20
        matches = [n for n in names if re.search(rf"_{band}_{resolution}m\.jp2$", n)]
        if len(matches) != 1:
            raise ValueError(f"Expected one {band} at {resolution}m; found {len(matches)}")
        result[band] = matches[0]
    return result


def clear_pixels(scl, window, buffer_m, pixel_m):
    """SCL_VALID pixels in window that are more than buffer_m from any SCL_CLOUD pixel.

    Reads a halo of buffer_m around the window, so the result does not depend on window edges.
    Clouds outside the tile are not seen.
    """
    halo = math.ceil(buffer_m / pixel_m)
    top, left = max(window.row_off - halo, 0), max(window.col_off - halo, 0)
    bottom = min(window.row_off + window.height + halo, scl.height)
    right = min(window.col_off + window.width + halo, scl.width)
    classes = scl.read(1, window=Window(left, top, right - left, bottom - top))
    inner = (
        slice(window.row_off - top, window.row_off - top + window.height),
        slice(window.col_off - left, window.col_off - left + window.width),
    )
    valid = np.isin(classes[inner], SCL_VALID)
    cloud = np.isin(classes, SCL_CLOUD)
    if buffer_m > 0 and cloud.any():
        valid &= distance_transform_edt(~cloud, sampling=pixel_m)[inner] > buffer_m
    return valid


def process(source, output, selected, aoi=None, resolution=20, cloud_buffer=300):
    source, output = Path(source).resolve(), Path(output).resolve()
    unknown = set(selected) - FORMULAS.keys()
    if not selected or unknown:
        raise ValueError(f"Unknown/empty index selection: {sorted(unknown)}")
    if resolution not in (10, 20):
        raise ValueError("Resolution must be 10 or 20 m")
    if not 0 <= cloud_buffer <= 5000:
        raise ValueError("Cloud buffer must be 0..5000 m")
    coarse = [name for name in selected if name not in NATIVE_10M]
    if resolution == 10 and coarse:
        raise ValueError(f"{', '.join(coarse)} use 20 m bands; process them at 20 m")
    needed = sorted({band for name in selected for band in INPUTS[name]})
    if output.exists():
        raise ValueError("Output already exists; choose a new filename to preserve provenance")
    with zipfile.ZipFile(source) as archive:
        metadata = [n for n in archive.namelist() if n.endswith("/MTD_MSIL2A.xml")]
        if len(metadata) != 1:
            raise ValueError("Expected a single L2A product metadata file")
        quantification, offsets, baseline = reflectance_metadata(archive.read(metadata[0]))
        paths = band_paths(archive.namelist())
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".working.tif")
    finalizing = output.with_suffix(".part.tif")
    try:
        with ExitStack() as stack:
            rasters = {
                b: stack.enter_context(rasterio.open(f"/vsizip/{source}/{name}")) for b, name in paths.items()
            }
            reference = rasters["B04" if resolution == 10 else "B05"]
            # Need room for the working raster and COG. Conservative uncompressed estimate.
            required = reference.width * reference.height * len(selected) * 4 * 2 + 2_000_000_000
            if shutil.disk_usage(output.parent).free < required:
                raise OSError("Insufficient space for index raster and COG conversion")
            aligned = {
                b: stack.enter_context(
                    WarpedVRT(
                        dataset,
                        crs=reference.crs,
                        transform=reference.transform,
                        width=reference.width,
                        height=reference.height,
                        src_nodata=0,
                        nodata=0,
                        dtype="float32",
                        resampling=Resampling.nearest if b == "SCL" else Resampling.average,
                    )
                )
                for b, dataset in rasters.items()
                if b in needed or b == "SCL"
            }
            region = transform_geom("EPSG:4326", reference.crs, mapping(aoi)) if aoi is not None else None
            profile = {
                "driver": "GTiff",
                "width": reference.width,
                "height": reference.height,
                "crs": reference.crs,
                "transform": reference.transform,
                "count": len(selected),
                "dtype": "float32",
                "nodata": np.nan,
                "tiled": True,
                "blockxsize": 512,
                "blockysize": 512,
                "compress": "deflate",
                "predictor": 3,
                "BIGTIFF": "IF_SAFER",
            }
            with rasterio.open(temporary, "w", **profile) as destination:
                destination.update_tags(
                    source_product=source.name,
                    processing_version=VERSION,
                    processing_baseline=baseline,
                    grid=f"native tile UTM, {resolution}m",
                    cloud_mask=f"SCL classes {','.join(map(str, SCL_VALID))} retained; {cloud_buffer:g} m buffer around SCL 3,8,9,10",
                    reflectance="(DN+offset)/quantification",
                    aoi="configured boundary" if aoi is not None else "full tile",
                )
                for index, name in enumerate(selected, 1):
                    destination.set_band_description(index, name)
                    destination.update_tags(index, formula=FORMULAS[name], units="dimensionless")
                for _, window in destination.block_windows(1):
                    valid = clear_pixels(aligned["SCL"], window, cloud_buffer, resolution)
                    if region is not None:
                        valid &= geometry_mask(
                            [region],
                            out_shape=valid.shape,
                            transform=destination.window_transform(window),
                            invert=True,
                        )
                    bands = {}
                    for band in needed:
                        values = aligned[band].read(1, window=window, masked=True)
                        bands[band] = np.where(
                            np.ma.getmaskarray(values), np.nan, (values.data + offsets[band]) / quantification
                        )
                    values = calculate(bands, selected)
                    for index, name in enumerate(selected, 1):
                        destination.write(
                            np.where(valid, values[name], np.nan).astype("float32"), index, window=window
                        )
        raster_copy(
            temporary,
            finalizing,
            driver="COG",
            compress="DEFLATE",
            predictor="YES",
            blocksize=512,
            overview_resampling="average",
            BIGTIFF="IF_SAFER",
        )
        finalizing.replace(output)
        output.with_suffix(".json").write_text(
            json.dumps(
                {
                    "source": str(source),
                    "processing_version": VERSION,
                    "baseline": baseline,
                    "quantification": quantification,
                    "offsets": offsets,
                    "indices": {name: FORMULAS[name] for name in selected},
                    "scl_valid": SCL_VALID,
                    "cloud_buffer_m": cloud_buffer,
                    "cloud_buffer_classes": SCL_CLOUD,
                    "resolution_m": resolution,
                    "resampling": (
                        "native 10 m reflectance; nearest for 20 m SCL"
                        if resolution == 10
                        else "average for reflectance; nearest for SCL"
                    ),
                    "aoi_sha256": hashlib.sha256(aoi.wkb).hexdigest() if aoi is not None else None,
                    "aoi": mapping(aoi) if aoi is not None else None,
                },
                indent=2,
            )
            + "\n"
        )
        return output
    finally:
        temporary.unlink(missing_ok=True)
        finalizing.unlink(missing_ok=True)
