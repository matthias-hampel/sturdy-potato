# agmeo parity plan

Status: gap analysis and decisions (2026-10-18). Phase 0 built on `feat/parity-phase0` (see §7); phases 1–5 open. Reference: `AGVOLUTION/agmeo`, branch `development` at `489bfe464`
(Next.js + drizzle, ~540k lines of TypeScript, 116 pages, 160 tables, 28 cron jobs, 11 locales).
Target: this repository (57 tables, 27 routes). Goal: the same user-visible functionality.

"Present" means a user can do the same thing; "partial" means the core exists but named parts are missing.
Paths without a prefix are in the reference under `src/app/app/[orgId]/` or `src/app/api/`.

## 1. Summary by area

| Area | Status | In short |
|---|---|---|
| Operations, DüV, ENNI/ENDO, plant-protection checks, inventory, templates | mostly present | Often stricter than the reference (lifecycle, audit, part fields). Missing: models, BESyD/ST, task board, cultivation groups |
| Fields, boundaries, satellite, productivity zones, VRA | partial | Own Sentinel-2 pipeline is ahead. Missing: soil suite, yield maps, cadastre/lease, merge/split/archive, map layers, B2B Maps |
| Economics, carbon, overview | partial | DfL/DB I/DB II and plan vs. actual present. Missing: RothC, CO2 analysis depth, benchmarks, multi-year, news feed, partner console |
| Weather and agronomic models | minimal | Farm-level live forecast only. No stored weather, no spray/sowing/risk bars, trafficability, BBCH, disease, water balance, microclimate, radar |
| Integrations and imports | missing | No John Deere, CLAAS, AGCO, NEXT Farming, Raindancer, FarmNet, climavi; no import contract, no AI import |
| agmeo Chat, knowledge base | missing | Nothing |
| Platform | minimal | Dev-only sign-in, de/en with no switch. No billing, files, e-mail, scheduler, API keys, public API, staff/admin tools |

## 2. Cross-cutting foundations

Most missing features depend on infrastructure the rewrite does not have yet. Building these first avoids
rework:

| Foundation | Needed by |
|---|---|
| **F1 Production auth** (Keycloak/OIDC per architecture doc, or Clerk as in the reference), invitations by e-mail, allow-list, SSO | everything customer-facing |
| **F2 Scheduler + job queue** (cron in the worker, Postgres `SKIP LOCKED` jobs or NATS consumers, idempotent runs) | 28 reference crons: weather, satellite, provider syncs, digests, market prices, OAuth refresh |
| **F3 Object storage + files module** (S3/R2, folders, quota, scan, trash, preview) | files page, AI import, yield maps, soil lab uploads, field documents, export history, knowledge base, chat |
| **F4 Mailer** (templates, locale, RFC 8058 unsubscribe, per-user opt-out) | invitations, rain digest, AI import notices, notifications settings |
| **F5 Stored weather per field/season** (Open-Meteo archive backfill + daily refresh in org-local slot) | spray/sowing/risk bars, GDD/BBCH since sowing, water balance, disease models, trafficability, N model, news feed |
| **F6 OAuth connections** (encrypted token store, refresh cron, reconnect UI) + **provider import runner** (runs/chunks, product matcher, review queue) | JD, CLAAS, AGCO, NEXT Farming, climavi, Raindancer |
| **F7 Import contract** (jobs → chunks → plan → commit, schema + snapshot endpoints) | AI import, NEXT Farming Pro backup, agmeo-import skill/MCP |
| **F8 API keys + OpenAPI + usage metering** | public API, Pöttinger docs, MCP, mobile app, climavi |
| **F9 i18n** (11 locales, detection, switcher) and **unit system** (auto/metric/imperial per org) | every screen |
| **F10 Billing** (Zoho subscriptions, hectare tiers, plan gates, coupons, invoices) | Pro gates, chat credits, B2B Maps |

## 3. Gaps by area

