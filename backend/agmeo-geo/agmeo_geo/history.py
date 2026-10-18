"""Imagery history per field boundary, read from Earth Search.

A job per field boundary version (``field_imagery_jobs``) backfills every acquisition since
``Settings.history_from``; later runs of the same job only look for newer acquisitions.
A job last finished with an older ``PROCESSING_VERSION`` is queued again and rescans its
whole history, so a version bump backfills every field.
Jobs are processed in batches, acquisition by acquisition: all queued fields covered by an
acquisition are read from the same open datasets, so neighbouring fields share the fetched
COG blocks. Per field, the cloud mask is read first and the bands only when enough of the
field is clear.
"""

import json
import logging
import multiprocessing
import threading
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, timedelta

import httpx
import psycopg
from shapely.geometry import shape

from .config import Settings
from .fieldgrid import utm_epsg
from .observe import OBS_VERSION, FieldTarget, Outcome, observe, store
from .pipeline import connect
from .sources import EarthSearchScene, StacItem
from .stac import search

log = logging.getLogger("agmeo_geo.history")

# indices-2: EVI, BSI and NDTI added.
SCENE_VERSION = "es-c1/indices-2"
PROCESSING_VERSION = f"{SCENE_VERSION}/{OBS_VERSION}"
# Late-arriving items: incremental runs look back this far before covered_until.
LOOKBACK = timedelta(days=10)
BATCH = 50


@dataclass
class Job:
    id: str
    target: FieldTarget
    date_from: date
    covered_until: date | None
    scenes_done: int
    processing_version: str | None = None
    pending: int = 0
    failed_from: date | None = None


def ensure_jobs(conn: psycopg.Connection, settings: Settings, field_id: str | None = None) -> int:
    """Creates a job for every current boundary of an active field that has none yet."""
    rows = conn.execute(
        """
        INSERT INTO field_imagery_jobs (organization_id, field_id, geometry_version_id, date_from)
        SELECT f.organization_id, f.id, g.id, %(from)s
        FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
        WHERE f.status = 'active' AND (%(field)s::uuid IS NULL OR f.id = %(field)s::uuid)
        ON CONFLICT (geometry_version_id) DO NOTHING
        RETURNING id
        """,
        {"from": settings.history_from, "field": field_id},
    ).fetchall()
    conn.commit()
    return len(rows)


def requeue(conn: psycopg.Connection, startup: bool = False) -> int:
    """Queues finished jobs for newer acquisitions or an outdated processing version, failed
    ones for a retry, and (at startup) jobs that were running when the worker stopped."""
    rows = conn.execute(
        """
        UPDATE field_imagery_jobs SET status = 'queued'
        WHERE (status = 'finished' AND (covered_until IS NULL OR covered_until < current_date
                                        OR processing_version IS DISTINCT FROM %(version)s))
           OR (status = 'failed' AND updated_at < now() - interval '1 hour')
           OR (status = 'running' AND %(startup)s)
        RETURNING id
        """,
        {"startup": startup, "version": PROCESSING_VERSION},
    ).fetchall()
    conn.commit()
    return len(rows)


def claim(conn: psycopg.Connection) -> list[Job]:
    rows = conn.execute(
        """
        SELECT j.id, j.field_id, j.organization_id, j.geometry_version_id, j.date_from, j.covered_until,
               j.scenes_done, j.processing_version, ST_AsGeoJSON(g.geometry) AS geometry
        FROM field_imagery_jobs j
        JOIN field_current_geometry g ON g.id = j.geometry_version_id
        JOIN fields f ON f.id = j.field_id AND f.status = 'active'
        WHERE j.status = 'queued'
        ORDER BY j.created_at
        LIMIT %s
        FOR UPDATE OF j SKIP LOCKED
        """,
        (BATCH,),
    ).fetchall()
    if rows:
        conn.execute(
            "UPDATE field_imagery_jobs SET status = 'running', started_at = now(), error = NULL WHERE id = ANY(%s)",
            ([r["id"] for r in rows],),
        )
    conn.commit()
    return [
        Job(
            id=str(r["id"]),
            target=FieldTarget(
                str(r["field_id"]),
                str(r["organization_id"]),
                str(r["geometry_version_id"]),
                json.loads(r["geometry"]),
            ),
            date_from=r["date_from"],
            covered_until=r["covered_until"],
            scenes_done=r["scenes_done"],
            processing_version=r["processing_version"],
        )
        for r in rows
    ]


