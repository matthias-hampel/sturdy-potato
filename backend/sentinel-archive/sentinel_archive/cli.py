import argparse
import fcntl
import getpass
import json
import plistlib
import sys
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import keyring
import requests

from .catalogue import connect, discover, load_aoi, session, summary, sync_catalogue, timestamp
from .derive import derive_product, pending
from .download import SERVICE, Auth, download_pending, sha256
from .indices import FORMULAS, NATIVE_10M
from .processing import process

REPO = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO / "config/local.json"


@contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another archive command is running") from None
        yield


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def parser():
    result = argparse.ArgumentParser(description="Archive Sentinel-2 L2A data for Niedersachsen")
    result.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    commands = result.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create local configuration")
    init.add_argument("--archive", type=Path, default=REPO / ".data/archive")
    init.add_argument("--start", default="2020-01-01")
    init.add_argument("--aoi", type=Path, default=REPO / "config/niedersachsen.geojson")
    commands.add_parser("credentials", help="Prompt locally and store password in the OS keyring")
    catalogue = commands.add_parser("discover", help="Catalogue only; no imagery or login")
    catalogue.add_argument("--start")
    catalogue.add_argument("--end", help="Exclusive end date; defaults to today UTC")
    catalogue.add_argument("--refresh", action="store_true")
    commands.add_parser("status", help="Show scene count, estimated volume and download state")
    download = commands.add_parser("download", help="Download queued scenes")
    download.add_argument("--limit", type=positive, default=10)
    sync = commands.add_parser("sync", help="Historical backfill + new publications + bounded downloads")
    sync.add_argument("--limit", type=positive, default=100)
    sync.add_argument("--catalogue-only", action="store_true")
    verify = commands.add_parser("verify", help="Verify archived SHA-256 hashes")
    verify.add_argument(
        "--requeue", action="store_true", help="Requeue missing files (corrupt files need manual removal)"
    )
    indices = commands.add_parser("process", help="Compute spectral indices from a downloaded SAFE ZIP")
    indices.add_argument("source", type=Path)
    indices.add_argument("--output", type=Path, required=True)
    indices.add_argument("--indices", default="NDVI,NDRE,NDMI", help="Comma-separated names, or all")
    indices.add_argument(
        "--resolution",
        type=int,
        choices=(10, 20),
        default=20,
        help=f"Output grid in metres; 10 only for {', '.join(NATIVE_10M)}",
    )
    indices.add_argument(
        "--cloud-buffer",
        type=float,
        default=300,
        help="Also mask pixels within this many metres of cloud/shadow (haze); 0 disables",
    )
    derive = commands.add_parser(
        "derive", help="Compute per-scene index products (NDVI 10 m, NDRE/NDMI 20 m) with a manifest"
    )
    derive.add_argument("--limit", type=positive, default=10)
    derive.add_argument("--cloud-buffer", type=float, default=300)
    schedule = commands.add_parser("schedule", help="Generate a daily launchd job; does not install it")
    schedule.add_argument("--hour", type=int, default=4)
    schedule.add_argument("--limit", type=positive, default=100)
    schedule.add_argument("--output", type=Path, default=REPO / ".data/de.sturdy-potato.sentinel.plist")
    return result