### 3.1 Fields, boundaries, map

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Field table | `fields/[year]/columns.tsx`, `ColumnConfigBar.tsx` | partial | BBCH, LAI, GDD, disease, trafficability, sowing/spray/weather bars, rain 24h/7d/season, yield, margin, CO2e, N columns; column config, quick views, inline edit, grouping by field group |
| Secondary crop, plan next year | `AddSecondaryCropDialog.tsx`, `PlanNextYear.tsx` | partial | Bulk actions on the list (data model exists) |
| Boundary import | `_components/ImportFieldDialog/*` | partial | State + year, crop assignment, inline rotations, shapefile diagnostics |
| Cadastral parcel selection (state WFS) | `SelectFieldsTab.tsx`, `lib/cadastral` | missing | Whole feature |
| Edit boundary | `edit-boundary/*` | partial | Cut holes, simplify slider, snapping, reason; restore an earlier version |
| Fields manager | `fields-manager/[year]/*` | partial | Merge, split, renumber, archive/restore, multi-field editor |
| Lease management + analytics | `LeaseManagementTable.tsx`, `LeaseAnalytics.tsx` | missing | Parcel intersection, lease amount/share, per-field lease |
| Crop rotations page | `fields/[year]/crop-rotations` | partial | Backend exists (`planning`), no UI |
| Field groups / cultivation groups | `fieldGroups`, `cultivation-groups` | missing | Entity and UI |
| Org map layers | `_components/mapLayers/*`, `maps/*` | partial | Vector tiles, economic/KPI choropleths, soil, yield, trafficability, radar, stations, background rasters |
| Live locations, tracks, time travel; saved locations | `live-locations`, `saved-locations` | missing | Whole feature (mobile) |
| Satellite annotations, field documents, field overview PDF | `SatelliteAnnotation*`, `FieldDocuments.tsx` | missing | Whole feature |
| B2B Maps (~120 layers, raster analysis, access admin) | `src/app/maps`, `lib/b2b-maps` | missing | Separate product |

### 3.2 Soil

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Field soil samples | `soil-maps/*` | partial | Soil maps, zone editor (brush, fill, undo) |
| Zonation (FCM, k-means, probe, segment), grid/Voronoi sampling, batch | `soil/map`, `soil/_components` | missing | Whole feature |
| Sample cards (PDF/SHP/GeoJSON), lab upload + matching, probes | `ExportZonationsModal.tsx`, `soil/probes` | missing | Whole feature |
| History, compare, analysis dashboard | `HistoryDrawer.tsx`, `soil/analyse` | missing | Whole feature |
| Public share link with password | `src/app/share/soil/[token]` | missing | Whole feature |

### 3.3 Satellite, yield, application maps

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Satellite history and tiles | `satellite`, `cron/satellite-crawler` | present (redesigned) | LAI, SAVI; per-scene stats dialog, image export |
| Productivity zones | application-map base zonation | present | — |
| Yield-map import (ISO-XML/AFT/GeoJSON, cleaning, rasterise) + yield analytics | `cron/yield-map-import`, `lib/analytics/yieldMap*` | missing | Whole pipeline |
| Application maps per cultivation | `applicationMapsPage/*` | partial | Base zonations from soil map, yield map, upload or single scene; brush editor; JD/CLAAS/AGCO push; batch export |
| Bulk application maps | `application-maps/[year]` | missing | Whole feature |
| Zone optimisation with ESM N model | `optimization/page.tsx` | partial | N-balance simulation, N-supply graph |
| Maize dry-matter monitoring | `maize-dmc/[year]`, `cron/dmc-harvest-detection` | missing | Whole module |

### 3.4 Operations and crop production

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Operations | `transactions`, `operations` | present | Action catalogue (diesel l/ha, kWh/ha, h/ha), custom actions, CO2/diesel per row |
| Operations overview map | `operations/[year]` | partial | Map, field-group menu, byproduct input |
| Templates | `operations/_components/template-builder` | partial | Survey-based builder, public vs. own, sharing across orgs |
| Tasks | `tasks/_board`, `tasks/[id]/comments` | partial | Kanban, tasks on operations, comments, filters, bulk done, delta sync |
| Crop calendar | `crop-calendar` | partial | Inline edit, crop colours, distribution bar |
| Seeding, tillage tabs | `seeding/[year]`, `tillage/[year]` | partial | Sowing window, distribute seed, machine/implement/operator columns with diesel/kWh/h, seeding-map button |
| Plant protection | `protection/[year]` | partial | BBCH phenology with calibration, ISIP disease risk, spray-window column, mix partners, Auflagen, Sachkunde |
| Harvest | `harvest/[year]` | partial | Yield-map upload, batch satellite yield estimate, coverage KPIs |
| Irrigation | `irrigation/[year]`, `irrigation/water-balances` | partial | FAO-56 water balance, irrigator coverage, external event API |
| N fertilization (DüV) | `nitrogen/[year]` | partial | agmeo N model (supply, loss, leaching), split strategies, apply strategy |
| Base fertilization | `base-fertilization/[year]` | partial | Multi-year P2O5 balance, delivered/balance columns |
| Emission recommendations | `recommendations/[year]` | missing | Whole feature |
| Voice drafts | `voice-drafts`, `cron/voice-transcription` | missing | Whole feature |

