"""Public CDSE OData discovery and a durable, local SQLite manifest."""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from shapely.geometry import box, shape
from shapely.ops import unary_union
from urllib3.util.retry import Retry

CATALOGUE = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"


def session():
    client = requests.Session()
    client.headers["User-Agent"] = "sturdy-potato/0.1"
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        respect_retry_after_header=True,
    )
    client.mount("https://", HTTPAdapter(max_retries=retry))
    return client


def timestamp(value):
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def monthly_windows(start, end):
    while start < end:
        following = (start.replace(day=1) + timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0)
        stop = min(following, end)
        yield start, stop
        start = stop


def load_aoi(path):
    data = json.loads(Path(path).read_text())
    features = data.get("features", [data])
    geometry = unary_union([shape(f.get("geometry", f)) for f in features])
    if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("AOI must be a valid WGS84 Polygon or MultiPolygon")
    if not box(-180, -90, 180, 90).covers(geometry):
        raise ValueError("AOI coordinates must be WGS84 longitude/latitude")
    return geometry


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, acquired TEXT NOT NULL,
        published TEXT NOT NULL, bytes INTEGER NOT NULL, online INTEGER NOT NULL,
        metadata TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        path TEXT, sha256 TEXT, error TEXT, downloaded_at TEXT, attempted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS scans (key TEXT PRIMARY KEY, completed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    return db


def scan(client, db, aoi, start, end, field="ContentDate/Start", history_start=None, force=False):
    """Checkpoint only a fully paginated interval; UUID upserts make retries harmless."""
    scope = hashlib.sha256(aoi.wkb).hexdigest()
    key = f"{scope}:{field}:{iso(start)}:{iso(end)}:{history_start}"
    if not force and db.execute("SELECT 1 FROM scans WHERE key=?", (key,)).fetchone():
        return 0
    bounds = box(*aoi.bounds).wkt
    query = (
        "Collection/Name eq 'SENTINEL-2' and "
        "Attributes/OData.CSC.StringAttribute/any(a:a/Name eq 'productType' "
        "and a/OData.CSC.StringAttribute/Value eq 'S2MSI2A') and "
        f"OData.CSC.Intersects(area=geography'SRID=4326;{bounds}') and "
        f"{field} ge {iso(start)} and {field} lt {iso(end)}"
    )
    if history_start:
        query += f" and ContentDate/Start ge {iso(history_start)}"
    url = CATALOGUE
    params = {"$filter": query, "$top": 1000, "$orderby": f"{field} asc,Id asc"}
    count, pages = 0, set()
    while url:
        if urlparse(url).scheme != "https" or urlparse(url).netloc != urlparse(CATALOGUE).netloc:
            raise ValueError("Unexpected catalogue pagination host")
        if url in pages:
            raise ValueError("Repeated catalogue pagination link")
        pages.add(url)
        response = client.get(url, params=params, timeout=(15, 120))
        response.raise_for_status()
        data = response.json()
        for product in data["value"]:
            if not aoi.intersects(shape(product["GeoFootprint"])):
                continue
            db.execute(
                """INSERT INTO products(id,name,acquired,published,bytes,online,metadata)
              VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
              online=excluded.online, metadata=excluded.metadata, bytes=excluded.bytes""",
                (
                    product["Id"],
                    product["Name"],
                    product["ContentDate"]["Start"],
                    product["PublicationDate"],
                    product["ContentLength"],
                    product["Online"],
                    json.dumps(product),
                ),
            )
            count += 1
        db.commit()
        url = data.get("@odata.nextLink") or data.get("@OData.nextLink")
        params = None
    db.execute("INSERT OR REPLACE INTO scans VALUES(?,?)", (key, iso(datetime.now(UTC))))
    db.commit()
    return count


def discover(client, db, aoi, start, end, force=False):
    for first, last in monthly_windows(start, end):
        count = scan(client, db, aoi, first, last, force=force)
        print(
            f"Catalogue {first.date()} to {last.date()} (exclusive): {count} scenes, or checkpoint reused",
            flush=True,
        )


def sync_catalogue(client, db, aoi, history_start, now):
    # Save a starting publication cursor BEFORE backfill, so products published while
    # an interrupted backfill is running are still found when it eventually completes.
    scope = hashlib.sha256(aoi.wkb + iso(history_start).encode()).hexdigest()
    key = "publication:" + scope
    row = db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    since = timestamp(row[0]) if row else now - timedelta(days=14)
    if not row:
        db.execute("INSERT INTO state VALUES(?,?)", (key, iso(since)))
        db.commit()
    # Complete calendar months have durable checkpoints. The current partial month
    # is intentionally refreshed each day.
    discover(client, db, aoi, history_start, now.replace(hour=0, minute=0, second=0, microsecond=0))
    for first, last in monthly_windows(since - timedelta(days=2), now):
        scan(client, db, aoi, first, last, "PublicationDate", history_start, force=True)
    db.execute("UPDATE state SET value=? WHERE key=?", (iso(now), key))
    db.commit()


def summary(db):
    rows = db.execute("""SELECT substr(acquired,1,4) year, COUNT(*) scenes,
       SUM(bytes) estimated_bytes, SUM(status='complete') downloaded,
       SUM(status='failed') failed, SUM(online=0) offline
       FROM products GROUP BY year ORDER BY year""").fetchall()
    return [dict(row) for row in rows]