def run(args):
    config_path = args.config.expanduser().resolve()
    if args.command == "init":
        if config_path.exists():
            raise ValueError("Configuration already exists; edit it to change settings")
        archive = args.archive.expanduser().resolve()
        if archive == (REPO / ".data/archive").resolve():
            archive.mkdir(parents=True, exist_ok=True)
        elif not archive.is_dir():
            raise ValueError("Archive folder must already exist; mount the disk/NAS and create it first")
        timestamp(args.start)
        load_aoi(args.aoi)
        config = {
            "archive": str(archive),
            "database": str(REPO / ".data/catalogue.sqlite"),
            "aoi": str(args.aoi.resolve()),
            "start": args.start,
            "reserve_gb": 20,
            "username": None,
        }
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        print(f"Configuration: {config_path}")
        return
    if not config_path.exists():
        raise ValueError("Run 'sentinel-archive init' first")
    config = json.loads(config_path.read_text())
    root = Path(config["archive"])
    database = Path(config["database"])
    if args.command == "credentials":
        username = input("CDSE email: ").strip()
        password = getpass.getpass("CDSE password (stored in OS keyring): ")
        if not username or not password:
            raise ValueError("Username and password must not be empty")
        keyring.set_password(SERVICE, username, password)
        config["username"] = username
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        print("Credentials saved in OS keyring. Password was not written to the configuration.")
        return
    if args.command == "schedule":
        if not 0 <= args.hour <= 23:
            raise ValueError("Hour must be 0..23")
        executable = REPO / ".venv/bin/sentinel-archive"
        if not executable.exists():
            raise ValueError("Run uv sync first")
        logs = REPO / ".data/logs"
        logs.mkdir(parents=True, exist_ok=True)
        job = {
            "Label": "de.sturdy-potato.sentinel",
            "ProgramArguments": [
                str(executable),
                "--config",
                str(config_path),
                "sync",
                "--limit",
                str(args.limit),
            ],
            "WorkingDirectory": str(REPO),
            "StartCalendarInterval": {"Hour": args.hour, "Minute": 0},
            "StandardOutPath": str(logs / "sync.log"),
            "StandardErrorPath": str(logs / "sync-error.log"),
            "ProcessType": "Background",
            "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"},
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(plistlib.dumps(job))
        print(f"Generated {args.output.resolve()}; not installed. See README for fish activation commands.")
        return
    with lock(database.with_suffix(".lock")), connect(database) as db, session() as client:
        if args.command == "status":
            print(json.dumps(summary(db), indent=2))
        elif args.command == "discover":
            start = timestamp(args.start or config["start"])
            end = (
                timestamp(args.end)
                if args.end
                else datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            )
            if start >= end:
                raise ValueError("Start must be before exclusive end")
            discover(client, db, load_aoi(config["aoi"]), start, end, args.refresh)
            print(json.dumps(summary(db), indent=2))
        elif args.command in ("download", "sync"):
            if not root.is_dir():
                raise ValueError("Archive folder missing; mount your archive disk/NAS")
            if args.command == "sync":
                sync_catalogue(
                    client,
                    db,
                    load_aoi(config["aoi"]),
                    timestamp(config["start"]),
                    datetime.now(UTC) - timedelta(minutes=5),
                )
                if args.catalogue_only:
                    print(json.dumps(summary(db), indent=2))
                    return
            download_pending(client, db, Auth(config.get("username")), root, args.limit, config["reserve_gb"])
        elif args.command == "process":
            if args.indices == "all":
                selected = NATIVE_10M if args.resolution == 10 else list(FORMULAS)
            else:
                selected = args.indices.split(",")
            print(
                process(
                    args.source,
                    args.output,
                    selected,
                    load_aoi(config["aoi"]),
                    args.resolution,
                    args.cloud_buffer,
                )
            )
        elif args.command == "derive":
            if not root.is_dir():
                raise ValueError("Archive folder missing; mount your archive disk/NAS")
            rows = pending(db, root, args.limit)
            if not rows:
                print("All downloaded products have derived index products")
            for row in rows:
                manifest = derive_product(row, root, args.cloud_buffer)
                print(f"{row['name']}: clear {manifest['clear_fraction']:.0%}")
        elif args.command == "verify":
            if not root.is_dir():
                raise ValueError("Mount archive before verifying; missing mount is not missing data")
            failures = 0
            for row in db.execute("SELECT * FROM products WHERE status='complete'").fetchall():
                path = Path(row["path"])
                if not path.exists() or sha256(path) != row["sha256"]:
                    failures += 1
                    print(f"Missing/corrupt: {path}")
                    if args.requeue and not path.exists():
                        db.execute("UPDATE products SET status='pending' WHERE id=?", (row["id"],))
            db.commit()
            if failures:
                raise RuntimeError(f"{failures} files failed integrity verification")
            print("All completed downloads passed SHA-256 verification")


def main():
    args = parser().parse_args()
    try:
        run(args)
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except (ValueError, RuntimeError, OSError, requests.RequestException, keyring.errors.KeyringError) as exc:
        # HTTP exceptions can contain redirect URLs; report only their status, not their body.
        message = type(exc).__name__ if isinstance(exc, requests.RequestException) else str(exc)
        print(f"Error: {message}", file=sys.stderr)
        raise SystemExit(1) from None