### 3.5 Regulatory

| Feature | Reference | Status | Missing |
|---|---|---|---|
| ENNI, ENDO, N170, DüV report | `export/enni`, `export/endo` | present | Export history archived as files |
| BESyD (BB/SN/ST/TH), Sachsen-Anhalt LLG | `export/besyd`, `export/st` | missing | Both formats |
| Fertilizer-report wizard | `economic-analysis/[year]/fertilizer-reports` | partial | Region detection, deadlines, readiness step, crop mappings, portal links |
| Plant-protection record EU 2023/564 | `protection-reports` | partial | Wizard, history; CSV format equivalence unverified |

### 3.6 Resources

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Warehouse | `personalize/products` (Inventory*) | partial | Lot, expiry, supplier, invoice no., harvest/fuel as sources, stocktake, export |
| Product master data | `personalize/products/master-data` | partial | Product CO2e, humus effect, N effectiveness, datasheets, sharing |
| Prices per year | `prices/[year]` | partial | Article price per year (rewrite: one unit cost) |
| Calculation parameters | `personalize/parameters` | missing | Editable emission factors |
| Machinery | `machinery` | partial | Machine vs. implement, catalogue lookup, SCI data, irrigation fields, purchase price, JD sync |
| Operators | `operators` | present | Staff number, role, notes |
| Variety browser | `app/varieties` | partial | BSL traits and 1–9 resistance ratings |
| Files | `files/[year]` | missing | Whole module (F3) |

### 3.7 Economics, carbon, overview

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Profitability per field | `economic-analysis/[year]` | partial | Aggregation by group, multi-year, ranking, detail dialog, coverage stats, diesel/hours, map choropleth |
| Farm economics settings | `FarmEconomicsDialog.tsx` | partial | Accident insurance, rights, salary/h, young farmers, agri-environment, per-field lease, default article prices |
| Benchmarks | `economic-analysis/[year]/benchmark` | missing | Whole feature |
| Market prices (EU portal cron, compare modal) | `cron/market-prices`, `MarketPricesModal.tsx` | missing | Whole feature |
| Overview (cultivation-group table, scope 2) | `overview/[year]` | missing | Whole feature |
| CO2 analysis | `analysis/[year]`, `lib/co2calculator` | done (phase 4, carbon) | Report text/PDF summary; projects are the user's own organizations |
| RothC carbon tab | `[cultivationId]/carbon` | done (phase 4, carbon) | Needs `THUENEN_API_KEY` |
| Yield research | `yield-research/[year]` | missing | Whole feature (internal) |
| News feed + staff announcements | `news/[year]`, `lib/news`, `src/app/team/news` | missing | Whole feature |
| Predictions API (yield, DMC, BBCH, GDD, LAI, nFK, grassland) | `predictions/*` | missing | Whole feature |
| Partner console + partner analysis | `src/app/partner/[slug]` | missing | Whole feature |

### 3.8 Weather, models, devices

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Weather | `cron/weather-crawler`, `fields/[id]/weather` | partial | Stored per cultivation (F5), field-level 48 h with hourly spray score |
| Condition bars (spray with Delta T, sowing, risk, trafficability; 4 levels, crop/BBCH aware) | `lib/weather/conditions.ts` | partial | Rewrite has yes/no spray windows only |
| Trafficability (FAO-56 → pF → precompression → tyre stress) | `lib/trafficability` | missing | Whole model |
| Microclimate API (10 m layers) | `api/microclimate`, `lib/microclimate` | missing | Whole feature |
| DWD RADOLAN radar | `api/radar`, `cron/radar-refresh` | missing | Whole feature |
| climavi stations (list, detail charts, compare, frost) | `stations`, `oauth/climavi`, `cron/climavi-validate` | missing | Whole feature |

