"""Map tiles (XYZ, Web Mercator) rendered from the field rasters.

Internal service: it binds to localhost and is reached through the agmeo API, which
authenticates the user and checks organization membership. Imagery exists only per field,
so tiles show the requesting organization's fields and nothing around them.

* ``/imagery/{date}/{layer}/...``: one acquisition date. ``layer`` is an index (absolute
  scale, or ``stretch=relative`` for within-field contrast around the field median) or
  ``rgb`` (true colour).
* ``/productivity/{analysis}/...``: the relative productivity map of an analysis, around the
  field mean (diverging, symmetric).
"""

import json
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from morecantile import tms
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader
from rio_tiler.utils import render

from .colormaps import RELATIVE, SCALES, colormap, ramp
from .config import Settings, load
from .fieldgrid import NODATA, SCALE, read_layer
from .observe import rgb_path
from .pipeline import connect

log = logging.getLogger("agmeo_geo.tiles")

SIZE = 256
EMPTY = render(
    np.zeros((1, SIZE, SIZE), dtype="uint8"), mask=np.zeros((SIZE, SIZE), dtype="uint8"), img_format="PNG"
)
# Tiles depend on the organization's boundaries; the web app adds a boundary version to the
# URL, so a short private lifetime is enough.
CACHE = {"Cache-Control": "private, max-age=3600"}
LAYERS = (*SCALES, "rgb")
WEB_MERCATOR = tms.get("WebMercatorQuad")

RASTERS_IN_TILE = """
SELECT DISTINCT ON (f.id) f.id, ST_AsGeoJSON(ST_Transform(g.geometry, 3857)) AS geometry,
       r.path, r.bands, r.has_rgb
FROM fields f
JOIN field_current_geometry g ON g.field_id = f.id
JOIN field_rasters r ON r.geometry_version_id = g.id AND r.observed_on = %(day)s
WHERE f.organization_id = %(org)s AND f.status = 'active'
  AND (%(field)s::uuid IS NULL OR f.id = %(field)s::uuid)
  AND g.geometry && ST_Transform(ST_MakeEnvelope(%(w)s, %(s)s, %(e)s, %(n)s, 3857), 4326)
ORDER BY f.id, r.valid_pixel_pct DESC
"""


PRODUCTIVITY = """
SELECT a.raster_path, ST_AsGeoJSON(ST_Transform(g.geometry, 3857)) AS geometry
FROM productivity_analyses a
JOIN field_geometry_versions g ON g.id = a.geometry_version_id
WHERE a.id = %(id)s AND a.organization_id = %(org)s AND a.raster_path IS NOT NULL
"""


@lru_cache(maxsize=4096)
def field_percentiles(path: str, layer: str) -> tuple[float, float, float] | None:
    """2nd, 50th and 98th percentile of a field raster layer: the within-field stretch."""
    values = read_layer(Path(path), layer)
    values = values[np.isfinite(values)]
    if values.size < 4:
        return None
    lo, mid, hi = np.percentile(values, [2, 50, 98])
    return float(lo), float(mid), float(hi)


