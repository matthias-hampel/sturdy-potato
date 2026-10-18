"""Refresh the BKG VG250 Niedersachsen land boundary (review changes before use)."""

import json
from pathlib import Path

import requests

response = requests.get(
    "https://sgx.geodatenzentrum.de/wfs_vg250",
    params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "vg250:vg250_lan",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "FILTER": "<Filter><PropertyIsEqualTo><ValueReference>gen</ValueReference>"
        "<Literal>Niedersachsen</Literal></PropertyIsEqualTo></Filter>",
    },
    timeout=120,
)
response.raise_for_status()
features = [f for f in response.json()["features"] if f["properties"]["gf"] == 4]
if len(features) != 1:
    raise ValueError("Expected one Niedersachsen land feature")
target = Path(__file__).resolve().parents[1] / "config/niedersachsen.geojson"
target.write_text(
    json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
    + "\n"
)
print(target)
