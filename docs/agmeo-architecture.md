# agmeo — architecture

agmeo is a multi-tenant farm management system for arable farming (Germany / EU first).
This document records the main design decisions; the product scope follows the FMS
specification (P0 modules plus inventory, economics, compliance and machinery).

## Components

```
frontend/agmeo        TanStack Start + React Aria + MapLibre      :3000  (/api → :3001)
backend/agmeo-api     NestJS modular monolith (HTTP API)          :3001
                      + worker entry (outbox → NATS relay, job queue + schedules,
                        scheduled recommendations)
packages/contracts    zod request schemas + response types, shared by API and web
db/migrations         golang-migrate SQL migrations (PostgreSQL 18 + PostGIS 3.6)
backend/agmeo-geo     Python: field zonal statistics worker + index tile server  :3002 (internal)
backend/sentinel-archive  Python: Sentinel-2 L2A archive, `derive` writes index COGs + manifest
NATS JetStream        domain events, stream AGMEO_EVENTS (agmeo.events.>)  :4222
Keycloak              identity provider, realm agmeo (OIDC, Authorization Code + PKCE)  :8180
Mailpit               local SMTP catcher (production: any SMTP relay)  :1025 / UI :8025
Object storage        local directory (development) or S3-compatible bucket
```

**Why TanStack Start.** The API is a separate NestJS service, so the web app needs no
server-side data layer. TanStack Router gives type-safe routes and search params, and pairs
with TanStack Query. Routes render on the client (`defaultSsr: false`); only the document
shell is server-rendered. Next.js would mostly have contributed features we would not use.

**Why Kysely, not an ORM.** Migrations are plain SQL run by golang-migrate, so the schema
is owned by SQL, not by the application. Kysely is a typed query builder; types are
generated from the live database (`pnpm db:types` → `src/db/schema.ts`). PostGIS
expressions are written as `sql` fragments.

## Decisions (ADR summary)

| # | Decision |
|---|---|
| 001 | Modular monolith: one NestJS app with a module per domain; a separate worker process for async work. |
| 002 | Tenant isolation: every tenant table has `organization_id`, composite tenant-matched foreign keys, and PostgreSQL row-level security. |
| 003 | Field boundaries are versioned (`field_geometry_versions`, valid-time ranges, exclusion constraint against overlap); operations reference the version they were done on. |
| 004 | Operations are the transactional core: multi-field, completed atomically with stock, costs, audit and outbox. |
| 005 | Inventory is an immutable ledger (`stock_movements`); balances are computed, never edited. |
| 006 | Satellite scenes are shared reference data; per-field statistics are tenant-private. |
| 007 | Compliance checks are versioned rule sets (`DE-2026.1-preliminary`) separate from operational data. |
| 008 | Quantities and money are `numeric` in the database; aggregation happens in SQL. |
| 009 | Part fields (Teilschläge) are per season (`field_parts`): cut from the current boundary, non-overlapping, covering the field (one part may be the remainder). Crops, operation lines and costs may reference a part; composite keys keep them on the part's own field and season. A field without parts is used as a whole. |
| 010 | Nutrient contents of products are % of fresh mass for mineral and organic fertilizers alike, with a density in t/m³; organic analyses in kg/t or kg/m³ are converted on entry. One function (`nutrientKgPerHa` in contracts) turns rate and unit into kg/ha everywhere; volumes of organic products without a density count with 1 t/m³ and say so. |
| 011 | Agronomic and regulatory calculations are pure, versioned rule sets (`DE-DUEV-2020-Anl4-2026.1`, `DE-DUEV-2020-Anl5-2026.1`, `DE-BEK-simplified-2026.1`). Saved fertilizer-need records and exports name the rule set they used; records are append-only. |
| 012 | Emissions are a ledger like costs: `emission_entries` are written once per completion, allocated by treated area and reversed on reopening. |
| 013 | Reference data the API only reads (fertilizer catalogue, BVL plant-protection register, Nmin reference values, land-use codes) is shared, without row-level security, and written by the `agmeo_refdata` role (`pnpm sync:psm`, generated SQL in migrations). |

## Tenancy and security

- The API connects as `agmeo_api` (member of the NOLOGIN role `agmeo_app`), never as the
  table owner. Each request runs in a transaction with `app.user_id` and
  `app.organization_id` set locally (`Database.run`).
- Policies compare `organization_id` to `app.org_id()`, which returns the requested
  organization **only if the user is a member**. A forged organization id yields no rows.
- Guards: `AuthGuard` (token → user, JIT-provisioned via `app.sign_in`) and `OrgGuard`
  (membership + `@Requires(permission)`). Role → permission mapping lives in contracts
  (`can()`), so the UI hides what the API would reject.
