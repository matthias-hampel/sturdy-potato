-- Imagery history per field.
--
-- Besides the local sentinel-archive, the geospatial worker reads Sentinel-2 L2A acquisitions
-- per field from cloud-hosted COGs (Earth Search, collection sentinel-2-c1-l2a), reading only
-- the field's window. For every field boundary and acquisition it stores a small index raster
-- on the field's own 10 m grid ("field raster"); map tiles and the productivity analysis are
-- built from those, whichever source the acquisition came from.

ALTER TABLE satellite_scenes
  ADD COLUMN source text NOT NULL DEFAULT 'archive' CHECK (source IN ('archive', 'earth-search'));
COMMENT ON COLUMN satellite_scenes.asset_refs IS
  'archive: {"dir", "product_id", "assets": {index: {"path", "band", "resolution_m"}}}; '
  'earth-search: {"collection", "item", "epsg", "assets": {band: {"href", "scale", "offset"}}}';

CREATE TABLE field_rasters (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid NOT NULL,
  scene_id            uuid NOT NULL REFERENCES satellite_scenes(id) ON DELETE CASCADE,
  observed_on         date NOT NULL,
  -- Clear (unmasked) share of the field's analysis area, as in field_observations.
  valid_pixel_pct     numeric(5, 2) NOT NULL,
  -- GeoTIFF relative to the geo worker's data directory; bands in the order of `bands`.
  path                text NOT NULL,
  bands               text[] NOT NULL,
  -- True-colour companion raster (<path without .tif>.rgb.tif).
  has_rgb             boolean NOT NULL DEFAULT false,
  processing_version  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  UNIQUE (geometry_version_id, scene_id)
);
CREATE INDEX field_rasters_date_idx ON field_rasters (organization_id, observed_on, field_id);
CREATE INDEX field_rasters_field_idx ON field_rasters (field_id, observed_on);

-- Backfill of the imagery history of one field boundary, with progress for the UI.
CREATE TABLE field_imagery_jobs (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'finished', 'failed')),
  date_from           date NOT NULL,
  -- Acquisitions up to this date have been processed; later runs only look for newer ones.
  covered_until       date,
  scenes_total        integer NOT NULL DEFAULT 0,
  scenes_done         integer NOT NULL DEFAULT 0,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id)
);
CREATE INDEX field_imagery_jobs_status_idx ON field_imagery_jobs (status, created_at);
CREATE TRIGGER field_imagery_jobs_updated_at BEFORE UPDATE ON field_imagery_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE field_rasters ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_imagery_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_rasters_tenant ON field_rasters FOR SELECT
  USING (organization_id = (SELECT app.org_id()));
CREATE POLICY field_imagery_jobs_tenant ON field_imagery_jobs FOR SELECT
  USING (organization_id = (SELECT app.org_id()));
GRANT SELECT ON field_rasters, field_imagery_jobs TO agmeo_app;

CREATE POLICY field_rasters_geo_write ON field_rasters FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
CREATE POLICY field_imagery_jobs_geo_write ON field_imagery_jobs FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON field_rasters, field_imagery_jobs TO agmeo_geo;