### 3.9 Integrations and imports

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Connections page, OAuth, refresh | `settings/ConnectionsPage.tsx`, `oauth/*`, `cron/oauth-refresh` | missing | F6 |
| John Deere (wizard, nightly sync, telemetry, write-back) | `lib/johndeere`, `actions/johndeere` | missing | Whole integration |
| CLAAS connect | `lib/claas`, `cron/claas-sync` | missing | Whole integration |
| AGCO FarmENGAGE | `lib/agco`, `cron/agco-sync` | missing | Whole integration |
| NEXT Farming cloud + Pro backup | `lib/nextfarming` | missing | Whole integration |
| Raindancer, FarmNet | `lib/raindancer`, `farmnet.ts` | missing | Whole integration |
| Import contract | `import/{jobs,schema,snapshot}` | missing | F7 |
| AI import requests | `ai-import`, `staff/import-requests` | missing | Whole feature |
| Public API, Pöttinger docs, webhooks, ESM write-back | `docs/api`, `api/public`, `webhooks`, `esm` | missing | F8 |

### 3.10 agmeo Chat and knowledge base

All missing: threads (stream, fork, artifacts, memory), projects, agents, Python sandbox and gateway,
write approvals, task library, workflow skills, data readiness, regional benchmark, scheduled reports,
photo and voice input, outbound MCP connectors with marketplace, chat integrations, credits/seats/overage,
standalone host and EU residency, assistant API, knowledge base with embeddings (`knowledge`,
`cron/knowledge-index`), support bubble and bug reports. Reference docs: `docs/claude/chat-*.md`,
`docs/claude/knowledge-base.md`.

### 3.11 Platform, staff, billing

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Sign-in, sign-up, SSO, provider sign-up | Clerk, `auth/*` | partial (dev only) | F1 |
| Members, invitations | `settings/MembersPage.tsx` | partial | Invitation e-mail, farm-restricted members |
| API keys | `settings/ApiKeysPage.tsx` | missing | F8 |
| Onboarding | `app/onboarding/*`, `api/onboarding/farm` | partial | Crop-rotation step with prices and technologies, partner onboarding API, invite step |
| Settings tabs | `settings/_components/*Page.tsx` | partial | Logo, units, notifications, communication, data processing, export, reports, soil, partnerships, connections, subscription |
| Billing | `checkout`, `coupon`, `lib/subscription`, `webhooks/zoho` | missing | F10 |
| Admin dashboard, API stats, staff team pages (clone org, manage orgs, news, partners, KTBL) | `src/app/admin-dashboard`, `src/app/team` | missing | Staff role and all pages |
| Languages | `src/i18n/common` (11) | partial | 9 locales, detection, switcher (F9) |
| Help page, PWA manifest | `app/help`, `public/site.webmanifest` | missing | Both |
| E-mail digests (rain, storage) | `cron/rain-digest`, `cron/storage-digest` | missing | F2 + F4 |

## 4. Where the rewrite is ahead

Keep these when porting; do not regress to the reference's behaviour:

- Operation lifecycle with version check, reopen with reason, cancel, audit, stock reversal, negative-stock override.
- Part fields (Teilschläge) per season in operations, crops and costs.
- Row-level security, 6 roles × 12 permissions shared with the UI, audit log, transactional outbox to NATS.
- Compliance documentation checker with versioned rule sets; earliest harvest from PSM waiting periods.
- Plan vs. actual contribution margins; cost and emission ledgers reversed on reopening.
- Own Sentinel-2 history since 2018 with cloud mask, NDRE/EVI/NDTI, multi-season productivity zones with stability.
- Boundary versions with exact valid-from dates; server-side overlap checks.
- VRA export as ISO-XML TASKDATA, Shapefile and GeoJSON without an external service.
- Equipment maintenance log and usage; Agrarantrag Shapefile export.

## 5. Decisions (2026-10-18)

