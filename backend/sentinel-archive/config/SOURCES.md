# Niedersachsen boundary

`niedersachsen.geojson` contains the land portion (`gen=Niedersachsen`, `gf=4`)
of the BKG VG250 Länder layer, fetched on 2026-10-18 from the
[BKG WFS](https://sgx.geodatenzentrum.de/wfs_vg250).

© [BKG](https://www.bkg.bund.de) (2026)
[dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0).
[Underlying data sources](https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf).

Changes: selected Niedersachsen land geometry, requested EPSG:4326, removed response
envelope fields, serialized as GeoJSON. The geometry is generalized at 1:250,000;
it is suitable for regional tile selection, not cadastral/field boundaries.
The acquisition uses today's fixed boundary for every year, not historical boundaries.

The initial prototype query used GISCO NUTS. The bundled boundary is BKG VG250,
whose attribution licence permits commercial use.
