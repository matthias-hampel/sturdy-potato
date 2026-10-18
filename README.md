# sturdy-potato

This repository contains **agmeo**, a farm management system for arable farms, and the
Sentinel-2 archive tooling that will feed its crop monitoring.

## agmeo

| Part | Path | Stack |
|---|---|---|
| Web app | [`frontend/agmeo`](frontend/agmeo/README.md) | TanStack Start, React Aria Components, Tailwind CSS, MapLibre |
| API + worker | `backend/agmeo-api` | NestJS 12, Kysely, PostgreSQL RLS, NATS JetStream outbox |
| Contracts | `packages/contracts` | zod schemas and response types shared by API and web |
| Migrations | `db/migrations` | golang-migrate, PostgreSQL 18 + PostGIS 3.6 |
| Satellite pipeline | [`backend/agmeo-geo`](backend/agmeo-geo/README.md) | Python: per-field Sentinel-2 history (Earth Search + archive), productivity zones, tile server |

Modules: farms and organizations with roles, fields with versioned GIS boundaries
(draw, import GeoJSON/KML/Shapefile, export), crop seasons and rotations, field operations
(multi-field, products, labor, machinery) that update stock and costs on completion, tasks
and calendar, inventory ledger, machinery and maintenance, team and employees, weather and
spray windows, Sentinel-2 crop monitoring (multi-year per-field imagery and index history, productivity zones), economics (contribution margins),
record-completeness checks and CSV export; cultivation templates, crop rotations and a crop
calendar; fertilizer catalogue and BVL plant-protection register with approval checks; soil
samples, DüV fertilizer need, nutrient balance and closed periods; contribution margins (DfL,
DB I, DB II), farm result and CO2e; DüV annual totals, 170 kg N, ENNI/ENDO XML and the
subsidy application Shapefile. Design notes:
[docs/agmeo-architecture.md](docs/agmeo-architecture.md).

### Run locally

Requires Node 24+, pnpm, Docker and `golang-migrate` (`brew install golang-migrate`).

```bash
pnpm install
pnpm infra:up        # PostgreSQL/PostGIS on :5434, NATS on :4222
pnpm db:migrate
pnpm db:seed         # demo farm "Hof Sonnenfeld" near Sehnde
pnpm dev             # contracts watcher, API on :3001, web on :3000
pnpm dev:worker      # optional: relays domain events to NATS
pnpm sync:psm        # optional: loads the BVL plant-protection register (needs internet)
```

Satellite monitoring (optional; needs `uv` and internet access, the local archive is optional):

```bash
cd backend/agmeo-geo && uv sync && uv run agmeo-geo worker       # imagery history, statistics, zones
cd backend/agmeo-geo && uv run agmeo-geo serve                   # map tiles on :3002
cd backend/sentinel-archive && uv run sentinel-archive derive   # optional: index COGs of archived scenes
```

The worker backfills every field's Sentinel-2 imagery since 2018 from Earth Search (only
the field windows are read; progress shows in the app) and then computes productivity
zones. See Fields & map → *Satellite imagery*, and a field's *Satellite* and *Zones* tabs.

Open http://localhost:3000 and pick a demo account (Anna Bauer is the owner). Sign-in is
development-only: any email works without a password until Keycloak is integrated.

```bash
pnpm typecheck
pnpm test            # API integration tests against the local database
pnpm build
```

Reset the database with `docker compose down -v`, then migrate and seed again.

## Sentinel-2 archive

Sentinel-2 historical imagery archive and agricultural index processing.

The Python project, dependencies, CLI, configuration and tests are in
[`backend/sentinel-archive/`](backend/sentinel-archive/README.md). Imagery is stored separately in
`~/Documents/sentinel-2`; the local SQLite catalogue is kept under `backend/sentinel-archive/.data/`.

Initial scope: Niedersachsen, Level-2A, from 2020-01-01, with daily incremental
discovery and a resumable historical download queue.

The standalone native [GeoTIFF Viewer](utils/geotiff-viewer/README.md) lives in
`utils/geotiff-viewer/` and displays the generated index rasters using GPUI and
GPUI Kit.