- **Scope: arable core only.** Fields, soil, operations, weather, economics, regulatory exports. Out of scope for
  now: provider integrations and imports (3.9), agmeo Chat and knowledge base (3.10), billing, public API, staff
  and admin tools, partner console, B2B Maps, yield research (parts of 3.1, 3.7, 3.11).
- **Auth: Keycloak/OIDC**, as planned in the architecture doc.
- **No data migration** from the reference database. The schema here stays free; no ID or enum compatibility.
- **All phases below are to be built**, in order.

## 6. Phases (arable core)

Each phase ends usable on its own. Effort is relative (S < M < L < XL).

| Phase | Content | Effort |
|---|---|---|
| 0 | Foundations: F1 Keycloak/OIDC + e-mail invitations, F2 scheduler and jobs in the worker, F3 object storage + files module, F4 mailer, F9 language switch + org unit system | L |
| 1 | Core workflow gaps: field manager (merge, split, archive/restore, renumber), boundary cut/simplify/snap/restore, crop rotation UI, field and cultivation groups, field-table columns and bulk actions, task board with comments, warehouse details and stocktake, prices per year, calculation parameters, machinery details (machine/implement, SCI data), operation action catalogue (diesel/kWh/h per ha), BESyD + Sachsen-Anhalt exports, fertilizer-report wizard and export history | L |
| 2 | Weather and models: F5 stored weather per field and season, field weather with hourly spray score, 4-level condition bars (spray with Delta T, sowing, weather risk), GDD/BBCH phenology, FAO-56 water balance, trafficability, disease risk, radar | L |
| 3 | Soil and yield: soil zonation and sampling suite, lab upload and matching, sample cards, history, analysis dashboard, share links; yield-map import and analytics; application maps from soil, yield, single-scene or uploaded zonations, brush editor, bulk maps; satellite annotations, field documents and overview PDF; harvest yield estimate | XL |
| 4 | Economics and carbon: multi-year profitability, grouping, ranking, coverage stats, diesel and hours, map choropleth, full overhead and CAP fields, benchmarks, market prices; CO2 analysis depth and Excel export, RothC carbon tab, scope 2, emission recommendations; overview table; news feed | L |
| 5 | Monitoring extras: maize dry-matter monitoring, predictions (yield, DMC, LAI, nFK), N model for zone optimisation and DüV comparison, LAI/SAVI indices, remaining languages | L |

## 7. Progress

### Phase 0 — foundations (built 2026-10-18)

- **F1 Keycloak/OIDC**: realm `agmeo` imported by docker compose (public client `agmeo-web`, PKCE, audience
  `agmeo-api`, registration, e-mail verification, password reset, demo users). API verifies tokens via JWKS
  (`AUTH_MODE=oidc`) and requires a verified e-mail; the dev sign-in stays for tests and refuses production.
  Web app: `oidc-client-ts`, callback route, silent renewal, retry on 401, sign-out ends the Keycloak session.
  Sign-in relinks an account by verified e-mail (migration 000030).
- **F2 Jobs**: Postgres queue `jobs` (migration 000026), worker runner with leases, backoff and cleanup;
  UTC-slot schedules with dedupe keys; role `agmeo_jobs`.
- **F3 Files**: `file_folders`, `files` (migration 000029), local or S3 storage driver; folders, upload of
  files and folder trees, search, move, copy, rename/edit, trash with restore and purge job, folder ZIP,
  compress, extract (1000 entries / 512 MiB), allowance with 80 % warning, viewer role read-only, system
  folders and `storeGenerated` for app-written files. UI: explorer with grid/list, sorting, multi-select,
  keyboard shortcuts, context menus, drag & drop (move and desktop upload), paste upload, table / image /
  PDF preview, geo viewer (Shapefile with sidecars, GeoJSON, KML/KMZ, zipped Shapefile) with layers and
  attribute table.
- **F4 Mail**: `email.send` jobs, typed German/English templates, SMTP (Mailpit locally); invitation e-mails.
- **F9 Language and units**: language from account, browser or German, switch in the account menu;
  organization measurement setting (auto/metric/imperial) with the reference app's 28-dimension unit system;
  areas, weather values and the map scale convert.

Differences from the reference that remain deliberate or open:
- Storage: no 14-day grace period and no plan-based allowance (billing is out of scope); a per-organization
  `storage_limit_bytes` with a deployment default instead.
