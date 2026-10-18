# OneSoil → agmeo port plan

Status: slices 1–3 built (2026-10-18); the rest is a proposal. Source: `AGVOLUTION/onesoil` (frontends `web-scouting` and `yield` = OneSoil Pro;
Agvolution holds the rights). The repo has **no backend**: every raster job, zoning, export and integration was
server-side, so the frontends give us the domain model, the API contracts, the client maths and the constants —
the backend we build ourselves on agmeo's stack (NestJS + Postgres/PostGIS + `agmeo-geo` in Python).

We port *logic*, not code: no Leaflet/Redux/Django idioms, no OneSoil branding, no billing or upsell funnels.

## 1. What OneSoil is, functionally

```
Sentinel-2 history ──► per-image NDVI (validity %, avg/min/max/std, colour + contrasted PNG, true colour)
        │
        ├──► monitoring: timeline, cloud-aware date picker, compare two dates, all-fields map colouring
        │
        └──► PA info (multi-season productivity map + stability + status code)
                 ├──► productivity zones 3/5/7 ─┐
   single NDVI date ──► histogram zones 3/5/7 ─┤──► zones editor (brush/fill/erase) ──► custom zoning
   soil-lab result ──► property zones 2–7 ────┘
                                               ├──► VRA map (sowing/fertilizing/spraying/several, per-zone rates,
                                               │      trial strips) ──► SHP / ISO-XML / KML, John Deere
                                               └──► soil-sampling plan (cells + points) ──► SHP / GPX / KML / PDF
                                                         └──► lab results (osl_* mapping, interpolation)
yield / quality machine data ──► analysis: mean per VRA zone, trial-strip deltas, counterfactual without VRA
scouting notes (point, type + issues, photos, share link) · weather (GDD, precipitation) · seasons/crop rotation
```

## 2. Gap map

| Capability | OneSoil | agmeo today | Gap |
|---|---|---|---|
| Imagery history | S2 since 2016, lazily per field, `processed/total` progress | One local scene (T31UGV 2026-09-18) from `sentinel-archive` | **Blocker.** Need multi-year per-field imagery |
| Per-image contract | `{date, status, validity%, avg, min, max, std}` + `last_ndvi.dynamics` | `field_observations` with mean, P10/P90, valid %, status, change | Small: add std/min/max, one explicit usability rule |
| Index layers | NDVI default + contrasted, true colour | NDVI/NDRE/NDMI clipped tiles | Contrasted stretch, true-colour chips |
| Compare | two dates, synced maps or swipe | — | New |
| All-fields colouring | last NDVI, std (heterogeneity), crop, sowing/harvest date, yield; 18-bin histogram filter | crops, index mean | Add std, dates, yield, histogram filter |
| Productivity map + zones 3/5/7 | PA info, stability, status codes, `productivity_differences` | — | **New, core** |
| Single-date NDVI zones | clean ≥65 %, histogram, editable thresholds | — | New (cheap once zones exist; extend to NDRE/NDMI) |
| Zones editor | square brush 10–1000 m, fill, eraser, undo/redo, clip | terra-draw for boundaries | New |
| VRA maps | 4 types, per-zone rates, ± presets, totals, savings, units, trial strips | operations with inputs (flat rates) | **New, core**; link to planned operations |
| Prescription export | SHP (RATE / ≤6-char columns), ISO-XML, KML, terminal dialects, JD | fields GeoJSON export only | **New** (the visible backend gap) |
| Soil sampling | cells by count/size, quality, points, editor, SHP/GPX/KML/PDF | — | New |
| Lab results | upload, `osl_*` column mapping, matching, interpolation, legends | — | New |
| Machinery / yield import | upload → attribute matching → operations → layers | harvest totals only | New (feeds analysis) |
| Yield analysis | zone means, trial deltas, counterfactual | — | New, depends on VRA + import |
| Scouting notes | point, type + issues, photos, soft-delete/undo, share code | tasks; satellite observations | New; notes can spawn tasks |
| Weather | DarkSky; GDD, cumulative rain, BBCH annotations | Open-Meteo, GDD | Mostly done; BBCH monotonic annotations |
| Seasons / rotation | rotation grid, autofill, rotation warnings | seasons, crop cycles, crop planning | Rotation rule table, grid view |
| Field boundaries | ML-detected parcels | draw/import | Optional: InVeKoS/EuroCrops parcels |
| Field groups | folder tree, area per folder, boundary export SHP/GPKG/KML | farms | Folders within a farm, more export formats |
| Workspaces/roles | owner/admin/editor/viewer, consultants | orgs, roles, RLS | Consultant portfolio later |