- Unknown organization and "not a member" return the same 404.
- Append-only tables: the app role has no UPDATE/DELETE on `stock_movements`,
  `audit_events`; `cost_entries` only allows deleting manual entries (policy).
- The outbox is insert-only for the API; the relay role (`agmeo_outbox_relay`) can read and
  mark it but has no access to tenant tables.
- Background recalculation of recommendations connects as a member of `agmeo_recommender`
  (dev login `agmeo_recommender_worker`, `RECOMMENDER_DATABASE_URL`). It acts for one
  organization at a time through the ordinary tenant policies: `app.org_id()` accepts
  `app.organization_id` without a membership only for that role and only while no
  `app.user_id` is set (`systemCtx(orgId)`), so there is no service user and nothing is
  attributed to a person (`recommendation_runs.created_by` is NULL). Grants limit it to
  reading the rule set's inputs (plus member names via `users(id, display_name)`) and
  writing `recommendation_runs`/`recommendations`; `app.recommendation_schedule()` (SECURITY
  DEFINER) lists active organizations with their open crop cycles and latest run.

### Authentication

`AUTH_MODE=oidc` (production): the web app signs in with Keycloak (realm `agmeo`, public
client `agmeo-web`, Authorization Code + PKCE via `oidc-client-ts`) and renews the access
token with the refresh token. The API verifies RS256 tokens against the realm's JWKS, issuer
and audience `agmeo-api`, and requires `email_verified` (Keycloak forces verification
before issuing tokens). `GET /v1/auth/config` tells the web app which mode is active.

`AUTH_MODE=dev` (tests, offline development): `POST /v1/auth/dev/sign-in {email}` issues an
HS256 token for any email. The API refuses to start in this mode with NODE_ENV=production.

Everything downstream depends only on `{subject, email, name}`. `app.sign_in` links the
subject to the account with the same e-mail address (an invited user, or an account that
was linked to another subject before) and activates pending invitations. Inviting someone
queues an invitation e-mail in the inviter's language.

## Operation lifecycle

```
planned / in_progress ──complete──▶ completed ──reopen(reason)──▶ in_progress ──complete──▶ …
        │                                                                       
        └──cancel──▶ canceled          (delete only if never completed)
```

Completion, in one transaction:

1. Lock the operation, check the optimistic `version`. Repeated completion is a no-op.
2. Re-resolve each field's crop cycle from the actual work date.
3. Check recorded stock; shortage → 409 `insufficient_stock` unless an inventory manager
   overrides (`allowNegativeStock`).
4. Insert consumption movements and cost entries (inputs, labor, machinery, contractor),
   allocated to fields by treated area. Each completion has a `completion_seq`; unique
   indexes make its side effects exactly-once.
5. Mark linked tasks done; completed sowing activates the crop cycle.
6. Audit event + `operation.completed` outbox event; `inventory.low_stock` when a
   threshold is crossed.

Reopening appends compensating `reversal` movements and negative cost entries for the
last completion; nothing is deleted.

## Background jobs

`jobs` is a Postgres queue. The API appends jobs inside the transaction of the change that
needs them (`enqueue`, `queueEmail`), so nothing is sent for a rolled-back change. The
worker claims due jobs with `FOR UPDATE SKIP LOCKED` and a lease, retries failures with
exponential backoff (30 s doubling, capped at 6 h) up to `max_attempts`, and keeps finished
jobs 14 days and failed ones 90 days. Schedules enqueue one job per UTC-aligned slot with
the slot start as dedupe key, so several workers never run a slot twice. Handlers must be
idempotent (delivery is at-least-once).

Jobs run as `agmeo_jobs`, which reads tenant data only through policies granted to it per
table (today: users and organizations for e-mails). Job kinds: `email.send`, `jobs.cleanup`.

E-mails are rendered at send time from typed templates (`src/mail/templates.ts`, German and
English) and delivered over SMTP (`SMTP_URL`; Mailpit locally).

## Files

Organization files live in object storage (`STORAGE_DRIVER=local` keeps them under `.storage/`,
`s3` uses any S3-compatible bucket); `files` and `file_folders` hold names, folders, year,
description and a soft-delete `deleted_at` (the trash). Keys are `orgs/<orgId>/files/<uuid>`;
names never appear in keys. Uploads write the objects first and the rows second, and remove the
objects if the rows fail. Emptying the trash deletes rows and queues `files.purge_objects`.
Each organization has an allowance (`storage_limit_bytes`, default `STORAGE_DEFAULT_LIMIT_GB`);
uploads beyond it get 413 `storage_full`. Content is served as an attachment, or inline only for
raster images and PDF, always with `nosniff` and a sandbox CSP. App-written files go to system
folders (`FilesService.storeGenerated`), recreated if the user deleted them.

