# agmeo parity plan

Status: all phases of §6 built (2026-10-19, see §7); out-of-scope areas per the decisions in §5. Reference: `AGVOLUTION/agmeo`, branch `development` at `489bfe464`
(Next.js + drizzle, ~540k lines of TypeScript, 116 pages, 160 tables, 28 cron jobs, 11 locales).
Target: this repository (57 tables, 27 routes). Goal: the same user-visible functionality.

"Present" means a user can do the same thing; "partial" means the core exists but named parts are missing.
Paths without a prefix are in the reference under `src/app/app/[orgId]/` or `src/app/api/`.

## 1. Summary by area

| Area | Status | In short |
|---|---|---|
| Operations, DüV, ENNI/ENDO, plant-protection checks, inventory, templates | present | Often stricter than the reference (lifecycle, audit, part fields); models, BESyD/ST, task board, crop depth pages built (§7) |
| Fields, boundaries, satellite, productivity zones, VRA | present | Soil suite, yield maps, cadastre and leases, field manager, application maps built (§7). Out of scope: B2B Maps |
| Economics, carbon, overview | present | Multi-year, benchmarks, market prices, news feed, BEK CO2 analysis, RothC, report built (§7). Out of scope: partner console, co2nserve overview |
| Weather and agronomic models | present | Stored weather, condition bars, trafficability, BBCH with calibration, ISIP disease, water balance, radar (§7). Out of scope: microclimate, climavi |
| Integrations and imports | out of scope | Provider integrations excluded (decision §5); data import page for application data, shapefiles and ISO-XML exists |
| agmeo Chat, knowledge base | out of scope | Excluded (decision §5) |
| Platform | present (in scope) | Keycloak, files, mail, jobs, 11 languages, farm-restricted members, onboarding, settings, digests (§7). Out of scope: billing, API keys, public API, staff/admin tools |

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
| Field table | `fields/[year]/columns.tsx`, `ColumnConfigBar.tsx` | done (feat/parity-fieldtable) | Crop plan table (`/crops`): batch `crop-table/conditions` and `crop-table/evaluation`, the reference's columns and quick views, inline edit of crop, sowing date, expected yield and field groups, BBCH observations (`crop_cycle_bbch_calibrations`). Not ported: technology/template, crop rotation and field/sub-field name cells (edited on their own pages), row grouping (the reference has none on this table) |
| Secondary crop, plan next year | `AddSecondaryCropDialog.tsx`, `PlanNextYear.tsx` | done (feat/parity-fieldtable) | — (row and bulk action "Nebenkultur hinzufügen", "In <Jahr> übernehmen", banner on an empty season) |
| Boundary import | `_components/ImportFieldDialog/*` | done | Data import page; rotation pick/create and location check added (000105 branch). No state picker needed (columns and land-use codes are detected); no open-water check |
| Cadastral parcel selection (state WFS) | `SelectFieldsTab.tsx`, `lib/cadastral` | done | German states only (no AT/PL/… countries); IACS boundary tiles of `SelectFieldsTab` not ported (no GYI data) |
| Edit boundary | `edit-boundary/*` | present | — (cut holes, simplify, reason, restore, planned changes) |
| Fields manager | `fields-manager/[year]/*` | present | — (merge, renumber, archive/restore; split via boundary cut) |
| Lease management + analytics | `LeaseManagementTable.tsx`, `LeaseAnalytics.tsx` | done | Inline cell editing (dialog instead), parcel hover popup on the field map |
| Crop rotations page | `fields/[year]/crop-rotations` | present | — |
| Field groups / cultivation groups | `fieldGroups`, `cultivation-groups` | present | — (field groups; crop + template assignment) |
| Org map layers | `_components/mapLayers/*`, `maps/*` | partial (thematic layers done) | Background rasters (other branch), stations, live locations, terrain rasters (TWI, slope) |
| Live locations, tracks, time travel; saved locations | `live-locations`, `saved-locations` | out of scope | Mobile app |
| Satellite annotations, field documents, field overview PDF | `SatelliteAnnotation*`, `FieldDocuments.tsx` | present | — (overview PDF via browser printing) |
| B2B Maps (~120 layers, raster analysis, access admin) | `src/app/maps`, `lib/b2b-maps` | out of scope | Separate product |

