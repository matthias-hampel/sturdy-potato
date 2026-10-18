# agmeo-geo

Satellite pipeline for agmeo: per-field Sentinel-2 imagery history, statistics, map tiles
and productivity zones. Python, because the raster stack (rasterio/GDAL, rio-tiler) is
there; it shares nothing with the NestJS API except the database and NATS.

```
Earth Search (sentinel-2-c1-l2a COGs) ─┐  field windows only
sentinel-archive derive (local COGs) ──┤
                                       ▼
agmeo-geo worker ◀── NATS agmeo.events.field.{created,geometry_updated}
   ├─ field_imagery_jobs: backfill since 2018 per field boundary, then new acquisitions
   ├─ field_rasters: NDVI/NDRE/NDMI/EVI/BSI/NDTI (+ true colour) on the field's own 10 m grid
   ├─ field_observations: field statistics per acquisition
   └─ productivity_analyses → zonings (3/5/7) → zoning_zones

agmeo-geo serve  ─▶ /imagery/<date>/<layer>/<z>/<x>/<y>.png, /productivity/<analysis>/...  (internal, :3002)
agmeo API        ─▶ /v1/orgs/:orgId/monitoring/imagery/..., /fields/:id/productivity/...  (auth, proxies)
```

## Run

```bash
uv sync --extra dev
uv run agmeo-geo worker        # events, imagery backfill, productivity analyses, scans
uv run agmeo-geo serve         # tiles on 127.0.0.1:3002
uv run agmeo-geo history [id]  # backfill imagery once (all fields or one) without the worker
uv run agmeo-geo productivity  # compute queued productivity analyses once
uv run agmeo-geo reconcile     # local archive only: register scenes, compute missing observations
uv run pytest -q && uv run ruff check .
```

Run these from a terminal that may read the archive. On macOS, the default archive in
`~/Documents/sentinel-2` is protected: a process started by an app without Documents
access (for example an IDE or agent runner) blocks when opening the rasters.

Settings (environment): `AGMEO_GEO_DATABASE_URL` (default the local `agmeo_geo_worker`
role), `NATS_URL`, `SENTINEL_ARCHIVE` (default: the `archive` in
`backend/sentinel-archive/config/local.json`), `AGMEO_GEO_DATA` (field rasters, default
`<repo>/.data/agmeo-geo`), `AGMEO_GEO_STAC_URL`, `AGMEO_GEO_STAC_COLLECTION`,
`AGMEO_GEO_HISTORY_FROM` (default 2018-01-01), `AGMEO_GEO_READ_WORKERS` (default 8),
`AGMEO_GEO_HOST`, `AGMEO_GEO_PORT`, `AGMEO_GEO_SCAN_INTERVAL` (seconds, default 600).

## Imagery history

- One job per field boundary version. A run searches Earth Search for the field (tiles with
  ≤ 90 % cloud), keeps one item per platform and day (preferring the field's UTM zone and a
  footprint that contains the whole field) and skips acquisitions already processed.
- Queued jobs are processed together, acquisition by acquisition, in a process pool:
  neighbouring fields share the COG blocks fetched for an acquisition. Per field the SCL
  cloud mask is read first; the five bands and true colour only when ≥ 30 % of the field
  is clear. Typical cost: ~1.5 s for a cloudy acquisition, ~8 s for a clear one.
- Reflectance = DN × scale + offset from the STAC `raster:bands` (collection 1 is processed
  consistently, offset −0.1). Cloud mask as in sentinel-archive: SCL 4/5/6 kept, 300 m
  around SCL 3/8/9/10 removed as haze.
- After a run, `covered_until` is set; the scan re-queues finished jobs for newer
  acquisitions (looking back 10 days for late items). Unreadable acquisitions are retried.
- A job records the processing version it finished with. After a version bump
  (`SCENE_VERSION` in `history.py`) every job is queued again and rescans its whole history;
  observations of the old version are replaced acquisition by acquisition.

## Field grid and statistics

- Every acquisition is resampled (nearest) onto the field's own grid: its UTM zone, 10 m,
  aligned to multiples of 10 m, field bounds + 20 m. Field rasters are int16 × 10⁻⁴ GeoTIFFs.
- Statistics use pixel centres inside the boundary shrunk by 10 m (small fields keep the
  full boundary). An observation is `valid` with ≥ 65 % clear pixels and ≥ 20 pixels,
  otherwise `insufficient_coverage`. Processing versions `es-c1/indices-2/zonal-2` (Earth
  Search) and `s2-indices-2/assets-2/zonal-2` (archive).

## Productivity zones

See the module docstring of `agmeo_geo/productivity.py` (algorithm `pz-1`): acquisitions
with ≥ 90 % clear and field-mean NDVI 0.35–0.92, four per season; normalised by the field
mean, averaged per season and then over seasons; stability = mean leave-one-season-out
correlation (≥ 0.6 stable, ≥ 0.4 partly); 1-D k-means into 3/5/7 zones, sieved, vectorised,
coverage-simplified and clipped. Analyses are queued by the API or automatically once a
boundary's imagery history is loaded; the worker polls the queue every 10 s.

## Database access

The worker connects as `agmeo_geo_worker` (member of `agmeo_geo`, migrations 000006–8). It
can read field ids, organization ids and boundaries across organizations and write scenes,
observations, field rasters, imagery jobs and productivity results; it cannot read any
other tenant data.

## Tiles

256 px PNG tiles in Web Mercator. `organization` (set by the API proxy) limits a tile to
that organization's current field boundaries; imagery exists only inside fields anyway.
`/imagery/<date>/<layer>` mosaics the clearest field raster per field for that date;
`stretch=relative` stretches each field between its own 2nd and 98th percentile around the
median (diverging brown–grey–green). `/productivity/<analysis>` renders relative
productivity symmetric around the field mean. Colour scales are defined in
`agmeo_geo/colormaps.py`, mirrored in `packages/contracts/src/insights.ts`. Attribution:
"Contains modified Copernicus Sentinel data <year>".