- Files are not yet linked to articles, cultivations or soil imports (phases 1 and 3), and existing exports
  do not yet archive themselves into the Exports folder (phase 1, "export history").
- Units: forms that take input in hectares or kg/ha still take metric values; they convert as their screens
  are reworked in the following phases.
- Languages: German and English only; the other nine follow in phase 5.

### Phase 1 — core workflow gaps (in progress, 2026-10-19)

Done:
- **Field manager** (migration 000031): archive and restore, delete, renumber (parcel numbers), merge with
  preview; boundary versions with reason and restore; advanced drawing (cut, holes, simplify); field groups;
  crop rotation page and carry-forward of crop cycles into the next season.
- **Task board** (000032): operations by status with priority, due date and assignee; comments; delta sync
  for tasks.
- **Crop calendar** (000033): several years at once with drag editing, seed multiplication (lot,
  generation, usage), own crop colours.
- **BESyD and Sachsen-Anhalt** (000034): builders ported from the reference (byte-identical files on
  test data), farm data per format, region detection with deadlines and upload guides, export history;
  ENNI, ENDO, BESyD, ST and Agrarantrag downloads are archived into the Exports folder.
- **Warehouse and prices** (000035): receipts and issues with lot, expiry, supplier or buyer, invoice,
  total price and VAT; voids as compensating movements; stocktake; CSV exports; expiry warnings and
  category totals; harvests booked into stock as harvested goods. Prices per year: own price, else the
  year's weighted receipt average, else the latest earlier year, else the product default
  (`app.product_price`); operations and economics value inputs with it. Products gain humus C,
  N effectiveness, website and datasheet. Read-only calculation parameters (emission factors).
- **Fertilizer-report wizard** (no migration): compliance tab "Düngemeldungen" with the reference's four
  steps (Bundesland and formats with deadlines, readiness with fix links, farm data per format with crop
  code overrides and 170 N, download with upload guide and export history); Agrarantrag and land-use codes
  moved to their own tab; code lists also serve the ENNI and ENDO-SH Fruchtart catalogues.

- **Machinery and actions** (000036): machines and implements with the reference's categories, mount
  types and statuses; masses, axle share and tyres (SCI-ready badge); purchase, depreciation, financing,
  TÜV and insurance dates; irrigation data; default operator; archive; make/model lookup in the machinery
  catalogue taken from the reference (3,049 machines, 10,376 implements). Operators gain role, staff
  number and notes. Organization action catalogue with diesel and hours per hectare and default machine,
  implement and operator; operations planned from an action take them over; an operation's diesel per
  hectare drives its diesel emissions.
- **Crop table columns**: column picker with quick views (overview, planning, application, all),
  remembered per browser; new columns parcel number, field group, usage and land-use code.

- **PSM record** (000037): EU 2023/564 record with readiness check, certificate of competence and
  sprayer inspection, CSV/JSON generation archived to Files, history.
- **KTBL action defaults** (000039): the reference's KTBL snapshot (693 actions, grid and formula
  estimators) fills diesel and hours per hectare of an organization's actions by crop group, field
  size, distance and power.

Phase 1 is complete.

### Phase 2 — weather and models (2026-10-19)

- **F5 stored weather** (000038): 0.01° grid cells of active fields; new cells backfill from the
  start of their seasons (ERA5 archive with `OPEN_METEO_API_KEY`, else the last ~92 days of the free
  forecast API, development only) plus the forecast window; known cells refresh once a day in the
  04:30–05:30 local slot of their farms. Daily values are aggregated from hourly data.
- **Models** (src/models, 495 ported tests): condition bars (spraying with Delta T, sowing, weather
  risk, trafficability), hourly spray score, GDD and BBCH (ESM model or crop calendar), FAO-56 water
  balance with irrigation recommendation, trafficability/SCI, climate baseline. Served per field
  (`fields/:id/conditions`, `fields/:id/trafficability`) and shown in the field's new
  "Wetter & Bedingungen" tab.
- **Radar** (000040): DWD RADOLAN RY analyses and the RV 2-hour nowcast rendered by the worker while
  someone looks at the radar; animated layer on the field map.

