"""Sequential authenticated downloads with atomic completion and integrity checks."""

import hashlib
import json
import os
import re
import shutil
import time
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse
from uuid import UUID

import keyring
import requests

from .catalogue import CATALOGUE, iso

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
DOWNLOAD = "https://download.dataspace.copernicus.eu/odata/v1/Products"
SERVICE = "sturdy-potato-cdse"


class Auth:
    def __init__(self, username=None):
        self.username = os.environ.get("CDSE_USERNAME") or username
        self.access = None
        self.refresh = None
        self.expires = 0

    def token(self, force=False):
        if not force and self.access and time.monotonic() < self.expires:
            return self.access
        data = {"client_id": "cdse-public"}
        if self.refresh:
            data.update(grant_type="refresh_token", refresh_token=self.refresh)
        else:
            password = os.environ.get("CDSE_PASSWORD")
            if not password and self.username:
                password = keyring.get_password(SERVICE, self.username)
            if not self.username or not password:
                raise RuntimeError(
                    "Run 'sentinel-archive credentials' or set CDSE_USERNAME and CDSE_PASSWORD"
                )
            data.update(grant_type="password", username=self.username, password=password)
            if os.environ.get("CDSE_TOTP"):
                data["totp"] = os.environ["CDSE_TOTP"]
        response = requests.post(TOKEN_URL, data=data, timeout=(15, 60))
        if response.status_code in (400, 401) and self.refresh:
            self.refresh = None
            return self.token(force=True)
        if response.status_code != 200:
            raise RuntimeError(
                f"CDSE authentication failed (HTTP {response.status_code}); check credentials/2FA"
            )
        payload = response.json()
        self.access = payload["access_token"]
        self.refresh = payload.get("refresh_token")
        self.expires = time.monotonic() + max(0, payload["expires_in"] - 60)
        return self.access


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_zip(path):
    with zipfile.ZipFile(path) as archive:
        if not any(name.endswith("/MTD_MSIL2A.xml") for name in archive.namelist()):
            raise ValueError("Downloaded ZIP is not a Sentinel-2 L2A SAFE product")
        bad = archive.testzip()
        if bad:
            raise ValueError("ZIP member failed CRC verification")
    return sha256(path)


def open_download(client, url, auth):
    """Forward bearer tokens only to HTTPS CDSE hosts, including official redirects."""
    for _ in range(6):
        parsed = urlparse(url)
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".dataspace.copernicus.eu"):
            raise ValueError("Unexpected download redirect host")
        response = client.get(
            url,
            headers={"Authorization": f"Bearer {auth.token()}", "Accept-Encoding": "identity"},
            stream=True,
            allow_redirects=False,
            timeout=(15, 120),
        )
        if response.status_code == 401:
            response.close()
            auth.token(force=True)
            continue
        if response.status_code in (301, 302, 303, 307, 308):
            url = urljoin(url, response.headers["Location"])
            response.close()
            continue
        response.raise_for_status()
        return response
    raise RuntimeError("Too many download redirects/authentication failures")


def download_one(client, auth, product, root, reserve_gb):
    product_id = str(UUID(product["id"]))
    name = product["name"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.SAFE", name):
        raise ValueError("Unexpected product name")
    year, month = product["acquired"][:7].split("-")
    target = root / "raw" / year / month / product_id / (name + ".zip")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Recovery after a crash between atomic rename and the SQLite commit.
    if target.exists():
        digest = validate_zip(target)
        target.with_suffix(".json").write_text(product["metadata"])
        return target, digest
    reserve = int(reserve_gb * 1_000_000_000)
    if shutil.disk_usage(root).free < product["bytes"] * 1.1 + reserve:
        raise OSError("Insufficient free archive space; free space or change the archive location")
    part = target.with_suffix(target.suffix + ".part")
    # Interrupted transfers restart this product; completed products are never re-downloaded.
    try:
        with open_download(client, f"{DOWNLOAD}({product_id})/$value", auth) as response:
            expected = int(response.headers.get("Content-Length", 0))
            written = 0
            with part.open("wb") as output:
                for chunk in response.iter_content(8 * 1024 * 1024):
                    if shutil.disk_usage(root).free < reserve + len(chunk):
                        raise OSError("Archive free-space reserve reached")
                    output.write(chunk)
                    written += len(chunk)
                output.flush()
                os.fsync(output.fileno())
            if expected and expected != written:
                raise ValueError("Incomplete HTTP download")
        digest = validate_zip(part)
        part.replace(target)
        target.with_suffix(".json").write_text(product["metadata"])
        return target, digest
    finally:
        part.unlink(missing_ok=True)


def download_pending(client, db, auth, root, limit=10, reserve_gb=20):
    if not root.is_dir():
        raise ValueError("Archive directory is missing. Mount the NAS/disk before running.")
    # Check auth before changing queue state. Secrets are never stored in the manifest.
    auth.token()
    products = db.execute(
        """SELECT * FROM products WHERE status!='complete'
      ORDER BY attempted_at IS NOT NULL, attempted_at, acquired>=? DESC, acquired,id LIMIT ?""",
        (iso(datetime.now(UTC) - timedelta(days=30)), limit),
    ).fetchall()
    failures, downloaded = 0, 0
    for product in products:
        db.execute("UPDATE products SET attempted_at=? WHERE id=?", (iso(datetime.now(UTC)), product["id"]))
        try:
            # Offline products may become online later; never silently mark them complete.
            if not product["online"]:
                response = client.get(f"{CATALOGUE}({product['id']})", timeout=(15, 120))
                response.raise_for_status()
                online = response.json()["Online"]
                db.execute("UPDATE products SET online=? WHERE id=?", (online, product["id"]))
                if not online:
                    raise RuntimeError("Product is offline at CDSE; retry on a later run")
            print(f"Downloading {product['name']}", flush=True)
            path, digest = download_one(client, auth, product, root, reserve_gb)
            db.execute(
                """UPDATE products SET status='complete',path=?,sha256=?,error=NULL,
              downloaded_at=? WHERE id=?""",
                (str(path), digest, iso(datetime.now(UTC)), product["id"]),
            )
            downloaded += 1
        except (requests.RequestException, ValueError, RuntimeError, OSError, zipfile.BadZipFile) as exc:
            # Do not retain remote bodies or URLs that might contain tokens.
            error = type(exc).__name__
            db.execute("UPDATE products SET status='failed',error=? WHERE id=?", (error, product["id"]))
            print(f"Failed {product['name']}: {error}", flush=True)
            failures += 1
            if isinstance(exc, OSError) and not isinstance(exc, requests.RequestException):
                db.commit()
                raise
        db.commit()
    print(json.dumps({"downloaded_this_run": downloaded, "failed_this_run": failures}))
    if failures:
        raise RuntimeError(f"{failures} product downloads failed; retained for retry")