## 3. The imagery prerequisite

Productivity zones need several seasons of clean scenes per field; OneSoil required ≥2 enabled scenes and
returned `NotEnoughSeasons` / `NotEnoughDates` otherwise. Downloading full tiles into `sentinel-archive` does
not scale (the archive inventory is 15.8 TB for a fraction of the country).

Proposal: `agmeo-geo` gains a **per-field STAC source** — query Earth Search (`sentinel-2-l2a` COGs on AWS,
public, no auth) by field bbox and date range, and read only the field window (B04/B08/B05/B11/SCL) with
rasterio range requests. Scenes from the local archive stay a second source. Per field-season this is a few
MB instead of GB, and it makes "backfill 2018–today for a new field" a background job with progress — the
exact `processed/total` contract OneSoil's UI was built around.

## 4. Build slices

Each slice is shippable and demoable on the Marschhof fields.

**Slice 1 — Imagery history** *(built: migration 000007, `agmeo_geo/history.py`, Satellite tab)*
- `agmeo-geo`: STAC field-window reader, SCL cloud mask, NDVI/NDRE/NDMI per field and date, backfill job
  triggered by `field.created` / `field.geometry_updated` / on demand, progress in a `field_imagery_jobs` row.
- One usability rule: `valid` if cloud-free pixels ≥ 65 % of the field (OneSoil's `min_clean`); add std/min/max.
- Field Satellite tab: multi-year timeline, cloudy runs collapsed, "load earlier" paging, contrasted stretch.

**Slice 2 — Productivity zones** *(built: migration 000008, `agmeo_geo/productivity.py`, Zones tab)*
- Pipeline: scene selection per season (best clean dates in the growing window), per-scene normalisation by the
  field mean, multi-season average → productivity raster; stability score (0–1) and status codes; classify into
  3/5/7 zones, vectorise, drop slivers below a minimum area, clip, `area_ha`, `productivity_differences`.
- Schema: `productivity_analyses` (per field + geometry version: status, stability, code, scene list with
  enabled flags), `zonings` (source `productivity|index_date|soil_result`, count, `is_custom`, geometry per zone).
- Zone ids are integers 1..N (low → high), not OneSoil's `m3..p3`, so even counts work.
- UI: Zones tab on the field page — productivity map, zones 3/5/7 in the purple palette, stability, scene
  exclusion with recalculation (keep ≥2).

**Slice 3 — VRA maps and export** *(built: migration 000009, `modules/vra`, contracts `vra.ts`, Zones tab)*
- `vra_maps` + `vra_map_inputs` (type, product link to inventory, crop for sowing, unit, standard rate, rates per
  zone, ≤6-char column). Rates stored canonically per ha; unit system (metric/imperial) only at the edges.
- Maths ported (contracts `vra.ts`, unit-tested in `modules/vra/vra.spec.ts`): default rate = standard ×
  productivity/100 (0 dp at ≥1000 or seeds, else 2 dp); presets ±5/10/15/20/30 %; total = Σ rate × area;
  savings vs flat rate shown when |Δ| > 0.1.
- Export, written in Node without dependencies (`modules/vra/export`): Shapefile zip (`RATE` or per-input
  columns, ZONE, AREA_HA, .prj WGS 84), ISO 11783-10 TASKDATA.XML zipped under `TASKDATA/` (treatment zones with
  polygons and DDI 1/6/11 setpoints, out-of-field and position-lost zones; validates against the V4.3 XSD),
  GeoJSON; ASCII file names ≤64 chars. KML not done.
- Open: "Create planned operation from VRA map" so inventory reservations and costs keep working.

**Slice 4 — Scouting notes**
- Notes with point, field auto-link, type + typed issues, photos (upload then attach), observed date,
  author, soft delete with undo, filters, "create task from note"; share code with a public read-only page.
- Mobile-friendly capture page; offline queue later.

**Slice 5 — Single-date and soil-based zones, zones editor**
- Index-date zoning with histogram and editable thresholds (validation: every range non-empty), also for NDRE/NDMI.
- Zones editor on MapLibre + turf (brush, fill, eraser, undo/redo, clip), saved as a custom zoning; server
  runs `ST_MakeValid` and recomputes areas.

**Slice 6 — Soil sampling and lab results**
- Cells by count or size (default size by field area 2/3/4/5 ha), quality colours, points per cell with padding,
  point editor, SHP/GPX/KML/PDF export. Lab upload with `osl_*` mapping, ID or spatial matching, IDW
  interpolation, class-break legends (OneSoil's soil-analysis table), VRA from a soil property.

**Slice 7 — Machinery import, yield analysis, trials**
- Upload → attribute matching → operations, as-applied/yield layers; zone means and trial-strip deltas; check
  strips on VRA maps. John Deere export via the existing JD integration.

**Later / optional:** compare-dates swipe view, histogram map filter, rotation grid and rules, parcel-dataset
boundary suggestions, consultant multi-client portfolio, PDF report.

**Not ported:** billing and Pro funnel, remote-config flags, analytics SDKs, modems, IoT stations, the raw.png
value encoding (we read COG values directly), Leaflet image overlays.

## 5. Known OneSoil pitfalls to avoid

- `m3..p3` zone names break on even counts → integer ids.
- Two inconsistent cloud filters (`status !== 2` vs `validity > 0 && status === 1`) → one rule.
- Area recomputed asynchronously after geometry edits → PostGIS synchronous, as agmeo already does.
- GDD cap defaults to 0 when `temp_max` is missing; °F conversion of a GDD sum adds 32 → defaults 10/30 °C,
  convert differences not temperatures.
- `unit_system` frozen per map with rates stored in that system → store per ha, convert for display.

## 6. Open questions the frontends cannot answer

These need our own design, or exports and docs from the old OneSoil backend if any exist:

- the productivity zoning algorithm (normalisation, classification, smoothing, minimum zone area) and how
  `suitability` and soil-cell `quality` are defined;
- per-terminal shapefile schemas (Amazone, Trimble, John Deere, Precision Planting);
- whether GDD uses the daily mean temperature; the unit of soil-sample padding (assumed metres).

Note: `frontend/yield/src/config/*.json` in the reference repo contains live Mapbox, Firebase and Sentry keys
in plain text. Do not copy them; they should be rotated.

## 7. Reference constants

Zone palettes (low → high): productivity `#F8D2FC #E5B5E9 #D499D7 #C27DC5 #A85BA8 #9D419C #8F1B8C`
(3 zones use stops 1/4/7, 5 use 1/3/4/5/7); index-date `#D0E3FC … #4392F1`; soil-result `#BEFFDA … #02B35D`;
undefined `#D1D1D6`. Soil sample quality `<0.85 #FF3A20`, `0.85–0.9 #FF953D`, `>0.9 #81D63C`.
Brush sizes 10/20/50/100/250/500/1000 m. Trial strips 1–2 per zone, 100 m default (1–1000), perpendicular.
Points per cell 3, padding 5 m, significance 0.2/0.5/0.8. Polling: progressive results 2 s ×1.2 to 5 s.
Palettes must still pass agmeo's palette validator before use (the purple zone ramp is sequential, single-hue).
