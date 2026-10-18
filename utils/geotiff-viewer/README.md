# GeoTIFF Viewer

A standalone native macOS viewer built with [GPUI](https://gpui.rs/) and
[GPUI Kit](https://gpui-kit.com/). Opens local scientific TIFFs, including the
Sentinel archive's 17-band `example-all.tif`. No Python, GDAL, QGIS, web server,
account, or backend process is required to run the compiled app.

## Run

From this directory, using fish (or any shell):

```fish
cargo run --locked --release -- ~/Documents/sentinel-2/derived/example-all.tif
```

Building requires Rust and full Xcode with its Metal compiler selected. The first
build downloads dependencies. `Cargo.lock` pins the dependency graph. macOS is
the tested target; the bundle script builds for the current machine's architecture.

To create a local app you can launch in Finder:

```fish
sh scripts/bundle.sh
open 'dist/GeoTIFF Viewer.app'
```

Use `sh scripts/bundle.sh debug` for a faster development build. The app is
locally ad-hoc signed, not notarized for distribution. Open a file using the
**Open GeoTIFF** button, **⌘O**, or drag it onto the image area. Command-line
paths also work:

```fish
open 'dist/GeoTIFF Viewer.app' --args ~/Documents/sentinel-2/derived/example-all.tif
```

## Explore indices

- Select an index in the left sidebar. Band names and formulas come from GDAL
  metadata embedded in the TIFF.
- **Fit valid area** zooms to the approximate extent of valid pixels in the
  current preview. **Fit image** / **⌘0** returns to the full extent.
- Scroll to zoom around the pointer; drag to pan; click to inspect the original
  full-resolution pixel and its coordinates in the file's CRS.
- **Smooth** (on by default) applies when you zoom in past the file's resolution.
  Values are interpolated bicubically (Catmull-Rom) up to the screen's pixel size,
  then coloured. Interpolated values stay within the range of their 4×4 native
  neighbourhood, and nodata keeps the exact outline of its native pixels; next to
  nodata the viewer falls back to bilinear, then nearest. This only changes the
  display: it adds no detail, and inspection still reads the original pixel. Turn
  it off to see each native pixel as a square.
- Choose a palette. Set minimum/maximum and press **Apply**, or use **Auto 2–98%**
  for a percentile stretch of the current view. Auto recalculates when panning.
- The colour legend shows the display range. Out-of-range values use the end
  colours; original values are preserved. Checkerboard means masked/no data.
- **Export PNG** saves the displayed preview with transparent nodata. This is a
  visualization, without GeoTIFF georeferencing, not an analysis raster.
- **OSM basemap** (on by default) shows OpenStreetMap behind the raster, visible
  wherever pixels are nodata. It works for EPSG:4326/4258, EPSG:3857 and
  WGS84/ETRS89 UTM (EPSG:326xx, 327xx, 258xx). Tiles are warped into the raster's
  grid. The PNG export does not include the map.

The basemap is the only network access. It requests tiles from
`tile.openstreetmap.org` for the area you're viewing, so the server learns that
area but receives no file contents. Up to two connections are used and at most
64 tiles per view. Tiles are cached for 7 days in
`~/Library/Caches/dev.sturdypotato.geotiff-viewer/osm-tiles`; if a download
fails, the viewer uses an expired cached tile. Turn the button off to stay
fully offline. Map data © OpenStreetMap contributors (ODbL); the attribution
in the viewport links to the copyright page.

NDVI/NDRE/GNDVI start at −1…1 with a vegetation palette; NDMI/NBR2/NDTI use a
moisture palette. Other bands start with automatic contrast. These colours are
visualization defaults, not agronomic diagnosis thresholds.

## Implementation and limits

The Rust TIFF decoder reads tiles or strips in a background task. Previews match
the image area's physical screen pixels on the longer edge (at most 2,040; the
basemap stays at 1,400). Linked TIFF overview directories are used when suitable
(up to 10% coarser than the preview), with native tiles used on zoom. Once a view
has fewer native pixels than the screen, they are enlarged as described under
**Smooth**, so the GPU no longer stretches a small image. The preview is sized
when the view changes; after resizing the window, zoom or pan to refresh it. Tiles/strips are decoded in parallel, and the selected band of recently
decoded chunks is cached (about 256 MB), so panning only decodes newly visible
chunks. No full multi-band raster is kept in memory. Pending views are debounced
and stale work is cancelled between chunks. Colour changes reuse the decoded
preview.

Supports integer and floating-point scalar bands, tiled/stripped data, chunky
and planar layouts, GDAL nodata/scale/offset, and affine GeoTIFF coordinates.
Internal masks separate from nodata, SubIFD-only/external overviews, TIFF
orientation other than top-left, reprojection of the raster itself, RGB
composites, basemaps for other CRSs, and remote URLs are not supported. Very large individual strips/tiles can
exceed the decoder's bounded allocation limits and produce an error. TIFFs
without overviews may take longer to preview. Export saves the displayed preview,
including smoothing.

## Verification and CLI

```fish
cargo test --locked
cargo run --locked -- --inspect ~/Documents/sentinel-2/derived/example-all.tif
cargo run --locked -- --pixel ~/Documents/sentinel-2/derived/example-all.tif 1 2000 3000
cargo run --locked -- --render ~/Documents/sentinel-2/derived/example-all.tif 1 /tmp/ndvi.png
cargo run --locked -- --render ~/Documents/sentinel-2/derived/example-10m.tif 1 /tmp/crop.png 8760 7840 180 180 1200
cargo run --locked -- --basemap ~/Documents/sentinel-2/derived/example-all.tif /tmp/map.png
```

Band numbers are 1-based; columns/rows are 0-based. A `--render` crop takes
COLUMN ROW WIDTH HEIGHT in native pixels and the output's longer EDGE; add
`nearest` to disable smoothing. The CLI refuses to overwrite
an existing PNG. The GUI save dialog handles overwrite confirmation.
Tests include small rasterio-generated fixtures for floating-point predictor
decoding, planar/chunky tiles with partial edge tiles, scale/offset, nodata,
georeferencing, overviews, signed-integer strips, cancellation, and smooth/nearest
upsampling (exact on a linear gradient, no overshoot, nodata edges), plus UTM
conversion checked against PROJ and offline tile warping.
