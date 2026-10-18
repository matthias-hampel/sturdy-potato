"""Scene registration and field observations.

Every step is idempotent: `reconcile` computes whatever (field boundary, scene) pairs are
missing, so events only make the pipeline faster, never required for correctness.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .config import Settings

log = logging.getLogger("agmeo_geo")


def connect(settings: Settings) -> psycopg.Connection:
    return psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=False)


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------


def manifests(archive: Path):
    """Complete derived products written by `sentinel-archive derive`."""
    for path in sorted((archive / "derived" / "products").glob("*/manifest.json")):
        try:
            manifest = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Skipping unreadable manifest %s: %s", path, exc)
            continue
        manifest["_dir"] = str(path.parent.relative_to(archive))
        yield manifest


def register_scenes(conn: psycopg.Connection, archive: Path) -> list[str]:
    """Upserts satellite_scenes from the manifests; returns ids of new or changed scenes."""
    changed = []
    for m in manifests(archive):
        refs = {"dir": m["_dir"], "product_id": m["product_id"], "assets": m["assets"]}
        row = conn.execute(
            """
            INSERT INTO satellite_scenes (scene_id, platform, product_level, acquired_at, footprint,
                                          processing_version, asset_refs, tile, clear_fraction)
            VALUES (%(scene)s, %(platform)s, %(level)s, %(acquired)s,
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(footprint)s), 4326)),
                    %(version)s, %(refs)s, %(tile)s, %(clear)s)
            ON CONFLICT (scene_id) DO UPDATE SET
              processing_version = EXCLUDED.processing_version,
              asset_refs = EXCLUDED.asset_refs,
              clear_fraction = EXCLUDED.clear_fraction,
              footprint = EXCLUDED.footprint
            WHERE satellite_scenes.processing_version IS DISTINCT FROM EXCLUDED.processing_version
               OR satellite_scenes.asset_refs IS DISTINCT FROM EXCLUDED.asset_refs
            RETURNING id
            """,
            {
                "scene": m["product_name"],
                "platform": m["platform"],
                "level": m.get("product_level", "L2A"),
                "acquired": m["acquired_at"],
                "footprint": json.dumps(m["footprint"]),
                "version": m["processing_version"],
                "refs": json.dumps(refs),
                "tile": m.get("tile"),
                "clear": m.get("clear_fraction"),
            },
        ).fetchone()
        if row:
            changed.append(str(row["id"]))
            log.info("Registered scene %s (%s)", m["product_name"], m["acquired_at"][:10])
    conn.commit()
    return changed


@dataclass(frozen=True)
class Scene:
    id: str
    acquired_at: datetime
    processing_version: str
    dir: Path
    assets: dict


def scene_from_row(row, archive: Path) -> Scene:
    """From a MISSING_PAIRS row (scene columns prefixed by their alias)."""
    refs = row["asset_refs"]
    return Scene(
        id=str(row["scene_id"]),
        acquired_at=row["acquired_at"],
        processing_version=row["processing_version"],
        dir=archive / refs["dir"],
        assets=refs["assets"],
    )


# ---------------------------------------------------------------------------
# Observations
# ---------------------------------------------------------------------------

# Pairs of current field boundaries and intersecting archive scenes that have no observation
# for that boundary version and processing version yet.
MISSING_PAIRS = """
SELECT f.id AS field_id, f.organization_id, g.id AS geometry_version_id,
       ST_AsGeoJSON(g.geometry) AS geometry,
       s.id AS scene_id, s.acquired_at, s.processing_version, s.asset_refs
FROM fields f
JOIN field_current_geometry g ON g.field_id = f.id
JOIN satellite_scenes s ON ST_Intersects(s.footprint, g.geometry)
WHERE f.status = 'active' AND s.source = 'archive'
  AND (%(field)s::uuid IS NULL OR f.id = %(field)s::uuid)
  AND (%(scenes)s::uuid[] IS NULL OR s.id = ANY(%(scenes)s::uuid[]))
  AND NOT EXISTS (
    SELECT 1 FROM field_observations o
    WHERE o.field_id = f.id AND o.scene_id = s.id
      AND o.geometry_version_id = g.id
      AND o.processing_version = s.processing_version || '/' || %(zonal)s
  )
ORDER BY s.acquired_at, f.id
"""


def compute(conn: psycopg.Connection, settings: Settings, field_id: str | None = None, scene_ids=None) -> int:
    """Computes and stores all missing observations of archive scenes, optionally limited."""
    from .observe import OBS_VERSION, FieldTarget, observe, store
    from .sources import ArchiveScene

    pairs = conn.execute(
        MISSING_PAIRS, {"field": field_id, "scenes": scene_ids, "zonal": OBS_VERSION}
    ).fetchall()
    if not pairs:
        return 0
    written = 0
    by_scene: dict[str, list] = {}
    for pair in pairs:
        by_scene.setdefault(str(pair["scene_id"]), []).append(pair)
    for rows in by_scene.values():
        scene = scene_from_row(rows[0], settings.archive)
        version = f"{scene.processing_version}/{OBS_VERSION}"
        with ArchiveScene(scene.dir, scene.assets) as reader:
            for pair in rows:
                target = FieldTarget(
                    str(pair["field_id"]),
                    str(pair["organization_id"]),
                    str(pair["geometry_version_id"]),
                    json.loads(pair["geometry"]),
                )
                outcome = observe(reader, target, settings, scene.id)
                written += store(conn, outcome, scene.id, scene.acquired_at.date(), version, settings)
        conn.commit()
    log.info("Wrote %d observations for %d field/scene pairs", written, len(pairs))
    return written


def reconcile(settings: Settings) -> int:
    """Registers new scenes and fills every missing observation."""
    with connect(settings) as conn:
        register_scenes(conn, settings.archive)
        return compute(conn, settings)