## Language and units

The UI language is the user's saved choice (`users.locale`), else the browser's language,
else German; switching reloads the page. Each organization has a measurement setting
(`auto` derives imperial for US farms, or explicit `metric` / `imperial`). The database
always stores metric values; `packages/contracts/src/units.ts` (ported from the reference
app) converts 28 dimensions for display, including crop-specific bushel weights.

## Events (NATS JetStream)

The worker relays `outbox_events` to subject `agmeo.events.<type>` with the outbox
`event_id` as JetStream message id (deduplicated within 2 minutes). Delivery is
at-least-once; consumers must be idempotent on `eventId`.

Message: `{ eventId, type, aggregateType, aggregateId, organizationId, occurredAt, payload }`.

Types emitted today: `organization.created`, `membership.invited`, `farm.created|updated`,
`field.created|updated|deleted|geometry_updated|parts_updated`, `crop_cycle.created|updated|deleted`,
`operation.planned|updated|completed|reopened|canceled`, `inventory.movement_recorded`,
`inventory.low_stock`, `harvest.recorded`, `task.created|updated`.

Consumers today:
- `agmeo-geo worker` (durable consumer `agmeo-geo-fields`) subscribes to
  `field.created` / `field.geometry_updated` and computes that field's statistics for every
  scene covering it.
- The API worker (durable consumer `agmeo-recommendations`) subscribes to `operation.>` and
  `crop_cycle.>` and recalculates the organization's recommendations once changes settle
  (2 min without a further event, at most 15 min after the first). Events are acknowledged
  when noted; a crash before the recalculation is covered by the next daily run.

## Satellite monitoring

