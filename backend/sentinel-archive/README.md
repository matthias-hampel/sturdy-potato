# Sentinel-2 archive backend

Downloads original Sentinel-2 Level-2A SAFE ZIP products from Copernicus Data Space
and computes agricultural indices as cloud-masked Cloud Optimized GeoTIFFs (COGs).
Default region: Niedersachsen. Start: 2020-01-01.

## Setup (fish)

```fish
cd /Users/matthias/Repositories/sturdy-potato/backend/sentinel-archive
uv sync --extra dev
mkdir -p ~/Documents/sentinel-2
uv run sentinel-archive init --archive ~/Documents/sentinel-2 --start 2020-01-01
```

This checkout has already been initialized. Do not run `init` again unless setting
up a fresh checkout. Change `config/local.json` to use another archive location.
Keep the database on a local disk; SQLite WAL and the process lock are not designed
for shared NAS filesystems. Mount the archive before running a job. Move existing
imagery with care: manifest paths are absolute and must be migrated too.

### Inventory before imagery

```fish
uv run sentinel-archive discover --start 2020-01-01 --end 2026-10-19
uv run sentinel-archive status
```

Dates are UTC; end dates are exclusive. Discovery needs no account and downloads
only metadata. `estimated_bytes` is the sum of provider-reported product sizes,
not a guarantee of ZIP transfer bytes. It includes full tiles and all available
product versions. The archive does not discard cloudy scenes: a tile-level cloud
percentage can hide useful clear pixels in an individual field.

The statewide archive is measured in **terabytes**. Check the inventory and disk
capacity before a large transfer. Use a small download limit on a laptop; every
run leaves a 20 GB free-space reserve. Derived rasters and backups need extra space.

### Credentials and first download

