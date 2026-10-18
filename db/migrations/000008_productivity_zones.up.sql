-- Productivity zones.
--
-- A productivity analysis combines several seasons of clear NDVI field rasters of one field
-- boundary into a relative productivity map (1 = field mean) and a stability score. It is
-- classified into zonings of 3, 5 and 7 zones that later feed variable-rate maps and soil
-- sampling. Analyses are requested by the API (or automatically after the imagery history
-- of a boundary is loaded) and computed by the geospatial worker.

CREATE TABLE productivity_analyses (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid NOT NULL,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'finished', 'failed')),
  -- Why an analysis has no zones: not_enough_scenes, not_enough_seasons, no_imagery, error.
  status_code         text,
  -- Mean correlation of each season's pattern with the other seasons (0..1).
  suitability         numeric(4, 3) CHECK (suitability BETWEEN 0 AND 1),
  suitability_status  text CHECK (suitability_status IN ('suitable', 'partially_suitable', 'not_suitable')),
  season_count        integer,
  scene_count         integer,
  -- Candidate acquisitions: [{"sceneId", "date", "season", "ndviMean", "used"}].
  scenes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Acquisitions the user excluded from the analysis.
  excluded_scene_ids  uuid[] NOT NULL DEFAULT '{}',
  raster_path         text,
  algo_version        text,
  error               text,
  requested_by        uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  UNIQUE (organization_id, id)
);
CREATE INDEX productivity_analyses_field_idx ON productivity_analyses (field_id, created_at DESC);
CREATE INDEX productivity_analyses_queue_idx ON productivity_analyses (status, created_at) WHERE status = 'queued';
CREATE TRIGGER productivity_analyses_updated_at BEFORE UPDATE ON productivity_analyses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE zonings (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid NOT NULL,
  analysis_id         uuid,
  source              text NOT NULL CHECK (source IN ('productivity')),
  zone_count          smallint NOT NULL CHECK (zone_count BETWEEN 2 AND 7),
  is_custom           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  FOREIGN KEY (organization_id, analysis_id) REFERENCES productivity_analyses (organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);
CREATE INDEX zonings_analysis_idx ON zonings (analysis_id, zone_count);

-- Zone 1 is the least productive. Zones tile the field boundary.
CREATE TABLE zoning_zones (
  organization_id       uuid NOT NULL,
  zoning_id             uuid NOT NULL,
  zone_no               smallint NOT NULL CHECK (zone_no BETWEEN 1 AND 7),
  geometry              geometry(MultiPolygon, 4326) NOT NULL,
  area_ha               numeric(10, 4) NOT NULL,
  -- Mean relative productivity in the zone, % of the field mean.
  relative_productivity numeric(6, 2),
  PRIMARY KEY (zoning_id, zone_no),
  FOREIGN KEY (organization_id, zoning_id) REFERENCES zonings (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE productivity_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonings ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoning_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY productivity_analyses_tenant ON productivity_analyses FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY zonings_tenant ON zonings FOR SELECT USING (organization_id = (SELECT app.org_id()));
CREATE POLICY zoning_zones_tenant ON zoning_zones FOR SELECT USING (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT ON productivity_analyses TO agmeo_app;
-- Only the exclusions of a still-queued analysis can be changed by the API.
GRANT UPDATE (excluded_scene_ids) ON productivity_analyses TO agmeo_app;
GRANT SELECT ON zonings, zoning_zones TO agmeo_app;

CREATE POLICY productivity_analyses_geo ON productivity_analyses FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
CREATE POLICY zonings_geo ON zonings FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
CREATE POLICY zoning_zones_geo ON zoning_zones FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON productivity_analyses, zonings, zoning_zones TO agmeo_geo;
