import argparse
import asyncio
import logging

import uvicorn

from . import history, productivity, worker
from .config import load
from .pipeline import compute, connect, reconcile, register_scenes
from .tiles import create_app


def main():
    parser = argparse.ArgumentParser(prog="agmeo-geo", description="agmeo satellite pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("worker", help="Process field events from NATS and pick up new scenes")
    commands.add_parser("reconcile", help="Register scenes and compute all missing field observations once")
    recompute = commands.add_parser("recompute-field", help="Compute missing observations for one field")
    recompute.add_argument("field_id")
    backfill = commands.add_parser(
        "history", help="Backfill imagery history from Earth Search (all fields or one)"
    )
    backfill.add_argument("field_id", nargs="?")
    commands.add_parser("productivity", help="Compute queued productivity analyses (and queue missing ones)")
    commands.add_parser("serve", help="Serve index map tiles (internal, behind the agmeo API)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("rasterio.session").setLevel(logging.WARNING)
    settings = load()
    if args.command == "worker":
        asyncio.run(worker.run(settings))
    elif args.command == "reconcile":
        print(f"{reconcile(settings)} observations written")
    elif args.command == "recompute-field":
        with connect(settings) as conn:
            register_scenes(conn, settings.archive)
            print(f"{compute(conn, settings, field_id=args.field_id)} observations written")
    elif args.command == "history":
        with connect(settings) as conn:
            history.ensure_jobs(conn, settings, args.field_id)
            history.requeue(conn)
        print(f"{history.run_all(settings)} imagery jobs handled")
    elif args.command == "productivity":
        print(f"{productivity.run_queued(settings)} productivity analyses handled")
    elif args.command == "serve":
        uvicorn.run(
            create_app(settings), host=settings.tiles_host, port=settings.tiles_port, log_level="info"
        )


if __name__ == "__main__":
    main()
