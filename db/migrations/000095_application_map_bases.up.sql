-- Base zonations for variable-rate application maps (ported from AGVOLUTION/agmeo:
-- CultivationBaseZones, ApplicationMaps, the application-maps page and bulk setup).
--
-- A VRA map spreads rates over the zones of a zoning. Besides the productivity zonings of the
-- geospatial worker and the yield zonings, a field now has zonings made for application maps:
--   soil       copied from the field's active soil zonation
--   upload     read from an uploaded zone file (GeoJSON, Shapefile ZIP, ISO-XML grid)
--   satellite  one or more scenes of a vegetation index classified into zones (worker job below)
--   manual     zones edited with the brush editor (from any other zoning)
--   uniform    one zone over the whole field (flat rate)
-- Zonings carry a name, at most one default per field ("Favorit"), and whether they are listed
-- as a base for new maps (zones edited for one map only are not). Zone counts grow to 50 so an
-- uploaded map with many rates fits.

ALTER TABLE zonings ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT true;
ALTER TABLE zonings ADD COLUMN IF NOT EXISTS created_by uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonings_created_by_fkey') THEN
    ALTER TABLE zonings ADD CONSTRAINT zonings_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonings_name_check') THEN
    ALTER TABLE zonings ADD CONSTRAINT zonings_name_check CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 120);
  END IF;
END
$$;

ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_source_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_source_check
  CHECK (source IN ('productivity', 'yield_map', 'yield_estimate', 'soil', 'upload', 'satellite', 'manual', 'uniform'));
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_zone_count_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_zone_count_check CHECK (zone_count BETWEEN 1 AND 50);
ALTER TABLE zoning_zones DROP CONSTRAINT IF EXISTS zoning_zones_zone_no_check;
ALTER TABLE zoning_zones ADD CONSTRAINT zoning_zones_zone_no_check CHECK (zone_no BETWEEN 1 AND 50);

CREATE UNIQUE INDEX IF NOT EXISTS zonings_default_idx ON zonings (field_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS zonings_field_idx ON zonings (field_id, created_at DESC);

-- The API writes and deletes the application-map zonings of the organization; name, default
-- and listing can be changed on any zoning of the organization.
DROP POLICY IF EXISTS zonings_base_write ON zonings;
CREATE POLICY zonings_base_write ON zonings FOR INSERT TO agmeo_app
  WITH CHECK (organization_id = (SELECT app.org_id()) AND source IN ('soil', 'upload', 'satellite', 'manual', 'uniform'));
DROP POLICY IF EXISTS zonings_base_delete ON zonings;
CREATE POLICY zonings_base_delete ON zonings FOR DELETE TO agmeo_app
  USING (organization_id = (SELECT app.org_id()) AND source IN ('soil', 'upload', 'satellite', 'manual', 'uniform'));
DROP POLICY IF EXISTS zonings_base_update ON zonings;
CREATE POLICY zonings_base_update ON zonings FOR UPDATE TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS zoning_zones_base_write ON zoning_zones;
CREATE POLICY zoning_zones_base_write ON zoning_zones FOR INSERT TO agmeo_app
  WITH CHECK (organization_id = (SELECT app.org_id())
              AND zoning_id IN (SELECT id FROM zonings WHERE source IN ('soil', 'upload', 'satellite', 'manual', 'uniform')));
GRANT INSERT, DELETE ON zonings TO agmeo_app;
GRANT UPDATE (name, is_default, listed) ON zonings TO agmeo_app;
GRANT INSERT ON zoning_zones TO agmeo_app;

-- Satellite zonings are computed by the geospatial worker: the API queues a job, the worker
-- classifies the scene (or the pixel-wise median of up to five scenes) of the field's current
-- boundary and writes the zoning it links back here.
CREATE TABLE IF NOT EXISTS zoning_jobs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  source          text NOT NULL DEFAULT 'satellite' CHECK (source IN ('satellite')),
  index_type      text NOT NULL CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'evi', 'bsi', 'ndti')),
  scene_dates     date[] NOT NULL CHECK (cardinality(scene_dates) BETWEEN 1 AND 5),
  zone_count      smallint NOT NULL CHECK (zone_count BETWEEN 2 AND 10),
  -- method (fcm/kmeans/segment), coarseness, minZoneHa, cleanup.
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  name            text CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 120),
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  -- Why a job has no zoning: no_imagery, no_values, no_zones, grid_mismatch, error.
  status_code     text,
  error           text,
  zoning_id       uuid,
  batch_id        uuid,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, zoning_id) REFERENCES zonings (organization_id, id) ON DELETE SET NULL (zoning_id)
);
CREATE INDEX IF NOT EXISTS zoning_jobs_field_idx ON zoning_jobs (organization_id, field_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zoning_jobs_queue_idx ON zoning_jobs (created_at) WHERE status = 'queued';

ALTER TABLE zoning_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zoning_jobs_tenant ON zoning_jobs;
CREATE POLICY zoning_jobs_tenant ON zoning_jobs FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, DELETE ON zoning_jobs TO agmeo_app;
DROP POLICY IF EXISTS zoning_jobs_geo ON zoning_jobs;
CREATE POLICY zoning_jobs_geo ON zoning_jobs FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON zoning_jobs TO agmeo_geo;

-- Maps made together in the bulk setup share a batch; sowing inputs may hold a target stand
-- (plants/ha) that the export turns into seeds through the germination rate; the rate strategy
-- of an input is kept for the editor.
ALTER TABLE vra_maps ADD COLUMN IF NOT EXISTS batch_id uuid;
CREATE INDEX IF NOT EXISTS vra_maps_org_idx ON vra_maps (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vra_maps_batch_idx ON vra_maps (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE vra_map_inputs ADD COLUMN IF NOT EXISTS germination_pct numeric(5, 2);
ALTER TABLE vra_map_inputs ADD COLUMN IF NOT EXISTS strategy text;
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_germination_pct_check;
ALTER TABLE vra_map_inputs ADD CONSTRAINT vra_map_inputs_germination_pct_check CHECK (germination_pct IS NULL OR (germination_pct > 0 AND germination_pct <= 100));
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_strategy_check;
ALTER TABLE vra_map_inputs ADD CONSTRAINT vra_map_inputs_strategy_check CHECK (strategy IS NULL OR strategy IN ('proportional', 'inverse', 'manual'));
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_unit_check;
ALTER TABLE vra_map_inputs ADD CONSTRAINT vra_map_inputs_unit_check CHECK (unit IN ('seeds/ha', 'plants/ha', 'kg/ha', 'l/ha'));