### 3.2 Soil

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Field soil samples | `soil-maps/*` | done (feat/parity-soil) | Zone editor (brush, fill, pencil, undo) on the soil field page |
| Zonation (FCM, k-means, probe, segment), grid/Voronoi sampling, batch | `soil/map`, `soil/_components` | done | TWI, BK50/BÜK200 and soil-rating sources and DSM texture enrichment (no data sources in agmeo) |
| Sample cards (PDF/SHP/GeoJSON), lab upload + matching, probes | `ExportZonationsModal.tsx`, `soil/probes` | done | PDFs are vector maps without satellite/TWI background; `soil/probes` (physical profile samples) not ported |
| History, compare, analysis dashboard | `HistoryDrawer.tsx`, `soil/analyse` | done | Dashboard map |
| Public share link with password | `src/app/share/soil/[token]` | done | CSV/Excel export on the share page |

### 3.3 Satellite, yield, application maps

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Satellite history and tiles | `satellite`, `cron/satellite-crawler` | present (redesigned) | LAI, SAVI; per-scene stats dialog, image export |
| Productivity zones | application-map base zonation | present | — |
| Yield-map import (ISO-XML/AFT/GeoJSON, cleaning, rasterise) + yield analytics | `cron/yield-map-import`, `lib/analytics/yieldMap*` | present | Provider-fed sources (John Deere, CLAAS, AGCO, NEXT Farming); yield zones as a base in the VRA editor |
| Application maps per cultivation | `applicationMapsPage/*` | present | JD/CLAAS/AGCO push (integrations); terminal-specific conversion |
| Bulk application maps | `application-maps/[year]` | present | — |
| Zone optimisation with ESM N model | `optimization/page.tsx` | present | Needs `ESM_SERVER_URL`; ESM timeseries 404 for this app's ids until the ESM drops its id check |
| Maize dry-matter monitoring | `maize-dmc/[year]`, `cron/dmc-harvest-detection` | present | Needs `MAIZE_DMC_API_URL`; variety offsets instead of KWS regions |