def best_per_acquisition(items: list[StacItem], target: FieldTarget) -> list[StacItem]:
    """One item per platform and day: tiles overlap, and the same pass appears in several.

    Prefers the item in the field's own UTM zone, then one whose footprint contains the
    whole field, then the less cloudy tile.
    """
    geometry = shape(target.geometry)
    lon, lat = geometry.centroid.coords[0]
    epsg = utm_epsg(lon, lat)
    groups: dict[tuple[str, str], list[StacItem]] = defaultdict(list)
    for item in items:
        groups[(item.platform, item.day)].append(item)

    def rank(item: StacItem):
        return (item.epsg != epsg, not shape(item.geometry).contains(geometry), item.cloud_cover or 100)

    return sorted((min(group, key=rank) for group in groups.values()), key=lambda i: i.acquired_at)


def processed_scene_ids(conn: psycopg.Connection, geometry_version_id: str) -> set[str]:
    rows = conn.execute(
        """
        SELECT DISTINCT s.scene_id FROM field_observations o JOIN satellite_scenes s ON s.id = o.scene_id
        WHERE o.geometry_version_id = %s AND o.processing_version = %s
        """,
        (geometry_version_id, PROCESSING_VERSION),
    ).fetchall()
    return {r["scene_id"] for r in rows}


def register(conn: psycopg.Connection, item: StacItem, collection: str) -> str:
    refs = {
        "collection": collection,
        "item": item.id,
        "epsg": item.epsg,
        "assets": {k: {"href": a.href, "scale": a.scale, "offset": a.offset} for k, a in item.assets.items()},
    }
    row = conn.execute(
        """
        INSERT INTO satellite_scenes (scene_id, platform, product_level, acquired_at, cloud_cover_pct, footprint,
                                      processing_version, asset_refs, tile, clear_fraction, source)
        VALUES (%(id)s, %(platform)s, 'L2A', %(acquired)s, %(cloud)s,
                ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(footprint)s), 4326)),
                %(version)s, %(refs)s, %(tile)s, %(clear)s, 'earth-search')
        ON CONFLICT (scene_id) DO UPDATE SET
          asset_refs = EXCLUDED.asset_refs, processing_version = EXCLUDED.processing_version
        RETURNING id
        """,
        {
            "id": item.id,
            "platform": item.platform,
            "acquired": item.acquired_at,
            "cloud": item.cloud_cover,
            "footprint": json.dumps(item.geometry),
            "version": SCENE_VERSION,
            "refs": json.dumps(refs),
            "tile": item.tile,
            "clear": None if item.cloud_cover is None else round(1 - item.cloud_cover / 100, 4),
        },
    ).fetchone()
    return str(row["id"])


def _read(item: StacItem, targets: list[FieldTarget], settings: Settings, scene_uuid: str) -> list[Outcome]:
    with EarthSearchScene(item, settings.cloud_buffer_m) as reader:
        return [observe(reader, target, settings, scene_uuid) for target in targets]


