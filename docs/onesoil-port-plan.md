# OneSoil → agmeo port plan

Status: slices 1–3 built (2026-10-18); the rest is a proposal. Agvolution holds the rights to both sources:

- `AGVOLUTION/onesoil`: the frontends `web-scouting` and `yield` (= OneSoil Pro). They give us the domain model,
  the API contracts, the client maths and the constants.
- Zoho WorkDrive folder "Copy of onesoil-ag-2024-07-03" (`jnqal1746ec0e041b40b1b1e1436b7475ca2c`): a copy of the
  whole OneSoil GitLab group taken on 2024-07-03, about 160 repos and 20.9 GB. Its `web-scouting` and `yield` are
  the same snapshot as `AGVOLUTION/onesoil`, with full git history. New compared with GitHub:
  - the Django backend `backend/backend-core`;
  - the algorithm packages `rnd/precision-ag`, `data-platform/oslalgo` and `rnd/omgdal`, some with trained weights;
  - the R&D models under `rnd/`;
  - the ADAPT machinery converters under `adapt/`;
  - the React Native scouting app.

  The findings from this export are folded into §3–§8 below.

The backend we build ourselves on agmeo's stack (NestJS + Postgres/PostGIS + `agmeo-geo` in Python).

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

**What OneSoil did** (WorkDrive export):

- The old platform (`data-platform/osl_core`, `rnd/omgdal`, `rnd/yap_s2_pipeline_v3`):
  - processed whole Sentinel-2 L1C tiles in a tile cache (MongoDB + Celery);
  - had its own cloud masks: the rule `(B02≥1800)|(B01≥2000)|(B11+B12≤1000)|(NDSI≥0.3)`, a LightGBM model and a U-Net with
    classes clean/shadow/haze/light/dense/snow/unknown;
  - stored NDVI as lossy 6- or 8-bit JPEG 2000;
  - applied no SCL and no haze buffer;
  - required ≥ 90 % of the field clear.
- The newest NDVI service (`data-platform/api-gateway-stats`, `lambda_ndvi`) does what agmeo does: Earth Search
  `sentinel-2-c1-l2a`, a field window, an SCL mask. Our approach stands.

**Follow-ups for `agmeo-geo`:**