Differences: the reference's disease risk comes from an external ISIP crawler service that is not in
the repository, so there is no disease bar yet; soil texture fractions are mid-points of the LUFA
class until measured texture exists; microclimate and climavi stations stay out of scope.

### Phase 4 — economics (partly, 2026-10-19)

- Profitability by field, crop or field group with the reference's waterfall down to the farm
  result, coverage of the records, ranking, detail dialog and DB I map; multi-year view; benchmarks;
  EU Agri-food market quotes (000044; the feed was suspended at the time of writing, which the
  job logs and tolerates); the remaining farm-economics settings and a lease per field.
- In progress on their own branches: full CO2 calculator, CO2 analysis and RothC tab (carbon),
  soil suite (phase 3), yield maps (phase 3).

Differences from the reference:
- BESyD/ST: grazing is not modelled (IMPWEIDE stays empty); ST Phosphorgebiet is always false as in the
  reference; no Regierungsbezirk or centroid fallback for the federal state.
- Expiry of stock on hand assumes first in, first out, since outflows carry no lot.
- Fertilizer-report wizard: the Bundesland override is the farm's stored state (no org-level setting);
  no "request a format" button for unsupported states; the Düngebericht PDF is the printable
  Düngedokumentation; one farm address serves as Ansprechpartner and Betriebsstätte; Boden-Klima-Raum and
  Naturraum get no preselected default; 170 N data are saved by their own editor.
- Action catalogue: the reference's default actions come with KTBL diesel and hours per hectare from its
  article database, which is not in the repository; here each organization builds its own catalogue.
- Machinery: `equipment.kind` stays as a coarse group derived from the category (icons, older code); no
  water sources, tyre history, telemetry or John Deere sync (integrations are out of scope).
- Crop table: data columns of later phases (BBCH, GDD, weather windows, NDVI/LAI, rain) are not there yet;
  field groups are a column with a filter rather than row grouping.

### Phase 4 — carbon (built 2026-10-19, branch feat/parity-carbon)

- **BEK calculator** ported from `lib/co2calculator` with its cited parameters and crop tests
  (`backend/agmeo-api/src/modules/carbon/bek`); agmeo crop codes map onto its crops in `carbon/crops.ts`.
  Completed operations write the emission ledger by BEK source (pf/pb/pn) per treated field with the
  field's crop; reopening reverses it. Crop-cycle terms are computed when read: the crop's humus effect and
  10 % of last season's organic N once the crop is sown, residues with their humus and nutrient credits
  once it is harvested. Ledger rows of the simplified calculator map onto BEK sources.
- **CO2 analysis** (`/carbon`, migration 000070): crop, template or field level; total, per ha, per t FM or
  DM; yearly comparison with the NUTS 2 reference (EU 2024/2666), by operation type, farm overview,
  emission sources (detail, PF/PB/PN, GHG Protocol), without credits; table with Excel export; farm
  comparison across the user's organizations with the reference's multi-sheet workbook.
- **Scope 2** (000071): kWh of electricity and heat per harvest year with BAFA/UBA factors.
- **RothC carbon tab** on the field: topsoil values with attachment, rotation and comparison, Thünen
  simulation over five weather windows, yearly table with CSV/Excel export and the SOC band chart.
- Calculation parameters list every factor with its citation; crop parameters as a matrix.

Differences from the reference:
- Crops without model data still get their crop-independent emissions (diesel, fertilizer, crop
  protection); the reference computes nothing for them.
- Acidifying fertilizers (negative lime value) release no lime CO2; the reference counts the absolute value.
- Organic fertilizer contents are per tonne of fresh mass (the reference: per m³); NH3 factors by type and
  incorporation time, not by application technique, as in the reference. N efficiency defaults to the DüV
  minimum when the product has none.
- HVO and biodiesel are recognised by the fuel product's name. No per-product N production factor
  ("carbon light" fertilizers) and no blue urea categories.
- Rotation CO2e per entry has no diesel (templates carry no machine data yet); RothC years use the crops'
  default sowing and harvest months, the entry's expected yield (else the DüV reference yield) and leave
  residues on the field.
- "Projects" are not stored: the comparison picks among the organizations the user belongs to.
- No PDF report with summary text and notes (the reference's third view).
