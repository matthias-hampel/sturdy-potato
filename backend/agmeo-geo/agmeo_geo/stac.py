"""Sentinel-2 L2A search on Earth Search (STAC API)."""

import logging
from datetime import date, datetime

import httpx

from .sources import BANDS, Asset, StacItem

log = logging.getLogger("agmeo_geo.stac")

PAGE = 250
ASSETS = [*BANDS, "scl", "visual"]


def parse_item(feature: dict) -> StacItem | None:
    props = feature["properties"]
    assets = {}
    for key in ASSETS:
        raw = feature.get("assets", {}).get(key)
        if not raw:
            continue
        band = (raw.get("raster:bands") or [{}])[0]
        assets[key] = Asset(raw["href"], float(band.get("scale", 1.0)), float(band.get("offset", 0.0)))
    if "scl" not in assets or any(key not in assets for key in BANDS):
        return None
    grid = props.get("grid:code") or ""
    return StacItem(
        id=feature["id"],
        acquired_at=datetime.fromisoformat(props["datetime"]),
        platform=props.get("platform", "sentinel-2"),
        cloud_cover=props.get("eo:cloud_cover"),
        epsg=props.get("proj:epsg"),
        tile=("T" + grid.removeprefix("MGRS-")) if grid else None,
        geometry=feature["geometry"],
        assets=assets,
    )


def search(
    url: str,
    collection: str,
    geometry: dict,
    start: date,
    end: date,
    max_cloud_cover: float,
    client: httpx.Client | None = None,
) -> list[StacItem]:
    """All items intersecting the geometry in [start, end], oldest first."""
    body = {
        "collections": [collection],
        "intersects": geometry,
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "query": {"eo:cloud_cover": {"lte": max_cloud_cover}},
        "limit": PAGE,
        "sortby": [{"field": "properties.datetime", "direction": "asc"}],
    }
    own = client is None
    client = client or httpx.Client(timeout=60, headers={"user-agent": "agmeo-geo"})
    items: list[StacItem] = []
    try:
        request = ("POST", f"{url}/search", body)
        while request:
            method, href, payload = request
            response = client.request(method, href, json=payload)
            response.raise_for_status()
            page = response.json()
            for feature in page.get("features", []):
                item = parse_item(feature)
                if item:
                    items.append(item)
            request = None
            for link in page.get("links", []):
                if link.get("rel") == "next":
                    next_body = link.get("body")
                    if next_body is not None and link.get("merge"):
                        next_body = {**body, **next_body}
                    request = (link.get("method", "GET"), link["href"], next_body)
    finally:
        if own:
            client.close()
    return items
