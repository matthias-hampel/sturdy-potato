-- Soil sampling zonations (ported from AGVOLUTION/agmeo: SoilSamplingZonations / SoilSamplingZones).
--
-- A zonation divides a field into sampling zones; each zone is sampled as one composite probe
-- (probe number stamped on the lab's sample card, sample point where the sampler starts).
-- Zonations come from satellite rasters (computed by agmeo-geo: fcm, kmeans, segment, probe,
-- probe-v2), from a regular grid or Voronoi cells (computed by the API), from productivity zones,
-- or from the zone editor (manual). A field has at most one active zonation (status 'ready',
-- not superseded); older ones stay as history and can be restored. A run queued for the worker
-- replaces the active zonation only when it finishes.

CREATE TABLE IF NOT EXISTS soil_zonations (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid,
  method              text NOT NULL CHECK (method IN ('fcm', 'kmeans', 'segment', 'probe', 'probe-v2', 'grid', 'voronoi', 'zoning', 'manual', 'upload')),
  -- Layer the zones were cut from (ndvi/ndre/ndmi/productivity), or the geometric plan.
  source              text NOT NULL CHECK (source IN ('ndvi', 'ndre', 'ndmi', 'productivity', 'grid', 'voronoi', 'zoning', 'manual', 'upload')),
  -- zoneCount ('auto' or n), minZoneHa, coarseness, cleanup, sceneDate, cellHa, axis, …
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  zone_count          smallint,
  status              text NOT NULL DEFAULT 'ready' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  -- Why a run has no zones: no_imagery, no_productivity, no_values, no_zones, error.
  status_code         text,
  error               text,
  -- Acquisition of the satellite layer.
  scene_date          date,
  batch_id            uuid,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  superseded_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS soil_zonations_active_idx ON soil_zonations (field_id) WHERE status = 'ready' AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS soil_zonations_field_idx ON soil_zonations (organization_id, field_id, created_at DESC);
CREATE INDEX IF NOT EXISTS soil_zonations_queue_idx ON soil_zonations (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS soil_zonations_batch_idx ON soil_zonations (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS soil_zones (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL,
  zonation_id      uuid NOT NULL,
  -- Order of the zone; for satellite zones 1 = lowest layer value.
  zone_no          smallint NOT NULL CHECK (zone_no >= 1),
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  color            text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  geometry         geometry(MultiPolygon, 4326) NOT NULL,
  area_ha          numeric(10, 4) NOT NULL,
  -- Probe number on the sample card; the lab echoes it back with the results.
  probe_nr         integer CHECK (probe_nr > 0),
  -- Mean of the source layer in the zone (satellite zonations).
  mean_value       double precision,
  -- Where the sampler starts (point on surface, grid cell point or Voronoi generator).
  sample_point     geometry(Point, 4326),
  -- Measured values by parameter (ph, p2o5, k2o, mgo, humus, …) in canonical units, with the
  -- lab's method and sampling date per parameter and the lab's extras (supply classes, lime need).
  properties       jsonb NOT NULL DEFAULT '{}'::jsonb,
  property_methods jsonb NOT NULL DEFAULT '{}'::jsonb,
  property_dates   jsonb NOT NULL DEFAULT '{}'::jsonb,
  lab_extras       jsonb,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, zonation_id) REFERENCES soil_zonations (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS soil_zones_zonation_idx ON soil_zones (zonation_id, zone_no);
CREATE INDEX IF NOT EXISTS soil_zones_probe_idx ON soil_zones (organization_id, probe_nr) WHERE probe_nr IS NOT NULL;

ALTER TABLE soil_zonations ENABLE ROW LEVEL SECURITY;
ALTER TABLE soil_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_zonations_tenant ON soil_zonations;
CREATE POLICY soil_zonations_tenant ON soil_zonations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS soil_zones_tenant ON soil_zones;
CREATE POLICY soil_zones_tenant ON soil_zones FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON soil_zonations, soil_zones TO agmeo_app;

-- The geospatial worker computes queued satellite zonations.
DROP POLICY IF EXISTS soil_zonations_geo ON soil_zonations;
CREATE POLICY soil_zonations_geo ON soil_zonations FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS soil_zones_geo ON soil_zones;
CREATE POLICY soil_zones_geo ON soil_zones FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON soil_zonations TO agmeo_geo;
GRANT SELECT, INSERT, DELETE ON soil_zones TO agmeo_geo;