def relative_bytes(values: np.ndarray, lo: float, mid: float, hi: float) -> np.ndarray:
    """Piecewise stretch: lo..mid to 0..127.5 and mid..hi to 127.5..255."""
    below = (values - mid) / max(mid - lo, 1e-6)
    above = (values - mid) / max(hi - mid, 1e-6)
    t = np.where(values < mid, below, above)
    return np.clip(127.5 + 127.5 * t, 0, 255).astype("uint8")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load()
    app = FastAPI(title="agmeo geo tiles", docs_url=None, redoc_url=None)
    relative_map = ramp(RELATIVE)

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    def rasters(organization: str, day: str, field: str | None, bounds) -> list[dict]:
        w, s, e, n = bounds
        with connect(settings) as conn:
            return conn.execute(
                RASTERS_IN_TILE,
                {"org": organization, "day": day, "field": field, "w": w, "s": s, "e": e, "n": n},
            ).fetchall()

    @app.get("/imagery/{day}/{layer}/{z}/{x}/{y}.png")
    def imagery(
        day: str,
        layer: str,
        z: int,
        x: int,
        y: int,
        organization: str = Query(...),
        field: str | None = Query(None),
        stretch: str = Query("absolute", pattern="^(absolute|relative)$"),
    ):
        if layer not in LAYERS:
            raise HTTPException(404, "Unknown layer")
        if not 0 <= z <= 22:
            raise HTTPException(400, "Invalid zoom")
        bounds = tuple(WEB_MERCATOR.xy_bounds(x, y, z))
        rows = rasters(organization, day, field, bounds)
        if not rows:
            return Response(EMPTY, media_type="image/png", headers=CACHE)

        tile_transform = from_bounds(*bounds, SIZE, SIZE)
        filled = np.zeros((SIZE, SIZE), dtype=bool)
        out = np.zeros((3 if layer == "rgb" else 1, SIZE, SIZE), dtype="uint8")
        for row in rows:
            path = settings.data_dir / row["path"]
            if layer == "rgb":
                if not row["has_rgb"]:
                    continue
                path = settings.data_dir / rgb_path(Path(row["path"]))
            elif layer not in row["bands"]:
                continue
            try:
                with Reader(str(path)) as src:
                    band = 0 if layer == "rgb" else row["bands"].index(layer) + 1
                    indexes = (1, 2, 3) if layer == "rgb" else band
                    image = src.tile(x, y, z, indexes=indexes, tilesize=SIZE, resampling_method="nearest")
            except (TileOutsideBounds, FileNotFoundError, OSError):
                continue
            # Pixels touched by the field's own boundary are kept, so narrow fields stay visible.
            own = geometry_mask(
                [json.loads(row["geometry"])],
                out_shape=(SIZE, SIZE),
                transform=tile_transform,
                invert=True,
                all_touched=True,
            )
            data = image.array.data
            valid = own & ~np.ma.getmaskarray(image.array).any(axis=0) & ~filled
            if layer == "rgb":
                valid &= data.any(axis=0)
                out[:, valid] = data[:, valid]
            else:
                valid &= data[0] != NODATA
                values = data[0].astype("float64") * SCALE
                if stretch == "relative":
                    p = field_percentiles(str(path), layer)
                    if p is None:
                        continue
                    scaled = relative_bytes(values, *p)
                else:
                    low, high, _ = SCALES[layer]
                    scaled = np.clip((values - low) / (high - low) * 255, 0, 255).astype("uint8")
                out[0, valid] = scaled[valid]
            filled |= valid
        if not filled.any():
            return Response(EMPTY, media_type="image/png", headers=CACHE)
        if layer == "rgb":
            png = render(out, mask=filled.astype("uint8") * 255, img_format="PNG")
        else:
            cmap = relative_map if stretch == "relative" else colormap(layer)
            png = render(out, mask=filled.astype("uint8") * 255, img_format="PNG", colormap=cmap)
        return Response(png, media_type="image/png", headers=CACHE)

    @app.get("/productivity/{analysis}/{z}/{x}/{y}.png")
    def productivity(analysis: str, z: int, x: int, y: int, organization: str = Query(...)):
        if not 0 <= z <= 22:
            raise HTTPException(400, "Invalid zoom")
        with connect(settings) as conn:
            row = conn.execute(PRODUCTIVITY, {"id": analysis, "org": organization}).fetchone()
        if not row:
            raise HTTPException(404, "Analysis not found")
        path = settings.data_dir / row["raster_path"]
        bounds = tuple(WEB_MERCATOR.xy_bounds(x, y, z))
        try:
            with Reader(str(path)) as src:
                image = src.tile(x, y, z, indexes=1, tilesize=SIZE, resampling_method="nearest")
        except (TileOutsideBounds, FileNotFoundError, OSError):
            return Response(EMPTY, media_type="image/png", headers=CACHE)
        own = geometry_mask(
            [json.loads(row["geometry"])],
            out_shape=(SIZE, SIZE),
            transform=from_bounds(*bounds, SIZE, SIZE),
            invert=True,
            all_touched=True,
        )
        data = image.array.data[0]
        valid = own & (data != NODATA)
        if not valid.any():
            return Response(EMPTY, media_type="image/png", headers=CACHE)
        p = field_percentiles(str(path), "productivity")
        # Symmetric around the field mean, so equal deviations get equal colour strength.
        spread = max(0.03, 1 - p[0], p[2] - 1) if p else 0.15
        scaled = relative_bytes(data.astype("float64") * SCALE, 1 - spread, 1.0, 1 + spread)
        out = np.where(valid, scaled, 0)[None].astype("uint8")
        png = render(out, mask=valid.astype("uint8") * 255, img_format="PNG", colormap=relative_map)
        return Response(png, media_type="image/png", headers=CACHE)

    return app