Create a [Copernicus Data Space account](https://dataspace.copernicus.eu/).
Enter credentials in your own terminal:

```fish
uv run sentinel-archive credentials
uv run sentinel-archive download --limit 1
```

The password goes into the OS keyring (macOS Keychain), and only the username is
stored in the ignored local configuration. The scheduled job needs access to the
same login keychain. If your account requires interactive 2FA, unattended password
login may fail; verify the authentication flow before enabling the job. A current
`CDSE_TOTP` can be supplied for an interactive run; it is not a persistent 2FA solution.

Environment variables are also supported, without putting passwords in shell history:

```fish
read -x -P 'CDSE email: ' CDSE_USERNAME
read -sx -P 'CDSE password: ' CDSE_PASSWORD
uv run sentinel-archive download --limit 1
set -e CDSE_PASSWORD
set -e CDSE_USERNAME
```

### Backfill and recurring downloads

```fish
uv run sentinel-archive sync --limit 100
```

`sync` discovers missing historical months, checks new publications (including
recently published reprocessing of older acquisitions), then downloads at most
100 products. Recent scenes from the last 30 days take priority among unattempted
products; the remaining queue is filled oldest first. Failures rotate behind
unattempted scenes, preventing an offline product from blocking the archive.
Run repeatedly to drain the queue. Download completion is recorded per product UUID.

A two-day publication overlap catches ordinary catalogue lag. A durable publication
cursor is advanced only after complete pagination. Completed month scans are cached;
use `discover --refresh` for an explicit full reconciliation, including unusually
late catalogue corrections. The archive retains original products even if a source
product is subsequently removed. Provider deletion/retraction monitoring is not yet
implemented. Reprocessed versions are kept separately and must not be counted as
independent observations when building time series.

Generate a macOS job for 04:00 every day in the machine's local timezone:

```fish
uv run sentinel-archive schedule --hour 4 --limit 10
```

After a successful single-product download, activate the generated job:

```fish
mkdir -p ~/Library/LaunchAgents
cp .data/de.sturdy-potato.sentinel.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/(id -u) ~/Library/LaunchAgents/de.sturdy-potato.sentinel.plist
```

Use `--limit 10` initially on local storage; increase the limit on a suitably sized
NAS for backfill. `launchd` uses the installed virtual environment directly and does
not depend on fish startup files. It runs while this user is logged in; the machine
must be available, the archive mounted, and the keychain accessible. Sleep can delay
a calendar job until wake. Logs are in `.data/logs/`; failures exit nonzero. Log rotation
and external failure notifications are not configured. Do not run two workers against
the same catalogue. To disable:

```fish
launchctl bootout gui/(id -u) ~/Library/LaunchAgents/de.sturdy-potato.sentinel.plist
```

The scheduler is generated separately from activation. No recurring download job is
active merely because you ran `init` or `schedule`.

### Calculations

```fish
uv run sentinel-archive process /absolute/path/product.SAFE.zip \
  --output ~/Documents/sentinel-2/derived/example-indices.tif \
  --indices NDVI,NDRE,NDMI

# All 17 spectral indices from the first screenshot:
uv run sentinel-archive process /absolute/path/product.SAFE.zip \
  --output ~/Documents/sentinel-2/derived/example-all.tif --indices all

# Native 10 m grid, only for indices built from 10 m bands:
uv run sentinel-archive process /absolute/path/product.SAFE.zip \
  --output ~/Documents/sentinel-2/derived/example-10m.tif --indices NDVI,EVI2 --resolution 10
```

Outputs contain one float32 band per index, band names/formulas, a nodata mask,
and a provenance JSON. Source JP2s are read directly inside the original ZIP;
no extraction or statewide in-memory raster is needed. Calculations run in 512-pixel
windows on each tile's native UTM grid at **20 m**. 10 m bands are averaged to 20 m;
SCL uses nearest-neighbour. This supports red-edge/SWIR indices without claiming
10 m information from 20 m bands. Original 10 m inputs remain in the SAFE archive.

`--resolution 10` uses the B04 grid instead, for indices whose inputs are all
native 10 m bands (B02, B03, B04, B08): NDVI, GNDVI, EVI, EVI2, SAVI, MSAVI2,
CIgreen and OSAVI. Reflectance is not resampled; the 20 m SCL mask is upsampled
with nearest-neighbour, so cloud-mask edges stay 20 m blocks. Any other index is
rejected at 10 m; process it in a separate 20 m file. With `--indices all`, 10 m
selects those eight indices. A 10 m file has four times as many pixels.

Reflectance is `(DN + BOA_ADD_OFFSET) / BOA_QUANTIFICATION_VALUE`, read from the
product metadata. DN=0 remains nodata. Baselines >=04.00 require explicit offsets;
older baselines may have zero offset. Negative reflectance is not silently clipped.
Division by near-zero and invalid square roots become nodata. No blanket [-1,1]
clipping is applied, since several indices are not bounded that way.

The default mask keeps SCL 4, 5 and 6 (vegetation, bare ground and water) and excludes
cloud/shadow/snow/unclassified pixels. It also masks outside the configured boundary.

SCL does not classify the haze around clouds. In the 2026-09-18 T31UGV scene, vegetation
NDVI was about 0.07 lower within 200 m of cloud or cloud shadow (SCL 3, 8, 9, 10), still
about 0.03 lower at 300 m, and level from about 500 m. Pixels within `--cloud-buffer`
metres (default 300; `0` disables) of those classes are therefore masked as well. The
distance is measured on the output grid, with an overlap around each processing window,
so window edges do not change the result. Clouds outside the tile are not seen. On a
cloudy day the buffer removes a large share of the remaining pixels; that is intended.
This is a quality mask, not proof that every retained pixel is cloud-free; field-level
valid-pixel statistics are a future addition.
The generalized regional boundary is unsuitable for parcel-edge measurements.

The exact formulas and band choices are in `sentinel_archive/indices.py` and are
embedded in the GeoTIFF. NDRE and CIred-edge use B8A/B05; NDVI uses B08/B04.
SAVI uses L=0.5; OSAVI includes the 1.16 factor. NBR2 and the normalized difference
tillage index (NDTI) are the **same formula**, `(B11-B12)/(B11+B12)`.

## Coverage of the screenshots

| Group | Status | Required inputs |
|---|---|---|
| NDVI, NDRE, GNDVI, EVI, EVI2, SAVI, MSAVI2, NDMI, MSI, CIgreen, CIred-edge, IRECI, MCARI, OSAVI, NBR2, BSI, NDTI | Implemented | Level-2A bands and SCL |
| LAI, FAPAR, FCOVER, CCC, CWC | Next processing stage | Validated biophysical retrieval such as ESA SNAP, including observation/sun geometry and model validity flags |
| Cab | Not implemented | A validated leaf-chlorophyll model; do not equate a chlorophyll index or canopy chlorophyll directly with Cab |
| TWI, slope, aspect, TPI, TRI, flow accumulation, LS factor, solar radiation, curvature | Separate terrain stage | A terrain model, preferably Niedersachsen LGLN DGM, plus documented hydrology/terrain parameters |

LAI and related outputs are model estimates, not extra Sentinel-2 image bands.
Terrain metrics should normally be computed once per elevation-data version. TWI,
flow accumulation and LS need hydrological conditioning and catchment context
outside the state boundary. Solar radiation additionally needs a period and model
assumptions. Vegetation indices alone do not establish nitrogen deficiency or
diagnose plant stress.

### Derived products for agmeo

```fish
uv run sentinel-archive derive --limit 10
```

For each downloaded product without current derived output (newest first), `derive` writes
`<archive>/derived/products/<uuid>/` with `ndvi-10m.tif` (NDVI, native 10 m), `evi-10m.tif`
(EVI, native 10 m), `indices-20m.tif` (NDRE, NDMI, 20 m), `soil-20m.tif` (BSI, NDTI, 20 m)
and, last, `manifest.json`. A manifest of an older processing version (`ASSETS_VERSION` in
`derive.py`, bumped whenever the asset list changes) is re-derived; asset files that already
exist are kept, so only new assets are computed. The manifest is the
contract read by `backend/agmeo-geo`: product id and name, platform, tile, acquisition
time, footprint, the share of the footprint left after masking (`clear_fraction`),
processing version, cloud buffer, and the asset paths and bands. Products are processed
on the full tile, without the regional boundary mask. About 30 s per tile on an M-series Mac.

Field zonal statistics and map tiles live in `backend/agmeo-geo`. Temporal composites,
biophysical processing and DEM processing are not implemented. Recurring jobs archive
imagery only; run `derive` after `sync` (or add it to the scheduled job).

## Storage and recovery

```text
backend/sentinel-archive/.data/catalogue.sqlite              local catalogue and progress
~/Documents/sentinel-2/raw/YYYY/MM/UUID/     original SAFE ZIP + metadata JSON
~/Documents/sentinel-2/derived/              chosen output filenames
```

Metadata records UUID, acquisition/publication dates, footprint, original catalogue
JSON and download state. The source ZIP is promoted atomically only after HTTP length
(when supplied) and ZIP member CRC checks pass. A local SHA-256 is recorded for later
integrity verification. It is **not** claimed to be a comparison against the provider's
checksum: the catalogue checksum can refer to a different packaging representation.

```fish
uv run sentinel-archive verify
uv run sentinel-archive verify --requeue
```

`--requeue` requeues missing files. A corrupt file is reported and left in place
for inspection; move it aside, then rerun `verify --requeue` before downloading again. A crashed download restarts that
product from byte zero; completed products are retained. HTTP GETs retry transient
429/5xx errors with backoff; broken streaming transfers are queued for a later run.
The job stops before exhausting the configured free-space reserve.

For a different AOI, use a separate config **and a separate database**; the queue is
one region per manifest. Config and imagery are ignored by Git. Back up both the
imagery and local manifest. An archive is not itself a backup.

## Validation

```fish
uv run pytest -q
uv run ruff check .
```

Tests cover interrupted pagination and checkpointing, duplicate prevention, spatial
filtering, publication cursor recovery, offsets, numeric reference values for all
17 indices, atomic downloads, incomplete transfers, queue fairness and authenticated
redirect boundaries. An integration test creates actual JPEG2000 inputs in a SAFE-like
ZIP and verifies 10 m→20 m and native 10 m processing, cloud/nodata masks, the cloud
buffer (including across window edges) and COG output. Live catalogue
access is checked separately. A real authenticated imagery download still requires
your credentials and a successful pilot run.

## Sources

- [Copernicus OData catalogue and downloads](https://documentation.dataspace.copernicus.eu/APIs/OData.html)
- [Copernicus authentication](https://documentation.dataspace.copernicus.eu/APIs/Token.html)
- [Sentinel-2 products, processing baselines and reflectance](https://sentiwiki.copernicus.eu/web/s2-products)
- [ESA SNAP biophysical processor algorithm](https://step.esa.int/docs/extra/ATBD_S2ToolBox_V2.0.pdf)
- [Sentinel Hub index formula examples](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/)
- [BKG regional boundary attribution](config/SOURCES.md)
- [Niedersachsen LGLN OpenGeoData](https://lgln-geodaten.niedersachsen.de/opengeodata/opengeodata-220509.html)

For published imagery/derivatives, include the applicable Copernicus Sentinel data
attribution (for example, “Contains modified Copernicus Sentinel data [year]”).