- `sources.py` counts SCL 6 (water) as valid. OneSoil's L2A services use 4 and 5 only. Drop 6.
- Report min/max as P3/P97 (OneSoil's `pcnt_min_max=(3, 97)`) next to mean, std, P10/P90.
- Scale the 300 m cloud buffer with field size. OneSoil dilates with `(1, 10, 20, 40, 80)` px chosen by field
  diameter; on partly cloudy days our fixed ring wipes out small fields.
- Flag pixels invalid on > 95 % of dates as permanently invalid (SCL misclassification over buildings, water,
  bright soil) instead of letting them lower every scene's clear share.
- Optional contrast view: histogram equalisation inside the field mask (`skimage.exposure.equalize_hist`), as
  OneSoil's "contrasted" layer, next to our 2–98 % stretch.

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
- Next algorithm version (`pz-4`). How OneSoil's algorithm works is in §7.
  - **Cross-season consistency.** Keep only scenes whose smoothed NDVI maps agree across seasons:
    - every pairwise Pearson correlation must be > 0.545, computed after a σ=2 Gaussian with a 2 px eroded border;
    - choose seasons by maximum count first, then maximum mean correlation;
    - one of the last two seasons must be included;
    - show excluded seasons as "inconsistent".
    This is the step that makes OneSoil's maps stable; we have none.
  - **Season window from the NDVI curve.** Detect the peak and trough of the field-median series:
    - Savitzky–Golay window 91, `find_peaks` with height 0.33 and distance 75–100 days;
    - fall back to 1 Mar–1 Oct for Europe when no peak is found.
    This replaces the fixed April–August calendar year, so winter crops and early harvests are not mixed. Candidate
    dates run from the peak to the trough with median NDVI ≥ max(0.25, 0.3 × peak).
  - **Crop filter.** Exclude seasons whose crop cycle is vegetables, grassland, fruit, vines or flowers
    (OneSoil's `BAD_CROPS`).
  - **Tercile stability.** Report the share of pixels in the bottom tercile in every scene plus the share in the
    top tercile in every scene, next to the leave-one-out correlation. Base the suitable/partial label on the
    minimum pairwise correlation (≥ 0.545) plus stability. OneSoil's CatBoost suitability models are not in the export.
  - **Status codes.** Add "fewer than 2 scenes ⇒ not suitable", the codes `field_too_small` (OneSoil's
    `SmallFieldProcessing`) and `field_unsupported`, and a `suggested` flag per scene next to `enabled`.
  - **Classes and normalisation.** Offer equal-area (percentile) classes as an option, which users know from
    OneSoil. Keep k-means as the default, plus our field-mean normalisation, sieve and coverage-simplify.
  - **Read buffer.** Read 50 m beyond the field (`DEFAULT_BUFFER_DISTANCE`) so smoothing does not break off at the edge.

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
- Open: **terminal profiles** on the Shapefile export. The schemas are in §7. Rules:
  - explode MultiPolygons into single parts;
  - file stem = field name slugified to ≤ 10 characters + `-YYYY-MM-DD`;
  - DOS zip attributes (`create_system=0`);
  - integer or real `RATE` per terminal. Round for integer terminals; OneSoil truncates with `int()`, which turns
    2.5 l/ha into 2. Warn when decimals are lost.
- Open: ISO-XML additions.
  - **Add** `DLT A="DFFF" B=31` per task so the terminal logs as-applied data against it; slice 7 imports that log.
  - **Optional:** PGP/CPC/OTP; a GRD type-2 grid mode (10 m cells, int32 `GRD00001.bin`) for terminals that reject
    polygon TZNs; a version switch (OneSoil defaulted to 4.2).
  - **Keep:** our V4.3 polygons with holes and the position-lost zone. OneSoil wrote every ring as exterior and sent
    lb/ac and gal/ac with metric factors. Our DDI factors (kg/ha ×100, l/ha ×10 000, seeds/ha ×0.1) match theirs.
- Open: **merge near-equal zones.** Merge neighbouring zones whose rates differ by less than a minimum step
  (`minZoneStep`), and fold empty zones into the lowest zone (`fertilizers-service`).

**Slice 4 — Scouting notes**
- Notes with point, field auto-link, type + typed issues, photos (upload then attach), observed date,
  author, soft delete with undo, filters, "create task from note"; share code with a public read-only page.
- Mobile-friendly capture page; offline queue later.

**Slice 5 — Single-date and soil-based zones, zones editor**
- Index-date zoning with histogram and editable thresholds (validation: every range non-empty), also for NDRE/NDMI.
  OneSoil's recipe (`omgdal`, `data_platform_legacy/pag/productivity_zones.py`):
  1. median filter `disk(3)`;
  2. add `gaussian(σ=5–10) × 0.5 × std` back;
  3. equal-percentile bins;
  4. sieve 8 px;
  5. polygonise and clip.
  
  The histogram drops 5 % tails and uses bins of 0.001. Threshold JSON: "3" → 2 values, "5" → 4, "7" → 6.
  Use proper k-quantiles: OneSoil's default `percentile(arange(1, 100, 100/k)[1:])` is off by one (34/68 for k=3).
  Mask with SCL; their backend loaded SCL but did not use it.
- Soil-result zones: `pd.cut` of lab values per cell on the thresholds (count − 1 values; even counts allowed),
  dissolve with a ±0.1 m buffer, rest of the field = "undefined".
- Zones editor on MapLibre + turf (brush, fill, eraser, undo/redo, clip), saved as a custom zoning; server
  runs `ST_MakeValid` and recomputes areas.

**Slice 6 — Soil sampling and lab results**
- Cells by count or size (default size by field area 2/3/4/5 ha), quality colours, points per cell with padding,
  point editor, SHP/GPX/KML/PDF export. Lab upload with `osl_*` mapping, ID or spatial matching, IDW
  interpolation, class-break legends (OneSoil's soil-analysis table), VRA from a soil property.
- Cell algorithm, from `precision_ag/core/soil_sampling` and `oslalgo/soil_sampling`; port as is:
  1. Quantise the productivity map into 25 equal-count bins and scale to 0–1.
  2. Run KMeans (`k-means++`) on `(x, y, value × max(H, W) × significance)`. Significance defaults to 0.5, with a
     slider of 0.2/0.5/0.8.
  3. Number of cells: `n = field_px // (100 × desired_ha)`, with 10 × 10 px = 1 ha and a default of 4 ha.
  4. Run 5 post-processing passes. Each keeps the largest connected part per cell and reassigns the other
     fragments to the nearest neighbouring cell centroid.
  5. Relabel the cells by centroid order.
- Points, from the backend's `sample_points_from_vector`:
  1. Buffer each cell inward by the padding in **metres** in a metric CRS.
  2. Lay a 10 m candidate grid inside.
  3. Run `KMeans(n_clusters = min(candidates, points_per_cell))`.
  4. Snap any centroid that falls outside the cell to the nearest point inside it.
  5. Write the columns `segment_id`, `sample_point_id` 1..n and `zone`.
- Cell quality is our own definition, because OneSoil's `stats.py` is missing from the export. Their `oslalgo` used
  `1 − mean(|v − cell mean|)` on the 0–1 image, with the plot thresholds good ≥ 0.9 and medium ≥ 0.8. Proposal: keep
  that formula and align the colours with the frontend's 0.85/0.9 bands. Validate against a square grid, as OneSoil did.

**Slice 7 — Machinery import, yield analysis, trials**
- Upload → attribute matching → operations, as-applied/yield layers; zone means and trial-strip deltas; check
  strips on VRA maps. John Deere export via the existing JD integration.
- **Import.** Do not run OneSoil's .NET ADAPT stack (`adapt/*`, `backend/adapt`). It needs Windows, vendor DLLs
  and a John Deere licence. Start with ISO-XML TASKDATA and Shapefile/GPKG plus a column-mapping step. Adopt its
  conventions:
  - ADAPT representation codes (`vrYieldWetMassPerArea`, `vrAppRateMassActual`, `vrSeedRateSeedsActual`,
    `vrHarvestMoisture`, `vrVehicleSpeed`, …) as canonical attribute keys, each with a `_Uom` column, converted to
    metric defaults;
  - per-column min/max/unit metadata for legends;
  - drop records with `dtRecordingStatus = Off`;
  - dedup points on (x, y, time) and operations on (start, end, type);
  - split an operation when start times are > 7 days apart. The Django side grouped operations within 30 days
    as parent and children.
  
  Yield column priority: wet mass/area, mass/area, wet volume/area, volume/area. Plausibility: a column counts only
  if its max is numeric and > 0; protein and starch must lie within 0–100.
- **Yield cleaning.** OneSoil's ADAPT layer had none. `oslalgo` rasterisation is the base:
  1. drop values ≤ 0 and keep P3–P97;
  2. remove "spaghetti" tails (distance transform > 1.5 px, dilated `disk(3)`);
  3. trim 20 m at track ends;
  4. calibrate combines to a master combine with an additive offset on overlapping cells, using the 5–95 % trimmed
     differences;
  5. clamp cell means at P98;
  6. smooth with a normalized Gaussian convolution;
  7. fill holes < 40–50 px with cubic `griddata`.
  
  Defaults: 10–15 m cells, drop percentile 1–2. Moisture correction to a target moisture — fix their formula, which
  mixes percent units. Add speed, headland, flow-delay and overlap filters ourselves.
- **Trial strips.** Adopt placement and rate swap exactly (`utils/productivity.py`, `control_lines/alg.py`):
  - Strips go in the lowest zone, the mean zone and the highest zone, for 3/5/7 zones. With 1 line only the lowest
    and highest zones get one.
  - Rate swap:

    | Strip | Low zone gets | Mean zone gets | High zone gets |
    |---|---|---|---|
    | 1 line | mean-zone rate | — | mean-zone rate |
    | Line 1 of 2 | mean-zone rate | low-zone rate | mean-zone rate |
    | Line 2 of 2 | high-zone rate | high-zone rate | low-zone rate |

    Line 1 wins where the two lines overlap; strips are clipped to their zone. On export, zones are split by the
    strips and each piece takes the strip rate.
  - Geometry, in a frame rotated to the driving direction:
    - exclude the headland: 50 m below 20 ha, 70 m below 50 ha, otherwise 100 m;
    - place strips where a vertical +1/0/−1 kernel (20/30/20 m) finds homogeneous ground;
    - default width 100 m (`2 × buffer_m`); a second line at least 80 m from the first.
- **Analysis.**
  - Zone mean with 5 % tails trimmed.
  - Strip delta = strip mean − adjacent zone mean, with a t-test as confidence. OneSoil's trajectory/scanner
    comparison (accept when ≥ 60 % of sub-deltas share a sign) is too heavy to port.
  - Counterfactual "without VRA" = the area-weighted mean over zones of the yield within the median-rate sub-zone.
  - Average rate with and without VRA, area-weighted.

**Later / optional:** compare-dates swipe view, histogram map filter, rotation grid and rules, parcel-dataset
boundary suggestions, consultant multi-client portfolio, PDF report.

**Not ported:**
- product parts: billing and Pro funnel, remote-config flags, analytics SDKs;
- hardware: modems, IoT stations;
- display tricks: the raw.png value encoding (we read COG values directly), Leaflet image overlays;
- from the export, the L1C imagery stack: tile cache, JPEG 2000 NDVI, L1C cloud models;
- from the export, models that need L1C B10, Sentinel-1 or a GPU: field-boundary detection (`rnd/boundary_detector`,
  `bnds4`), crop classification (`transformer1d_unet2d`, 7.6 GB);
- from the export, models without weights: the S1+S2 gap filler `cloudfree-ndvi`, soil moisture
  (`osl_ds_soil_moisture`, best model missing), yield prediction (`yiled_map_prediction`, `over_yield`, `dtp`);
- from the export, OneSoil's data-sales storefronts (`daas`, `b2b-calculator`, `price-calculator`).

## 5. New candidates from the export

| Candidate | Source | What it is | Verdict |
|---|---|---|---|
| BBCH stage prediction | `rnd/phenophases-predictions` | Keras conv1d per crop (7 models × 83 KB, weights included). Input: sowing date plus daily Tmin/Tmax/Tavg, rain, snow. Features: GDD = `cumsum(max(tavg, 0))`, cumulative rain, frost/heat/heavy-rain flags; user-confirmed stages override. Output: days after sowing per BBCH stage (winter wheat 10/31/51/75/87/89, maize 09/31/51/61/63/65/75/85/87). Trained on PEP725, Germany included | **Adopt.** It answers "BBCH monotonic annotations". Check the PEP725 licence. Feed it Open-Meteo instead of WWO/NOAA and re-validate on our crop cycles |
| Rotation engine | `rnd/crop-rotation-alg` | Rule lookup, `is_rotation_ok`, a greedy planner under area targets, KMeans field clusters. Rules in `rotation_rules.json` (~30 crops) | **Adapt.** Take the engine. Rebuild the rule table agronomically for Germany: GLÖZ 7, break years, rapeseed and legume intervals. Their scores are transition frequencies (maize → maize = 1.0), not agronomy |
| Sowing / harvest date detection | `rnd/sowing_dates` | 1-D MobileNet + ASPP on field-mean NDVI (+ S1). Savitzky–Golay 89/6, threshold 0.6, ≥ 60 days between sowings, ≥ 8 dates. Weights 61 MB each | **Later.** Validate on Marschhof fields with known dates using our L2A series without S1, then pre-fill crop-cycle dates |
| Wheat disease risk | `rnd/disease_risk` | Hourly weather rules for leaf, stem and yellow rust, Fusarium, Septoria (leaf temperature = air − 2 °C, wetness from rain or saturation deficit ≤ 0.2) | **Prototype only.** Two bugs: Fusarium never fires (`any(x) >= 2`), Septoria fires on any rain. Validated on two Ukrainian stations. Label as indicative |
| PK rates per zone | `b2b-services/fertilizers-service` | Removal per kg yield × expected yield ÷ nutrient fraction, about 70 crop keys; N strategies more-to-low/high/mid with fixed zone factors | **Adapt.** Add a `pk` mode to `suggestRates` on top of our VDLUFA base fertilisation. Keep the removal table only as a fallback for crops we lack, after checking the oxide basis. Ignore their bugs: uptake coefficient added instead of multiplied, P or K but never both |
| Bare-soil brightness and elevation layers | `backend-core` PA info | Brightness inverted and min-max normalised ("less value = less organic matter"); elevation shown P2–P100 | **Later** layer on the Zones tab |
| AB lines | `legacy/spatial-utilities/scripts/gaia/BuildField.py` | Headland rings of 20 m, parallel lines 25 m apart clipped to the inner field | **Low priority.** Use the field's own UTM zone; theirs is hard-coded to 17N |
| Offline scouting app | `frontend/mobile-scouting-app` | React Native, WatermelonDB sync, GPS, photos, growth stages, share codes | Reference for slice 4's offline queue |
| Boundary dedup | `backend/geometry-service` | Two boundaries are the same field if IoU > 0.9 | Use when importing parcels from several sources |

## 6. Known OneSoil pitfalls to avoid

- `m3..p3` zone names break on even counts → integer ids. The backend's 4-zone set `m2, m1, p0, p1` is asymmetric,
  and missing classes got 0.001° dummy squares (`fix_number_zones_EXT`). Do not port either.
- Two inconsistent cloud filters (`status !== 2` vs `validity > 0 && status === 1`) → one rule.
- Shapefile rates truncated with `int()`; ISO-XML rings all exterior; imperial units sent with metric factors.
- Sample-point centroids "corrected" into the cell but the uncorrected ones returned (`oslalgo/soil_sampling`).
- `season_detection` keeps a scene when its clean fraction is > 0.05 (should be the dirty fraction).
- Area recomputed asynchronously after geometry edits → PostGIS synchronous, as agmeo already does.
- GDD cap defaults to 0 when `temp_max` is missing; °F conversion of a GDD sum adds 32 → defaults 10/30 °C,
  convert differences not temperatures.
- `unit_system` frozen per map with rates stored in that system → store per ha, convert for display.

## 7. Questions the frontends could not answer, answered by the export

**Productivity zoning.** Source: `rnd/precision-ag`, `precision_ag/core/productivity_map.py:predict_maps`,
`prodyctivity_map_v2.process_field`, `zones/zones1.py`, `zones_v2.py`.

| Step | OneSoil | agmeo `pz-3` |
|---|---|---|
| Scene validity | Over the field: coverage > 0.999, shadow ≤ 10 %, thin and dense cloud ≤ 5 % each, snow ≤ 1 %, unknown ≤ 5 % | ≥ 90 % clear, field-mean NDVI 0.35–0.92 |
| Season window | Peak and trough of the field-median NDVI (Savitzky–Golay 91, `find_peaks` height 0.33) | Fixed April–August, calendar year |
| Dates per season | From the peak to the trough with median NDVI in [max(0.25, 0.3 × peak), peak]; one date per season after the consistency search | Top 4 by field mean, ≥ 10 days apart |
| Consistency | Branch-and-bound over date combinations; every pairwise Pearson > 0.545 (σ=2, border eroded 2 px); one of the last 2 seasons required; ≥ 2 seasons | None |
| Normalisation | Old algo: plain mean of raw NDVI. `oslalgo`: each year ÷ its P99, clipped to 1 | Each scene ÷ field mean, mean per season, mean over seasons |
| Border | Erode `disk(2)`, refill the ring from the interior when the interior is ≥ 50 % of the field | 10 m inner buffer, nearest fill |
| Smoothing | Median `disk(3)` + `gaussian(σ=5) × 0.5 × std` added back | NaN-aware Gaussian σ=1 |
| 3 zones | Per-scene terciles, then stable-pixel cores, SLIC + GrabCut refinement, fallbacks below 10 % low/high share | 1-D k-means, 2 % tails clipped |
| 5/7 zones | Equal-count percentile bins, odd counts only | k-means |
| Minimum area | Sieve 6 px (600 m²); fallback 1 % of the field | Sieve `max(4, min(30, px/40))` |
| Vectorise | `rasterio.shapes`, dissolve, clip, no simplification | Coverage-simplify 6 m, clip |

What we adopt is listed under slice 2.

**Suitability.** A CatBoost ensemble (`field_suitability_model.py`, models not exported) on 9 features: area,
low-zone share, minimum correlation, minimum windowed correlation, minimum tercile IoU (high and low), number of
dates, stability and soft stability. Suitable when the mean probability is > 0.5. The backend then applies:

- *not suitable* if the run failed or there are < 2 scenes;
- *suitable* if there are > 2 scenes and suitability > 0.4;
- otherwise *partially suitable*.

Status codes: `OK`, `PipelineFailed`, `SmallFieldProcessing`, `FieldUnsupported`, `NoSuitableAssetsFound`,
`NotEnoughDates`, `NotEnoughSeasons`, `FailedPredictMaps`. Only `PipelineFailed` is a failed run.

**Soil-cell quality.** The code (`stats.get_segment_quality_scores`) is missing from the export. See slice 6 for
the formula we use instead.

**Per-terminal Shapefile schemas.** Source: `backend-core/src/app/modules/fields/components/tractors_files.py`.
All terminals use the column map `{"rate": "RATE", "p": "P", "k": "K"}`, plus per-input columns of ≤ 6
characters (`inp{idx}` if unnamed).

| Terminal | Path in zip | `RATE` type |
|---|---|---|
| Amazone, Raven, Topcon, Ag Leader, Precision Planting 20\|20 | `{name}-{date}.*` at the root | Integer |
| John Deere | `Rx/{name}-{date}.*` | Real |
| Trimble | `AgGPS/Prescriptions/{name}-{date}.*` + copy under `AgData/Prescriptions/` | Integer |
| Hexagon | root | Real |
| None (generic) | root | Real(24, 2) if any value is fractional, else Integer |

Terminal detection on upload (adapt-service): John Deere `RCD`/`GRX` → GS2 2600, `RX` → GS3 2630, `JD-Data` → GS4,
`Command_Center`, `GS2_1800`; Trimble `AgData`/`AgGPS`; CNH `*.cn1`; Ag Leader `.agdata`/`.agsetup`; Precision
Planting `.dat`/`.2020`; ISO-XML `.xml`/`.bin`.

**GDD.** Not in the backend (weather was WorldWeatherOnline daily). The phenophase model uses
`cumsum(max(tavg, 0))`. We keep our own defaults: daily mean (Tmin + Tmax)/2, base 10 °C, cap 30 °C.

**Soil-sample padding** is in metres.

**Secrets.** Do not copy them; they should be rotated:

- `frontend/yield/src/config/*.json` in `AGVOLUTION/onesoil`: Mapbox, Firebase and Sentry keys in plain text.
- `web-scouting/.env` and `secret.json`, also in `AGVOLUTION/onesoil`.
- In the WorkDrive export:
  - `celery-tasks/src/app/config/base.py`;
  - `adapt-service/docker-production.yml` (AWS);
  - `backend-core/README.md` (DB replication password);
  - `precision_ag/core/machinery_data/interfaces.py` (DB password);
  - `omgdal/omgdal/data/onesoil-cloud-*.json` and `fertilizers-service/src/onesoil-cloud-key.json` (GCP service accounts);
  - `osl_core/config/default.py` (Sentry DSN);
  - `tile-info-api/src/app/api.py`;
  - several `.pypirc` files;
  - WWO and NASS API keys;
  - `backend/adapt/adapt/Plugins/v2/johndeere.adaptplugins.lic`.

## 8. Reference constants

Zone palettes (low → high): productivity `#F8D2FC #E5B5E9 #D499D7 #C27DC5 #A85BA8 #9D419C #8F1B8C`
(3 zones use stops 1/4/7, 5 use 1/3/4/5/7); index-date `#D0E3FC … #4392F1`; soil-result `#BEFFDA … #02B35D`;
undefined `#D1D1D6`. Soil sample quality `<0.85 #FF3A20`, `0.85–0.9 #FF953D`, `>0.9 #81D63C`.
Brush sizes 10/20/50/100/250/500/1000 m. Trial strips 1–2 per zone, 100 m default (1–1000), perpendicular.
Points per cell 3, padding 5 m, significance 0.2/0.5/0.8. Polling: progressive results 2 s ×1.2 to 5 s.
From the export:
- Productivity consistency threshold 0.545.
- Soil cell size 4 ha; soil quality plot thresholds 0.9/0.8.
- Trial-strip headland 50/70/100 m (< 20 ha / < 50 ha / larger).
- Yield raster 10–15 m with drop percentile 1–2 and hole fill < 40–50 px.
- Field stats min/max = P3/P97.
- NDVI palette V3 `960850 EE0200 FF771C FFBD38 FEFF03 BDF100 3FE10E 07B55E 0B8877`, invalid grey 212.
- ISO-XML DDIs 0001/0006/000B with factors ×10 000/×100/×0.1.
Palettes must still pass agmeo's palette validator before use (the purple zone ramp is sequential, single-hue).
