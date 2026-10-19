-- Yield maps: harvest-monitor exports per crop cycle, merged into one raster per harvest event.
--
-- A crop cycle has any number of sources (three combines in one afternoon is the normal case,
-- a multi-cut grassland has one event per cut). Sources arrive as uploaded files (ISO-XML
-- TASKDATA, AGRO-MAP .aft, point shapefiles, points.geojson); `provider` keeps room for
-- machine-cloud sources added later. The worker parses and cleans each source, merges the
-- sources of a harvest event on the field's 10 m UTM grid (the grid the satellite pipeline
-- uses), and stores the raster with its statistics in yield_rasters. Measured zone means per
-- productivity zoning go to yield_zone_yields. With the guards of the reference app, the map
-- mean fills an undocumented harvest (harvests.yield_raster_id marks those rows).
--
-- The build runs as agmeo_jobs. Besides its own tables it reads crop cycles, seasons, crops,
-- field boundaries and zonings, and writes harvests: each through a policy for that role below.

CREATE TABLE IF NOT EXISTS yield_map_sources (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL,
  crop_cycle_id         uuid NOT NULL,
  field_id              uuid NOT NULL,
  -- The uploaded file; the object key is copied so the worker never needs the files table.
  file_id               uuid,
  storage_key           text,
  file_name             text,
  provider              text NOT NULL DEFAULT 'upload' CHECK (provider IN ('upload', 'johndeere', 'claas', 'agco', 'nextfarming')),
  provider_operation_id text,
  kind                  text NOT NULL DEFAULT 'yield' CHECK (kind IN ('yield', 'as_applied')),
  machine_label         text,
  harvested_from        timestamptz,
  harvested_to          timestamptz,
  -- Filled by the parse.
  format                text,
  attribute             text,
  basis                 text CHECK (basis IN ('wet', 'dry')),
  crs                   text,
  point_count           integer,
  total_features        integer,
  mean_rate_t_ha        double precision,
  pixel_mean_t_ha       double precision,
  covered_ha            double precision,
  bbox                  double precision[],
  fingerprint           text,
  -- {quality, cleaning, sources, moisture} of the parse.
  quality               jsonb,
  included_in_merge     boolean NOT NULL DEFAULT true,
  excluded_reason       text CHECK (excluded_reason IN ('duplicate', 'user', 'implausible', 'no_overlap')),
  status                text NOT NULL DEFAULT 'pending_parse'
                        CHECK (status IN ('pending_download', 'pending_parse', 'ok', 'failed', 'skipped')),
  attempts              integer NOT NULL DEFAULT 0,
  error                 text,
  parsed_at             timestamptz,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id) REFERENCES files (organization_id, id) ON DELETE SET NULL (file_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS yield_map_sources_file_idx ON yield_map_sources (crop_cycle_id, file_id) WHERE file_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS yield_map_sources_provider_idx
  ON yield_map_sources (crop_cycle_id, provider, provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS yield_map_sources_cycle_idx ON yield_map_sources (organization_id, crop_cycle_id);
CREATE INDEX IF NOT EXISTS yield_map_sources_queue_idx ON yield_map_sources (created_at) WHERE status IN ('pending_download', 'pending_parse');
DROP TRIGGER IF EXISTS yield_map_sources_updated_at ON yield_map_sources;
CREATE TRIGGER yield_map_sources_updated_at BEFORE UPDATE ON yield_map_sources
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- One merged raster per harvest event; a rebuild supersedes the previous row.
CREATE TABLE IF NOT EXISTS yield_rasters (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL,
  crop_cycle_id            uuid NOT NULL,
  field_id                 uuid NOT NULL,
  harvest_event_key        text NOT NULL,
  event_from               timestamptz,
  event_to                 timestamptz,
  recipe_hash              text NOT NULL,
  boundary_hash            text NOT NULL,
  -- Grid: EPSG code (WGS 84 / UTM), top-left corner, square pixels in metres.
  grid_epsg                integer NOT NULL,
  grid_origin_x            double precision NOT NULL,
  grid_origin_y            double precision NOT NULL,
  grid_resolution          double precision NOT NULL,
  grid_width               integer NOT NULL CHECK (grid_width > 0),
  grid_height              integer NOT NULL CHECK (grid_height > 0),
  -- Row-major float32 little-endian rates [t/ha], NaN = no data.
  data                     bytea NOT NULL,
  unit                     text NOT NULL DEFAULT 't/ha',
  attribute                text,
  format                   text,
  basis                    text,
  target_moisture          double precision,
  mean_t_ha                double precision,
  median_t_ha              double precision,
  stddev_t_ha              double precision,
  min_t_ha                 double precision,
  max_t_ha                 double precision,
  q20_t_ha                 double precision,
  q80_t_ha                 double precision,
  p05_t_ha                 double precision,
  p95_t_ha                 double precision,
  valid_pixels             integer,
  covered_pixels           integer,
  filled_pixels            integer,
  area_ha                  double precision,
  harvested_ha             double precision,
  total_t                  double precision,
  field_coverage           double precision,
  total_calibration_factor double precision,
  histogram                jsonb,
  contributions            jsonb,
  cleaning                 jsonb,
  quality                  jsonb,
  status                   text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  superseded_at            timestamptz,
  built_at                 timestamptz NOT NULL DEFAULT now(),
  build_ms                 integer,
  -- Outcome of filling the documented yield: filled, or skipped with a reason.
  writeback_status         text CHECK (writeback_status IN ('filled', 'skipped')),
  writeback_reason         text,
  writeback_harvest_id     uuid,
  writeback_at             timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (crop_cycle_id, recipe_hash),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS yield_rasters_cycle_idx ON yield_rasters (organization_id, crop_cycle_id) WHERE superseded_at IS NULL;

-- Measured yield per zone of a zoning (productivity zones, or zones derived from a map).
CREATE TABLE IF NOT EXISTS yield_zone_yields (
  organization_id uuid NOT NULL,
  yield_raster_id uuid NOT NULL,
  zoning_id       uuid NOT NULL,
  zone_no         smallint NOT NULL,
  -- NULL when too little of the zone was measured.
  mean_t_ha       double precision,
  relative_yield  double precision,
  pixels          integer NOT NULL,
  PRIMARY KEY (yield_raster_id, zoning_id, zone_no),
  FOREIGN KEY (organization_id, yield_raster_id) REFERENCES yield_rasters (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, zoning_id) REFERENCES zonings (organization_id, id) ON DELETE CASCADE
);

-- Harvest rows whose quantity came from a yield map.
ALTER TABLE harvests ADD COLUMN IF NOT EXISTS yield_raster_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'harvests_yield_raster_fkey') THEN
    ALTER TABLE harvests ADD CONSTRAINT harvests_yield_raster_fkey
      FOREIGN KEY (yield_raster_id) REFERENCES yield_rasters (id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Zonings derived from a measured yield map or a satellite yield estimate, next to the
-- productivity zonings; variable-rate maps can use them like any other zoning.
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS crop_cycle_id uuid;
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS yield_raster_id uuid;
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS params jsonb;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_source_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_source_check CHECK (source IN ('productivity', 'yield_map', 'yield_estimate'));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonings_crop_cycle_fkey') THEN
    ALTER TABLE zonings ADD CONSTRAINT zonings_crop_cycle_fkey
      FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonings_yield_raster_fkey') THEN
    ALTER TABLE zonings ADD CONSTRAINT zonings_yield_raster_fkey FOREIGN KEY (yield_raster_id) REFERENCES yield_rasters (id) ON DELETE SET NULL;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS zonings_crop_cycle_idx ON zonings (crop_cycle_id) WHERE crop_cycle_id IS NOT NULL;
-- Mean yield of a yield zone [t/ha].
ALTER TABLE zoning_zones ADD COLUMN IF NOT EXISTS mean_yield_t_ha numeric(8, 2);

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE yield_map_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE yield_rasters ENABLE ROW LEVEL SECURITY;
ALTER TABLE yield_zone_yields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yield_map_sources_tenant ON yield_map_sources;
CREATE POLICY yield_map_sources_tenant ON yield_map_sources FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS yield_rasters_tenant ON yield_rasters;
CREATE POLICY yield_rasters_tenant ON yield_rasters FOR SELECT USING (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS yield_zone_yields_tenant ON yield_zone_yields;
CREATE POLICY yield_zone_yields_tenant ON yield_zone_yields FOR SELECT USING (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, DELETE ON yield_map_sources TO agmeo_app;
-- The user may include/exclude a source and re-queue it; everything else is written by the worker.
GRANT UPDATE (included_in_merge, excluded_reason, status, attempts, error, harvested_from, harvested_to, machine_label)
  ON yield_map_sources TO agmeo_app;
GRANT SELECT ON yield_rasters, yield_zone_yields TO agmeo_app;

-- The API saves and deletes yield zonings (estimate or measured map) of the organization.
DROP POLICY IF EXISTS zonings_yield_write ON zonings;
CREATE POLICY zonings_yield_write ON zonings FOR INSERT TO agmeo_app
  WITH CHECK (organization_id = (SELECT app.org_id()) AND source IN ('yield_map', 'yield_estimate'));
DROP POLICY IF EXISTS zonings_yield_delete ON zonings;
CREATE POLICY zonings_yield_delete ON zonings FOR DELETE TO agmeo_app
  USING (organization_id = (SELECT app.org_id()) AND source IN ('yield_map', 'yield_estimate'));
DROP POLICY IF EXISTS zoning_zones_yield_write ON zoning_zones;
CREATE POLICY zoning_zones_yield_write ON zoning_zones FOR INSERT TO agmeo_app
  WITH CHECK (organization_id = (SELECT app.org_id())
              AND zoning_id IN (SELECT id FROM zonings WHERE source IN ('yield_map', 'yield_estimate')));
GRANT INSERT, DELETE ON zonings TO agmeo_app;
GRANT INSERT ON zoning_zones TO agmeo_app;

-- Worker (agmeo_jobs): its own tables in full …
DROP POLICY IF EXISTS yield_map_sources_jobs ON yield_map_sources;
CREATE POLICY yield_map_sources_jobs ON yield_map_sources FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS yield_rasters_jobs ON yield_rasters;
CREATE POLICY yield_rasters_jobs ON yield_rasters FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS yield_zone_yields_jobs ON yield_zone_yields;
CREATE POLICY yield_zone_yields_jobs ON yield_zone_yields FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON yield_map_sources, yield_rasters, yield_zone_yields TO agmeo_jobs;

-- … read access to what a build needs: the crop cycle, its season and crop, the boundary
-- (field or field part) and the productivity zonings of the field …
GRANT SELECT (id, organization_id, field_id, field_part_id, season_id, crop_id, area_ha, role, status)
  ON crop_cycles TO agmeo_jobs;
GRANT SELECT (id, organization_id, harvest_year) ON growing_seasons TO agmeo_jobs;
GRANT SELECT (id, organization_id, code, name, name_de, category) ON crops TO agmeo_jobs;
GRANT SELECT (id, organization_id, field_id, geometry, geometry_version_id, area_ha) ON field_parts TO agmeo_jobs;
GRANT SELECT ON field_geometry_versions, field_current_geometry TO agmeo_jobs;
GRANT SELECT ON zonings, zoning_zones TO agmeo_jobs;
DROP POLICY IF EXISTS crop_cycles_jobs_read ON crop_cycles;
CREATE POLICY crop_cycles_jobs_read ON crop_cycles FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS growing_seasons_jobs_read ON growing_seasons;
CREATE POLICY growing_seasons_jobs_read ON growing_seasons FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS crops_jobs_read ON crops;
CREATE POLICY crops_jobs_read ON crops FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS field_parts_jobs_read ON field_parts;
CREATE POLICY field_parts_jobs_read ON field_parts FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS field_geometry_versions_jobs_read ON field_geometry_versions;
CREATE POLICY field_geometry_versions_jobs_read ON field_geometry_versions FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS zonings_jobs_read ON zonings;
CREATE POLICY zonings_jobs_read ON zonings FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS zoning_zones_jobs_read ON zoning_zones;
CREATE POLICY zoning_zones_jobs_read ON zoning_zones FOR SELECT TO agmeo_jobs USING (true);

-- … and the harvests of a crop cycle, to fill an undocumented yield from the map.
GRANT SELECT (id, organization_id, crop_cycle_id, harvest_date, harvested_area_ha, quantity_t, yield_raster_id) ON harvests TO agmeo_jobs;
GRANT INSERT (organization_id, crop_cycle_id, harvest_date, harvested_area_ha, quantity_t, moisture_pct, notes, yield_raster_id) ON harvests TO agmeo_jobs;
GRANT UPDATE (quantity_t, yield_raster_id, notes) ON harvests TO agmeo_jobs;
DROP POLICY IF EXISTS harvests_jobs_yield ON harvests;
CREATE POLICY harvests_jobs_yield ON harvests FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
