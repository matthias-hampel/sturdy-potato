# Decoder reference fixtures

Generated locally with rasterio 1.5.2 (GDAL) to test the independent Rust decoder.
Tests use the checked-in TIFFs and do not need rasterio installed.

`pixel.tif` and `band.tif`: 21 columns × 19 rows, three float32 bands,
16×16 tiles, DEFLATE with floating-point predictor 3, respectively pixel and
band interleaving. Value at zero-based `(band, row, column)` is
`float32(band * 19 * 21 + row * 21 + column) / float32(100)`;
pixel (0,0) is NaN in every band. Band 1 is named NDVI and has scale 2,
offset 1. The other bands have scale 1, offset 0. CRS EPSG:32632,
upper-left corner (500000,6000000), 20m square pixels, north-up.
Nearest-neighbour overviews were built at factors 2 and 4.

`integer.tif`: 3 columns × 2 rows, signed int16, one stripped band containing
rows `[-9999, -2, 0]` and `[1, 2, 3]`. Nodata is -9999.