def run_batch(settings: Settings, stop: threading.Event | None = None) -> int:
    """Processes one batch of queued jobs; returns the number of jobs handled."""
    with connect(settings) as conn:
        jobs = claim(conn)
        if not jobs:
            return 0
        today = date.today()
        plan: dict[str, tuple[StacItem, list[Job]]] = {}

        def find(job: Job):
            incremental = job.covered_until and job.processing_version == PROCESSING_VERSION
            start = max(job.date_from, job.covered_until - LOOKBACK) if incremental else job.date_from
            if stop is not None and stop.is_set():
                return None
            return search(
                settings.stac_url,
                settings.stac_collection,
                job.target.geometry,
                start,
                today,
                settings.max_cloud_cover,
            )

        # Searches are network-bound and independent: run them side by side.
        with ThreadPoolExecutor(max_workers=6) as searches:
            found = {job.id: searches.submit(find, job) for job in jobs}
            for job in jobs:
                try:
                    items = found[job.id].result()
                except httpx.HTTPError as exc:
                    log.warning("Search for job %s failed: %s", job.id, exc)
                    conn.execute(
                        "UPDATE field_imagery_jobs SET status = 'failed', error = %s WHERE id = %s",
                        (f"Imagery search failed: {exc}", job.id),
                    )
                    conn.commit()
                    job.pending = -1
                    continue
                if items is None:  # stopping
                    conn.execute("UPDATE field_imagery_jobs SET status = 'queued' WHERE id = %s", (job.id,))
                    job.pending = -1
                    continue
                done = processed_scene_ids(conn, job.target.geometry_version_id)
                pending = [i for i in best_per_acquisition(items, job.target) if i.id not in done]
                job.pending = len(pending)
                for item in pending:
                    plan.setdefault(item.id, (item, []))[1].append(job)
                # Progress counts acquisitions processed for this boundary, whichever run did them.
                conn.execute(
                    "UPDATE field_imagery_jobs SET scenes_done = %s, scenes_total = %s WHERE id = %s",
                    (len(done), len(done) + len(pending), job.id),
                )
        conn.commit()
        active = [j for j in jobs if j.pending >= 0]
        scene_uuids = {
            item_id: register(conn, item, settings.stac_collection) for item_id, (item, _) in plan.items()
        }
        conn.commit()
        log.info("Imagery batch: %d fields, %d acquisitions to read", len(active), len(plan))

        # Processes, not threads: opening remote datasets holds the GIL in GDAL bindings, which
        # serialises threads on network latency.
        with ProcessPoolExecutor(
            max_workers=settings.read_workers, mp_context=multiprocessing.get_context("spawn")
        ) as pool:
            futures = {}
            for item_id, (item, item_jobs) in plan.items():
                futures[
                    pool.submit(_read, item, [j.target for j in item_jobs], settings, scene_uuids[item_id])
                ] = (
                    item,
                    item_jobs,
                )
            for n, future in enumerate(as_completed(futures), start=1):
                item, item_jobs = futures[future]
                try:
                    outcomes = future.result()
                except Exception as exc:  # noqa: BLE001 - network errors, corrupt COGs
                    log.warning("Reading %s failed: %s", item.id, exc)
                    for job in item_jobs:
                        day = item.acquired_at.date()
                        job.failed_from = min(job.failed_from or day, day)
                    outcomes = []
                for outcome in outcomes:
                    store(
                        conn,
                        outcome,
                        scene_uuids[item.id],
                        item.acquired_at.date(),
                        PROCESSING_VERSION,
                        settings,
                    )
                conn.execute(
                    "UPDATE field_imagery_jobs SET scenes_done = scenes_done + 1 WHERE id = ANY(%s)",
                    ([j.id for j in item_jobs],),
                )
                conn.commit()
                if n % 50 == 0:
                    log.info("Imagery batch: %d of %d acquisitions read", n, len(plan))
                if stop is not None and stop.is_set():
                    pool.shutdown(wait=True, cancel_futures=True)
                    break

        interrupted = stop is not None and stop.is_set()
        for job in active:
            if interrupted:
                conn.execute("UPDATE field_imagery_jobs SET status = 'queued' WHERE id = %s", (job.id,))
                continue
            # Acquisitions that could not be read are retried by the next incremental run.
            covered = job.failed_from - timedelta(days=1) if job.failed_from else today
            conn.execute(
                """
                UPDATE field_imagery_jobs SET status = 'finished', finished_at = now(), covered_until = %s,
                  processing_version = %s, error = %s WHERE id = %s
                """,
                (
                    covered,
                    PROCESSING_VERSION,
                    "Some acquisitions could not be read; retrying later" if job.failed_from else None,
                    job.id,
                ),
            )
        conn.commit()
        return len(jobs)


def run_all(settings: Settings, stop: threading.Event | None = None) -> int:
    handled = 0
    while not (stop and stop.is_set()):
        n = run_batch(settings, stop)
        if n == 0:
            break
        handled += n
    return handled