1. Imagery comes from two sources. `agmeo-geo` reads Sentinel-2 L2A per field from
   Earth Search (collection `sentinel-2-c1-l2a`, cloud-hosted COGs, only the field's window),
   back to 2018 and then every new acquisition; `sentinel-archive derive` adds local
   cloud-masked index COGs with a `manifest.json`. Both register shared `satellite_scenes`.
2. For every field boundary and acquisition the worker writes a small **field raster**
   (NDVI/NDRE/NDMI and true colour on the field's own 10 m UTM grid) and tenant-owned
   `field_observations`. A `field_imagery_jobs` row per boundary tracks the backfill and its
   progress. Rules in [backend/agmeo-geo/README.md](../backend/agmeo-geo/README.md).
3. The API lists acquisition dates with imagery (`/monitoring/imagery/dates`), the backfill
   status, and proxies tiles by date from the internal tile server, which renders only that
   organization's field rasters. Overlapping tiles deliver the same pass twice; observations
   are de-duplicated per date. MapLibre sends the bearer token via `transformRequest`; tile
   URLs carry a boundary version.
4. **Productivity zones**: `productivity_analyses` combine several seasons of clear NDVI
   field rasters into a relative productivity map and a stability score, classified into
   `zonings` of 3, 5 and 7 zones (`zoning_zones`, zone 1 least productive). The API queues
   analyses (optionally excluding acquisitions); the worker computes them, automatically once
   a boundary's history is loaded. Zonings are the input for variable-rate maps and soil
   sampling (see [onesoil-port-plan.md](onesoil-port-plan.md)).
5. There is no separate monitoring page. **Fields & map** has map layers *Crops*, *Field
   index* (latest field mean) and *Satellite imagery* (NDVI/NDRE/NDMI absolute or within-field
   contrast, or true colour, per date); each field page has a **Satellite** tab (imagery,
   multi-year index history, backfill progress) and a **Zones** tab.

## Cultivation planning, field work, agronomy, economics and reporting

Ported from AGVOLUTION/agmeo (its rules, tables and reference data; not its data model). Each area
is a module in `backend/agmeo-api/src/modules`:

| Module | What it does |
|---|---|
| `planning` | Cultivation templates (steps dated from sowing, harvest or season start) applied to crop cycles as planned operations; crop rotations with season roll-over (next crop, its catch crop and template); crop calendar. Crops have a role: main, catch crop or undersown (a catch crop belongs to the season of the main crop it precedes). |
| `inventory` (extended) | Nutrient master data and fertilizer types; fertilizer catalogue (~690 mineral and organic entries); BVL plant-protection register search and products from it. |
| `protection` | Checks plant-protection applications against the register: approval and use-up date, approved use for the crop (through the BVL crop hierarchy), dose, BBCH window, waiting period, number of applications and interval. Measured against the approved use the application fits best. |
| `soil` | Soil sampling planner (ported from AGVOLUTION/agmeo): zonations per field (satellite zones computed by agmeo-geo; grid, Voronoi and productivity-zone plans and the zone editor's result stored by the API), probe numbers, the lab's sample card (TGIS PROBEKARTE/CONTOUR shapefiles), zonation and results PDFs, GeoJSON and shapefile exports archived under "Soil exports", lab upload (CSV, XLSX, returned Probenkarte) matched by probe number or location, writing zone values and a soil sample per field, history and bulk restore, analysis dashboard, public share links (token, optional scrypt password, expiry, revocation; read through SECURITY DEFINER functions). |
| `nutrients` | Soil samples with VDLUFA content classes; fertilizer need (DüV §4, Anlage 4) with append-only records; P/K/Mg and lime need; season nutrient balance (available N after DüV Anlage 3); closed periods (Sperrfristen); Nmin reference values of the states; variable-rate suggestions from zone productivity. |
| `carbon` | CO2e of completed operations by source (diesel, machinery, N2O direct/indirect, fertilizer production, lime/urea CO2, plant protection, seed). |
| `economics` (extended) | DfL, DB I, DB II per crop cycle and crop; plan values from planned operations and expected yield; crop prices per harvest year; overheads and CAP payments → indicative farm result. |
| `regulatory` | Farm master data for the authorities; annual totals (DüV Anlage 5); 170 kg N balance; ENNI (Niedersachsen) and ENDO (Schleswig-Holstein) XML through the ported `harmonie` library, validated against the official XSDs in tests; subsidy application Shapefile per state portal (ETRS89/UTM); land-use codes. |
| `recommendations` | Field recommendations (what, when, where, why): rule set `AGMEO-REC-2026.1` over planned operations, the farm forecast, NDVI observations, productivity zones, the season N balance, closed periods and PSM checks. Decisions are typed (kind, action, window, zones, priority, confidence) with evidence codes; one open recommendation per decision key; accepting reschedules the operation or creates a task, dismissing records the reason. An OpenAI model (optional, `OPENAI_API_KEY`) phrases the reasons and a daily briefing with structured output; it never adds or changes a decision. |

## Domain notes and open points

- **Fertilization record deadline.** The spec mentions 14 days; the DüV (2020) §10(2)
  requires recording no later than **two days** after application. The compliance rule set
  uses 2 days. To be confirmed by a domain expert before relying on it.
- Compliance checks detect missing documentation; they are not a legal assessment.
- **N need (DüV Anlage 4).** Sollwerte, yield corrections and deductions follow agmeo's table for 20
  crops. Two deliberate corrections against agmeo: Nmin is subtracted once (no separate spring
  mineralization), and yield surcharges are capped at 40 kg N/ha. The cap and the per-crop values
  should be confirmed by a domain expert; Länder deviations are not modelled. Without an Nmin sample
  or a chosen state reference value, an estimate by soil class is used and flagged as not valid
  documentation. The −20 % in nitrate-polluted areas is applied per crop.
- **P classes** use mg P/100 g (VDLUFA 2018); lab values in mg P2O5 are converted.
- **Closed periods** cover §6 Abs. 8 and §13a Abs. 2; Länder shifts and the autumn exceptions are not
  modelled.
- **Plant-protection checks** compare with the BVL register, not the product label; the register is
  as current as the last `pnpm sync:psm`.
- **CO2e** is simplified (no crop residues, humus balance or scope 2). Organic NH3 losses use default
  shares of ammonium N by application technique.
- **Farm result**: CAP payments are indicative and not checked against the paying agency's rules.
- **170 kg N**: the farm average is the higher of what the records show was applied and the
  livestock balance (excretion + intake − delivery) entered by the user.
- **Recommendations** are orientation, not advice: weather thresholds (spray, fertilization, soil
  work, harvest) use the farm forecast, not field soil moisture; NDVI anomalies compare with the
  previous observation and with the same crop on other fields. The worker recalculates them
  daily at `RECOMMENDATIONS_DAILY_AT` (05:00 Europe/Berlin) for every organization with planned
  or active main crop cycles that has not been recalculated since, catching up the same day after
  an outage (a missed day is not repeated), and after operation/crop-cycle events; users can
  refresh on demand, and the UI does when the last run is older than six hours. One worker at a
  time runs the daily pass (advisory lock); organizations run one after another, and a failing one
  is logged and retried after an hour without stopping the others. Decided keys stay quiet for
  seven days.
- Weather: Open-Meteo forecast API, cached 30 minutes per location; spray windows are
  indicative thresholds only (no daylight, inversion or product-label rules).
- Aerial imagery: Esri World Imagery for development; production needs a licensed provider.
- Not built yet: restricting members to selected farms, offline mobile use, BESyD and
  Sachsen-Anhalt reporting formats, import of the subsidy application, market price feeds,
  KTBL machine costs, trafficability and disease models (they need external data feeds).
