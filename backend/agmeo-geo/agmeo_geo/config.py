"""Settings from environment variables; defaults match the local docker compose setup."""

import json
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ARCHIVE_CONFIG = REPO / "backend/sentinel-archive/config/local.json"


def _archive_default() -> str:
    # Same archive as the sentinel-archive CLI, unless configured explicitly.
    if ARCHIVE_CONFIG.exists():
        return json.loads(ARCHIVE_CONFIG.read_text())["archive"]
    return str(Path.home() / "Documents/sentinel-2")


@dataclass(frozen=True)
class Settings:
    database_url: str
    nats_url: str
    archive: Path
    tiles_host: str
    tiles_port: int
    scan_interval_s: int
    # Field rasters (small per-field GeoTIFFs) are written below this directory.
    data_dir: Path = REPO / ".data/agmeo-geo"
    # Field statistics: inward buffer against mixed edge pixels, and validity thresholds.
    inner_buffer_m: float = 10.0
    min_valid_fraction: float = 0.65
    min_valid_pixels: int = 20
    # Imagery history from Earth Search (cloud-hosted Sentinel-2 L2A COGs, no account needed).
    stac_url: str = "https://earth-search.aws.element84.com/v1"
    stac_collection: str = "sentinel-2-c1-l2a"
    history_from: date = date(2018, 1, 1)
    # Acquisitions whose tile is cloudier than this are not even looked at.
    max_cloud_cover: float = 90.0
    # Below this clear share of a field, only the cloud mask is read (not the bands).
    min_read_fraction: float = 0.3
    cloud_buffer_m: float = 300.0
    read_workers: int = 8


def load() -> Settings:
    return Settings(
        database_url=os.environ.get(
            "AGMEO_GEO_DATABASE_URL", "postgresql://agmeo_geo_worker:agmeo_geo_worker@localhost:5434/agmeo"
        ),
        nats_url=os.environ.get("NATS_URL", "nats://localhost:4222"),
        archive=Path(os.environ.get("SENTINEL_ARCHIVE", _archive_default())).expanduser(),
        tiles_host=os.environ.get("AGMEO_GEO_HOST", "127.0.0.1"),
        tiles_port=int(os.environ.get("AGMEO_GEO_PORT", "3002")),
        scan_interval_s=int(os.environ.get("AGMEO_GEO_SCAN_INTERVAL", "600")),
        data_dir=Path(os.environ.get("AGMEO_GEO_DATA", str(REPO / ".data/agmeo-geo"))).expanduser(),
        stac_url=os.environ.get("AGMEO_GEO_STAC_URL", "https://earth-search.aws.element84.com/v1"),
        stac_collection=os.environ.get("AGMEO_GEO_STAC_COLLECTION", "sentinel-2-c1-l2a"),
        history_from=date.fromisoformat(os.environ.get("AGMEO_GEO_HISTORY_FROM", "2018-01-01")),
        read_workers=int(os.environ.get("AGMEO_GEO_READ_WORKERS", "8")),
    )
