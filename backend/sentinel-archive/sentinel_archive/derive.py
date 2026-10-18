"""Per-scene derived index products with a manifest, the contract read by downstream services.

Layout, one directory per downloaded product (catalogue UUID):

    <archive>/derived/products/<uuid>/ndvi-10m.tif       NDVI on the native 10 m grid
    <archive>/derived/products/<uuid>/indices-20m.tif    NDRE, NDMI on the 20 m grid
    <archive>/derived/products/<uuid>/manifest.json      written last; its presence means complete

Products are processed on the full tile (no regional boundary mask), so parcel edges near the
state border are not clipped by the generalized boundary.
"""

import json
import math
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from shapely.geometry import shape

from .processing import VERSION, process

MANIFEST_VERSION = 1
ASSETS = [
    # (file name, indices, resolution in m)
    ("ndvi-10m.tif", ["NDVI"], 10),
    ("indices-20m.tif", ["NDRE", "NDMI"], 20),
]


def product_dir(root, product_id):
    return Path(root) / "derived" / "products" / product_id


def pending(db, root, limit):
    """Complete downloads without a manifest, newest acquisitions first."""
    rows = db.execute("SELECT * FROM products WHERE status='complete' ORDER BY acquired DESC").fetchall()
    return [row for row in rows if not (product_dir(root, row["id"]) / "manifest.json").exists()][:limit]


def footprint(row):
    geo = json.loads(row["metadata"]).get("GeoFootprint")
    if not geo:
        raise ValueError(f"Product {row['id']} has no footprint in the catalogue")
    return shape(geo)


def clear_fraction(path, band, area):
    """Share of pixels inside the acquisition footprint that kept a value after masking.

    Measured on the coarsest overview; an indicator of usable area, not a cloud percentage.
    """
    with rasterio.open(path) as dataset:
        factor = (dataset.overviews(band) or [1])[-1]
        height, width = math.ceil(dataset.height / factor), math.ceil(dataset.width / factor)
        values = dataset.read(band, out_shape=(height, width))
        transform = dataset.transform * dataset.transform.scale(dataset.width / width, dataset.height / height)
        inside = geometry_mask(
            [transform_geom("EPSG:4326", dataset.crs, area.__geo_interface__)],
            out_shape=(height, width),
            transform=transform,
            invert=True,
        )
    total = int(inside.sum())
    return float(np.isfinite(values[inside]).sum() / total) if total else 0.0


def derive_product(row, root, cloud_buffer=300):
    source = Path(row["path"])
    if not source.exists():
        raise OSError(f"Archived product missing: {source}")
    directory = product_dir(root, row["id"])
    directory.mkdir(parents=True, exist_ok=True)
    area = footprint(row)
    assets = {}
    for filename, indices, resolution in ASSETS:
        output = directory / filename
        if not output.exists():
            process(source, output, indices, None, resolution, cloud_buffer)
        for band, name in enumerate(indices, 1):
            assets[name.lower()] = {"path": filename, "band": band, "resolution_m": resolution}
    clear = clear_fraction(directory / "ndvi-10m.tif", 1, area)
    name = row["name"]
    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "product_id": row["id"],
        "product_name": name,
        "platform": name.split("_")[0],
        "product_level": "L2A",
        "tile": next((part[1:] for part in name.split("_") if part.startswith("T") and len(part) == 6), None),
        "acquired_at": row["acquired"],
        "footprint": area.__geo_interface__,
        "clear_fraction": round(clear, 4),
        "processing_version": f"s2-indices-{VERSION}",
        "cloud_buffer_m": cloud_buffer,
        "assets": assets,
        "created_at": datetime.now(UTC).isoformat(),
    }
    temporary = directory / "manifest.json.part"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(directory / "manifest.json")
    return manifest