### 3.4 Operations and crop production

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Operations | `transactions`, `operations` | present | Action catalogue (diesel l/ha, kWh/ha, h/ha), custom actions, CO2/diesel per row |
| Operations overview map | `operations/[year]` | present | — (operations map with field-group filter; template and straw on crop assignment) |
| Templates | `operations/_components/template-builder` | partial | Public system templates, AI proposal, per-step costs (builder, copies and other organizations' templates ported) |
| Tasks | `tasks/_board`, `tasks/[id]/comments` | present | — |
| Crop calendar | `crop-calendar` | present | — |
| Seeding, tillage tabs | `seeding/[year]`, `tillage/[year]` | present | — |
| Plant protection | `protection/[year]` | partial | Inline dose min/max and water checks, Wirkbereich (type) column |
| Harvest | `harvest/[year]` | partial | — (yield-map upload, batch satellite yield estimate and coverage KPIs ported) |
| Irrigation | `irrigation/[year]`, `irrigation/water-balances` | partial | Raindancer coverage tracks (integration), external event API |
| N fertilization (DüV) | `nitrogen/[year]` | present | — (inline per-dose editing stays in the operation form) |
| Base fertilization | `base-fertilization/[year]` | present | — (application-map shortcut from the tab) |
| Emission recommendations | `recommendations/[year]` | done (leftovers) | — |
| Voice drafts | `voice-drafts`, `cron/voice-transcription` | done (leftovers) | Needs `VOICE_STT_URL`; mobile capture app out of scope |

### 3.5 Regulatory

| Feature | Reference | Status | Missing |
|---|---|---|---|
| ENNI, ENDO, N170, DüV report | `export/enni`, `export/endo` | present | Export history archived as files |
| BESyD (BB/SN/ST/TH), Sachsen-Anhalt LLG | `export/besyd`, `export/st` | present | — (grazing not modelled) |
| Fertilizer-report wizard | `economic-analysis/[year]/fertilizer-reports` | present | — |
| Plant-protection record EU 2023/564 | `protection-reports` | present | CSV format equivalence unverified against an authority |

### 3.6 Resources

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Warehouse | `personalize/products` (Inventory*) | present | — |
| Product master data | `personalize/products/master-data` | present | Product sharing across organizations |
| Prices per year | `prices/[year]` | present | — |
| Calculation parameters | `personalize/parameters` | present | Read-only, with citations |
| Machinery | `machinery` | present | JD sync (integration) |
| Operators | `operators` | present | Staff number, role, notes |
| Variety browser | `app/varieties` | done (leftovers) | BSL data is the reference's 2026-02 snapshot |
| Files | `files/[year]` | present | — |

### 3.7 Economics, carbon, overview

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Profitability per field | `economic-analysis/[year]` | present | — |
| Farm economics settings | `FarmEconomicsDialog.tsx` | present | — |
| Benchmarks | `economic-analysis/[year]/benchmark` | present | — |
| Market prices (EU portal cron, compare modal) | `cron/market-prices`, `MarketPricesModal.tsx` | present | The EU feed was suspended when built; the job tolerates it |
| Overview (cultivation-group table, scope 2) | `overview/[year]` | out of scope | co2nserve page; scope 2 is in the CO2 analysis |
| CO2 analysis | `analysis/[year]`, `lib/co2calculator` | done (phase 4, carbon; report in leftovers) | Projects are the user's own organizations |
| RothC carbon tab | `[cultivationId]/carbon` | done (phase 4, carbon) | Needs `THUENEN_API_KEY` |
| Yield research | `yield-research/[year]` | out of scope | Internal |
| News feed + staff announcements | `news/[year]`, `lib/news`, `src/app/team/news` | partial | Staff announcements (staff tools out of scope) |
| Predictions API (yield, DMC, BBCH, GDD, LAI, nFK, grassland) | `predictions/*` | partial | Shown in the app (DMC, grassland, BBCH/GDD, LAI, water balance); the public predictions API is out of scope |
| Partner console + partner analysis | `src/app/partner/[slug]` | out of scope | Excluded (decision §5) |

### 3.8 Weather, models, devices

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Weather | `cron/weather-crawler`, `fields/[id]/weather` | present | — |
| Condition bars (spray with Delta T, sowing, risk, trafficability; 4 levels, crop/BBCH aware) | `lib/weather/conditions.ts` | present | — |
| Trafficability (FAO-56 → pF → precompression → tyre stress) | `lib/trafficability` | present | — |
| Microclimate API (10 m layers) | `api/microclimate`, `lib/microclimate` | out of scope | Excluded |
| DWD RADOLAN radar | `api/radar`, `cron/radar-refresh` | present | — |
| climavi stations (list, detail charts, compare, frost) | `stations`, `oauth/climavi`, `cron/climavi-validate` | out of scope | Integration |

### 3.9 Integrations and imports

| Feature | Reference | Status | Missing |
|---|---|---|---|
| Connections page, OAuth, refresh | `settings/ConnectionsPage.tsx`, `oauth/*`, `cron/oauth-refresh` | out of scope | Excluded (decision §5) |
| John Deere (wizard, nightly sync, telemetry, write-back) | `lib/johndeere`, `actions/johndeere` | out of scope | Excluded (decision §5) |
| CLAAS connect | `lib/claas`, `cron/claas-sync` | out of scope | Excluded (decision §5) |
| AGCO FarmENGAGE | `lib/agco`, `cron/agco-sync` | out of scope | Excluded (decision §5) |
| NEXT Farming cloud + Pro backup | `lib/nextfarming` | out of scope | Excluded (decision §5) |
| Raindancer, FarmNet | `lib/raindancer`, `farmnet.ts` | out of scope | Excluded (decision §5) |
| Import contract | `import/{jobs,schema,snapshot}` | out of scope | Excluded (decision §5) |
| AI import requests | `ai-import`, `staff/import-requests` | out of scope | Excluded (decision §5) |
| Public API, Pöttinger docs, webhooks, ESM write-back | `docs/api`, `api/public`, `webhooks`, `esm` | out of scope | Excluded (decision §5) |

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
| Members, invitations | `settings/MembersPage.tsx` | done (platform) | Members limited to farms, enforced by row policies |
| API keys | `settings/ApiKeysPage.tsx` | out of scope | Excluded (decision §5) |
| Onboarding | `app/onboarding/*`, `api/onboarding/farm` | done (platform) | Partner bulk-onboarding API (`api/onboarding/farm`, out of scope; the import contract covers it); standard technologies per crop |
| Settings tabs | `settings/_components/*Page.tsx` | done (platform) | Out of scope: communication (co2nserve/Rentenbank), partnerships, connections, subscription, API keys, chat |
| Billing | `checkout`, `coupon`, `lib/subscription`, `webhooks/zoho` | out of scope | Excluded (decision §5) |
| Admin dashboard, API stats, staff team pages (clone org, manage orgs, news, partners, KTBL) | `src/app/admin-dashboard`, `src/app/team` | out of scope | Excluded (decision §5) |
| Languages | `src/i18n/common` (11) | present | — (11 languages; mails and server PDFs German or English) |
| Help page, PWA manifest | `app/help`, `public/site.webmanifest` | done (platform) | Coupon, PSM and variety links, cookie settings |
| E-mail digests (rain, storage) | `cron/rain-digest`, `cron/storage-digest` | done (platform) | Field list sorted by rain (no rain column) |

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

- **Disease risk** (000090): the worker fetches ISIP's cereal disease models daily from Feb 15 to
  Jun 30 (Keycloak password grant, as agmeo-crawlers does) and the conditions tab shows the disease bar
  and per-disease levels. Off while the ISIP credentials are empty.

Differences: the reference reads disease risk through its crawler service, which writes into the
reference database; here the API calls ISIP itself, for every organization (no add-on gating). Soil
texture fractions are mid-points of the LUFA class until measured texture exists; microclimate and
climavi stations stay out of scope.

### Phase 4 — economics (partly, 2026-10-19)

- Profitability by field, crop or field group with the reference's waterfall down to the farm
  result, coverage of the records, ranking, detail dialog and DB I map; multi-year view; benchmarks;
  EU Agri-food market quotes (000044; the feed was suspended at the time of writing, which the
  job logs and tolerates); the remaining farm-economics settings and a lease per field.

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

### Phase 4 — carbon (built 2026-10-19)

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
  ("carbon light" fertilizers); the green-technology urea categories are used only by the savings
  measures.
- Rotation CO2e per entry has no diesel (templates carry no machine data yet); RothC years use the crops'
  default sowing and harvest months, the entry's expected yield (else the DüV reference yield) and leave
  residues on the field.
- "Projects" are not stored: the comparison picks among the organizations the user belongs to.
- The report (third view) is printed through the browser instead of the reference's LaTeX template.

### Phase 3 — soil, yield and satellite (2026-10-19)

- **Soil suite** (000050–000052): satellite zonation in agmeo-geo (fuzzy c-means, k-means++, equal-area
  segments, probe and probe-v2, automatic zone count), grid, Voronoi and productivity-zone sampling plans,
  zone editor, probe numbering, sample-card ZIP (PROBEKARTE + CONTOUR), zonation and results PDFs, GeoJSON
  and shapefile exports archived to Files; lab upload (LUFA/FarmFacts and agrolab CSV, agrolab xlsx,
  returned Probenkarte shapefiles) with matching by probe number or location, writing zone values and a
  field soil sample that nutrient planning uses; history with campaign comparison and restore, bulk
  states, analysis dashboard; password-protected share links with a public page.
- **Yield maps** (000060): ISO-XML time logs, AGRO-MAP, point shapefiles and GeoJSON; the reference's
  cleaning, merge, calibration and moisture standardisation; rasters on the field's 10 m grid, zone
  yields, yield zonings, write-back of documented yields, the satellite harvest estimate; harvest
  overview, crop "Ertrag" tab and the field's yield history.
- **Satellite scenes**: scene statistics (mean, median, spread, 20/80 % quantiles from 000046, cloud
  cover) with image copy and download; annotations per scene (000047: marker, freehand, polygon,
  rectangle with colour and note); SAVI and LAI layers (000045).
- **Field documents and overview** (000048): documents per field and harvest year in the
  "Schlagdokumente" folder; field overview of a harvest year printed to PDF.
- **Application maps** (000095): base zonings from productivity zones, yield maps, the soil zonation, an
  uploaded file (GeoJSON, shapefile, ISO-XML grid) or one or several satellite scenes classified by the geo
  worker, plus uniform and hand-drawn ones, with a default per field; the reference's rate logic
  (proportional or inverse to relative yield, 65–135 % clipping, spreader step, target stand with
  germination, nutrient columns); brush editor; maps for many fields at once; single and batch export as
  ISO-XML, shapefile or GeoJSON; saved maps per field, crop and organization.

Differences from the reference:
- Soil: no TWI, BK50/BÜK200 or soil-rating sources (no such data here); zone edges are simplified rather
  than Chaikin-smoothed; content classes come from agmeo's VDLUFA functions as in nutrient planning;
  exports are generated by the API, PDFs without satellite background; no physical soil probes, zonation
  upload from files or field locking.
- Yield: rasters use the field's UTM 10 m grid instead of Web Mercator; parsing runs in the worker
  without streaming (1.5 GB per archive member); no provider downloads (John Deere, CLAAS, AGCO).
- Field overview PDF: printed through the browser's PDF printing rather than generated with jsPDF.
- Detaching a field document trashes it only when it was uploaded there and no other field uses it.
- Application maps: no terminal-specific conversion (the reference sends maps to an external "Machine
  Maps" service); a map references its zoning, so a zoning in use cannot be changed or deleted; no TWI or
  5-year-NDVI model bases; no "record the operation" prompt after export.

### Phase 5 — monitoring extras (2026-10-19)

- **Maize dry matter** (000080): maize-dmc-api client (`MAIZE_DMC_API_URL`, `MAIZE_DMC_API_TOKEN`),
  daily forecast runs per crop with plausibility guard, calibration by measurement or variety offset,
  silage harvest probability and window, daily harvest detection job; page "Mais-Trockenmasse".
- **ESM nitrogen model** (000090): runs through the ESM server (`ESM_SERVER_URL`, `ESM_API_TOKEN`),
  zones mapped onto the productivity zoning, N demand per zone compared with the DüV figure in the zone
  optimisation; crop timeseries.
- **Grassland predictions** through grassland-api (`GRASSLAND_API_URL`), with field-mean NDMI.
- **LAI and SAVI** indices (see phase 3).
- Every service stays off while its URL or credentials are empty: reads say "not configured", calls
  answer 503 `service_not_configured`, jobs skip themselves.

- **Languages** (000049): Czech, Spanish, Estonian, French, Lithuanian, Latvian, Polish, Romanian and
  Ukrainian beside German and English, seeded from the reference app's catalogues where the German text
  matches (about a third) and translated otherwise, with each language's plural forms; a catalogue loads
  on demand, missing keys fall back to English. Mails and server-side PDFs stay German or English.

Open:
- ESM timeseries answer 404 for crop cycles of this app until the ESM stops checking ids against the
  reference database; no ESM writeback receiver; ESM runs are started by hand only.
- DMC: offsets per variety instead of per KWS sales region; no pre-computing job; FAO maturity entered
  in the app.

### Cadastral parcels and leases (2026-10-19)

- **Cadastre** (000105 `cadastral_parcels`, `parcel_leases`): the 16 states' ALKIS WFS configuration and
  parsing ported to `backend/agmeo-api/src/modules/cadastral/wfs` (INSPIRE, AdV simplified, Berlin),
  with own UTM reprojection and GML reading; multi-part parcels and holes are kept; the
  Flurstückskennzeichen is decoded into Gemarkung number, Flur and number. Requests go through the API
  (`GET /cadastral/lookup`), split into grid cells cached for 24 h and limited to 4 at a time. States
  whose extents overlap are tried in turn (the reference picked one and found nothing south of
  Göttingen). Unit tests run on responses recorded from the services on 2026-10-19.
- **Field from parcels**: new mode "Flurstücke wählen" on "Schläge hinzufügen"; the boundary is the union
  of the picked parcels, which are stored with the field.
- **Parcel sync** (`POST /cadastral/sync`): fetches the parcels under fields; stored parcels are never
  overwritten; parcels with less than 1 % of their area inside the field are skipped (the reference took
  every touching parcel).
- **Leases**: one per parcel (kind, owner, address, leaseholder, rent per year or per ha, term, land
  register, notes); page "Pachtverwaltung" with lease-coloured map, table, GeoJSON export; analytics with
  areas by status, rent, rent per leased ha, per-field figures, uncovered area and expiring leases.
- **Economics**: a field's own `lease_per_ha` (now editable) wins, else the rent derived from its parcels
  (only when every leased parcel has a rent), else the farm figure.
- **Import extras**: crop rotation picked or created inline for the imported fields; fields outside
  Europe, the organization's country or 300 km from its fields need a confirmation.

Open:
- Bayern needs an LDBV contract (answers "no access"); non-German cadastres (AT, PL, NL, FR, …) of the
  reference's `countries.ts` are not ported.
- `SelectFieldsTab`'s click-to-select IACS boundaries with crop of the year depend on the reference's GYI
  boundary dataset, which this app does not have; the parcel picker covers selecting land on the map.

### Platform (2026-10-19, `feat/parity-platform`)

- **Members limited to farms** (000120): `memberships.restricted_to_farms` and `membership_farms`;
  restrictive row policies on farms and every farm- or field-owned table (`app.allowed_farm_ids()`,
  `app.allowed_field_ids()`), so a limited member's queries and writes stay within their farms. Owners are
  never limited; a limited manager can only hand out farms they see. Team page: farms column and editor,
  farm choice when inviting.
- **Onboarding**: organization → farm → crop setup (rotations, a template and expected yield per crop,
  prices of the template inputs and fuel) → fields → invite several colleagues; the open step is stored on
  the organization (000121), the start page resumes it, the overview shows a banner, every step skips.
- **Settings tabs**: organization with logo (000121; shown in the organization switcher, on the print
  views and the soil PDF sheets), region (country, NUTS 2), notifications (organization switch for the
  rain digest, personal switches), export (ZIP of every tenant table as CSV or JSON plus field boundaries
  as GeoJSON and Shapefile, through the row policies), soil (zonation lock enforced in the API, history
  share links), data processing (built from the running configuration; `DATA_PROCESSING_*` name the
  operator's hosting, database and mail).
- **Digests** (000122): `notifications.rain-digest` every quarter hour with the reference's timing in the
  organization's local morning, rain from the stored hourly weather, fields limited to each member's
  farms; `notifications.storage-digest` on Mondays to owners and managers above 80 % of the allowance and
  an operations overview (`STORAGE_DIGEST_RECIPIENTS`). German/English templates, HMAC unsubscribe links
  (`EMAIL_UNSUBSCRIBE_SECRET`) with RFC 8058 one-click and `/unsubscribe/:token`.
- **Help page** and **web app manifest** with icons rendered from the favicon.

Differences from the reference:
- Farms are organizations in the reference; "farm-restricted members" here limit a member to some farms
  of one organization (the reference's nearest equivalent is the partner console).
- No standard technologies per crop and no technology survey: the template step offers the
  organization's own templates and links to the templates page.
- The labour rate is not part of the onboarding prices (it is set per employee and per season).
- The rain digest links to the field list (it has no rain column to sort by); the storage digest has no
  bucket scan (usage comes from the files table).
- The partner bulk-onboarding API (`api/onboarding/farm`) is not ported (partner/public API, out of scope).
### Leftovers (2026-10-19)

- **Emission recommendations** (no migration): on `/carbon`, tab "Einsparpotential". Measures priced with
  the BEK calculator per crop cycle, as the reference's sanity checker does: organic fertilizer
  incorporated after 4 or 8 h → within the hour, urea with inhibitor → green-technology production
  (UREA_W_INHIBITOR_BLUE, liquid by volume), straw taken off → left on the field. Scenario chart (0, 10,
  20, 30 % and maximum, largest measures first, the last one partly), per crop and total; measure list
  with operation links; crop-cycle table. `GET /carbon/recommendations?harvestYear=`.
- **CO2 report** (000127 `carbon_report_notes`): tab "Bericht" with the generated summary (editable,
  reset to generated) and notes per harvest year; "Bericht als PDF" prints introduction, summary, crop
  table, per-crop management data (mineral and organic N, share incorporated within the hour, last
  year's N, plant protection, grain:straw ratio), emissions by operation, footprint, year comparison,
  scope 2, savings measures and notes. `GET /carbon/report`, `PUT /carbon/report/notes`.
- **Voice drafts** (000125 `voice_drafts`): page "Sprachnotizen". Recording in the browser
  (MediaRecorder) → object storage → job `voice.transcribe` → speech-to-text over an OpenAI-compatible
  endpoint (`VOICE_STT_URL`, `VOICE_STT_API_KEY`, `VOICE_STT_MODEL`; off when unset, the page says "not
  configured") → draft. Typed dictations need no service. The reference's OperationDraft contract (16
  keys, validator ported with its tests) is filled by a rule-based German parser that matches the
  organization's field and product names (inflected forms, product by first word or compound end);
  the draft resolves to field, product, rate in the product's unit, operation type and day. Review:
  correct the transcript (re-parse), "Maßnahme anlegen" opens the operation form prefilled (product,
  rate, day, BBCH, weather, notes) and confirms the draft with the new operation; observations/notes
  are accepted; reject; retry failed recordings.
- **Variety browser** (000126 `bsl_varieties`): the reference's Beschreibende Sortenliste (2,231
  entries, 20k properties) ships as `backend/agmeo-api/data/bsl/varieties.json.gz`
  (`scripts/export-bsl-data.py`) and is loaded by `pnpm sync:bsl` (agmeo_refdata), with repeated entries
  merged and links to the BSA register by Kennnummer or name. Page "Sorten": species or crop, search,
  table with maturity, lodging, winter kill, yield, TKM, 1–9 disease ratings and approval; all properties
  per variety. The reference's trait and resistance reductions are ported with their tests;
  `GET /variety-catalogue/resistance` answers its mobile lookup by name or crop cycle.
- **Map thematic layers** (no migration): on the map a third layer "Themen": DB I per ha (finance
  permission), yield relative to the crop, CO2e and N per ha, soil zones by parameter with VDLUFA class,
  trafficability of a machine for today to +7 days; legend, list values, popup lines.
  `GET /map/kpis`, `/map/soil`, `/map/trafficability`. The radar was already on the map.

Differences from the reference:
- Voice: the reference extracts with an LLM (Claude Haiku over OpenRouter); here a rule-based parser does
  it, so it works and is tested without any service; units add m³/ha and dt (converted to t/ha). The
  reference's web app has no review page (its mobile app does), and its confirm records only the decision.
- Recommendations: only products typed "urea with inhibitor" get the green-technology measure (the
  reference lists three SKW products); incorporation is recommended for the 4 h and 8 h classes.
- Varieties: one row per variety and BSL use group; no admin import summary page; the list is not
  refreshed from the Bundessortenamt (the reference has no updater either).
- Map: per-field choropleths over the field outlines (no vector tiles); soil shows zones of the active
  zonation only (no field fallback from samples without zonation); trafficability is computed per field
  on request (at most 400 fields).
### Phase 1 — crop-production depth (2026-10-19, migrations 000110–000114)

- **Seeding and tillage tabs**: machine, implement, operator, diesel, electricity (kWh/ha, migration
  000110) and working time per ha; target density, seed rate, total seed and seed units (reference
  seed-rate conversions with their tests); "distribute a total" over the selected sowings; seeding-map
  link to the field's application maps; sowing window per field.
- **Plant protection**: spray window and ISIP disease risk per field; BBCH at the application date
  (recorded, else the calibrated model's) with the reference's BBCH dialog (model and calibrated
  curves, temperature, vernalization, day length, observations and history, model parameters) on the
  field-table branch's `crop_cycle_bbch_calibrations` and `bbch-observations`; BVL Auflagen with
  drift-reduction tiers synced into `psm_restrictions` (000112) and shown per product with approval
  and approved use; NT127 makes the time of day a required record field; tank-mix badge; approval
  findings per operation (`protection/checks?seasonId`); the DVO 2023/564 dialog with certificate and
  sprayer inspection; operator, usage type and time columns.
- **Irrigation**: per crop the FAO-56 balance with the season's irrigation (planned ones included, as in
  the reference) and a rooting-depth override (000111); KA5 soil class, nFK, soil water as % nFK,
  sparkline and the detail view; irrigation method; methodology dialog; irrigation map.
- **Nitrogen**: the agmeo N balance per crop (demand from the yield-N curve; Nmin, spring
  mineralisation, leaching and target Nmin from the farmer's value, the latest ESM run or the
  reference's soil-class estimates; DüV deductions), N supply and loss panels, the DüV check, and
  fertilization strategies (three public, own ones) applied as planned doses (000113).
- **Base fertilization**: soil values, need by content class, delivered/planned, balance, lime
  (computed or entered, 000114), straw, and the DüV §6 six-year P2O5 balance with its yearly view.
  Fixed: MgO classes now use mg Mg (÷ 1.6583); no need without a soil value (as in the reference).
- **Operations map** with field-group filter; template and straw choice when assigning crops.
- **Templates**: questionnaire builder, copies, read-only templates of the user's other
  organizations with "save as own", unique names per crop, used templates are kept, a crop saved as
  template.

Differences from the reference:
- Hours are stored per machine line, not per hectare; the tabs show and set time per ha.
- Seeding keeps grains/m² (drill setting) as the edited value; target density is derived.
- The irrigation map colours fields by documented water; the reference draws Raindancer irrigator
  tracks, an integration that is out of scope.
- Apply strategy writes planned operations directly (one per dose, a month apart) instead of staged
  table edits; done and running doses are not changed.
- The questionnaire builder creates relative-dated steps without the reference's KTBL costs, AI
  proposal or calendar views; there are no public system templates.
- Public strategies carry no product; the fertilizer is chosen when applying.

