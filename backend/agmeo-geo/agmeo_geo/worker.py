"""Background worker: reacts to field events from NATS, backfills imagery history per field and
periodically picks up new archive scenes and new acquisitions."""

import asyncio
import json
import logging
import signal
import threading

import nats
from nats.errors import TimeoutError as NatsTimeout
from nats.js.api import ConsumerConfig, DeliverPolicy

from . import appmaps, history, productivity, soil
from .config import Settings
from .pipeline import compute, connect, reconcile, register_scenes

log = logging.getLogger("agmeo_geo.worker")

STREAM = "AGMEO_EVENTS"
DURABLE = "agmeo-geo-fields"
SUBJECT = "agmeo.events.field.>"
HANDLED = {"field.created", "field.geometry_updated"}


def _field_changed(settings: Settings, field_id: str) -> int:
    with connect(settings) as conn:
        history.ensure_jobs(conn, settings, field_id)
        return compute(conn, settings, field_id=field_id)


def _scan(settings: Settings) -> int:
    with connect(settings) as conn:
        history.ensure_jobs(conn, settings)
        history.requeue(conn)
        new = register_scenes(conn, settings.archive)
        return compute(conn, settings, scene_ids=new) if new else 0


def _startup(settings: Settings) -> int:
    written = reconcile(settings)
    with connect(settings) as conn:
        history.ensure_jobs(conn, settings)
        history.requeue(conn, startup=True)
    return written


async def run(settings: Settings) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    # Catch up on anything missed while the worker was down.
    written = await asyncio.to_thread(_startup, settings)
    log.info("Startup reconciliation wrote %d observations", written)

    nc = await nats.connect(settings.nats_url, name="agmeo-geo", max_reconnect_attempts=-1)
    js = nc.jetstream()
    subscription = await js.pull_subscribe(
        SUBJECT,
        durable=DURABLE,
        stream=STREAM,
        config=ConsumerConfig(deliver_policy=DeliverPolicy.NEW, ack_wait=300, max_deliver=10),
    )

    wake = asyncio.Event()
    halt = threading.Event()
    stop_task = asyncio.create_task(stop.wait())
    stop_task.add_done_callback(lambda _: (halt.set(), wake.set()))

    async def backfill():
        while not stop.is_set():
            # Cleared before the run, so an event arriving during it triggers another one.
            wake.clear()
            try:
                handled = await asyncio.to_thread(history.run_all, settings, halt)
                if handled:
                    log.info("Imagery history: %d jobs handled", handled)
            except Exception:
                log.exception("Imagery history batch failed")
            try:
                await asyncio.wait_for(wake.wait(), timeout=60)
            except TimeoutError:
                pass

    async def analyses():
        # Requests are rows in productivity_analyses, soil_zonations and zoning_jobs; polling keeps the API free of a NATS
        # dependency for them and picks up analyses queued after a backfill.
        while not stop.is_set():
            try:
                handled = await asyncio.to_thread(productivity.run_queued, settings)
                if handled:
                    log.info("Productivity: %d analyses handled", handled)
            except Exception:
                log.exception("Productivity analyses failed")
            try:
                handled = await asyncio.to_thread(soil.run_queued, settings)
                if handled:
                    log.info("Soil zonations: %d handled", handled)
            except Exception:
                log.exception("Soil zonations failed")
            try:
                handled = await asyncio.to_thread(appmaps.run_queued, settings)
                if handled:
                    log.info("Application-map zonings: %d handled", handled)
            except Exception:
                log.exception("Application-map zonings failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=10)
            except TimeoutError:
                pass

    async def consume():
        while not stop.is_set():
            try:
                messages = await subscription.fetch(batch=10, timeout=5)
            except NatsTimeout:
                continue
            for msg in messages:
                try:
                    event = json.loads(msg.data)
                    if event.get("type") in HANDLED:
                        field_id = event["payload"]["fieldId"]
                        written = await asyncio.to_thread(_field_changed, settings, field_id)
                        log.info("%s %s: %d observations", event["type"], field_id, written)
                        wake.set()
                    await msg.ack()
                except Exception:
                    log.exception("Handling %s failed; will be redelivered", msg.subject)
                    await msg.nak(delay=30)

    async def scan():
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.scan_interval_s)
            except TimeoutError:
                try:
                    written = await asyncio.to_thread(_scan, settings)
                    wake.set()
                    if written:
                        log.info("New scenes: %d observations", written)
                except Exception:
                    log.exception("Scene scan failed")

    log.info(
        "Listening on %s (%s), scanning %s every %ds",
        SUBJECT,
        DURABLE,
        settings.archive,
        settings.scan_interval_s,
    )
    await asyncio.gather(consume(), scan(), backfill(), analyses())
    await nc.drain()
