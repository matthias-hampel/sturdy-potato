-- Work planning and satellite crop monitoring (ADR-006).

CREATE TABLE tasks (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL,
  farm_id              uuid NOT NULL,
  field_id             uuid,
  -- Set when the task plans field work; completing the work completes the operation.
  operation_id         uuid,
  title                text NOT NULL CHECK (length(trim(title)) > 0),
  description          text,
  assignee_employee_id uuid,
  due_on               date,
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
  completed_at         timestamptz,
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE SET NULL (field_id),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE SET NULL (operation_id),
  FOREIGN KEY (organization_id, assignee_employee_id) REFERENCES employees (organization_id, id) ON DELETE SET NULL (assignee_employee_id)
);
CREATE INDEX tasks_org_idx ON tasks (organization_id, status, due_on);
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Source scenes are shared reference data: the same Sentinel-2 acquisition is reused by
-- every tenant whose fields it covers. Written by the geospatial worker only.
CREATE TABLE satellite_scenes (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  scene_id           text NOT NULL UNIQUE,
  platform           text NOT NULL,
  product_level      text NOT NULL DEFAULT 'L2A',
  acquired_at        timestamptz NOT NULL,
  cloud_cover_pct    numeric(5, 2),
  footprint          geometry(MultiPolygon, 4326),
  processing_version text NOT NULL,
  asset_refs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX satellite_scenes_footprint_idx ON satellite_scenes USING gist (footprint);
CREATE INDEX satellite_scenes_acquired_idx ON satellite_scenes (acquired_at DESC);

-- Tenant-private zonal statistics of a vegetation index over a field boundary.
CREATE TABLE field_observations (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid,
  scene_id            uuid REFERENCES satellite_scenes(id) ON DELETE CASCADE,
  observed_on         date NOT NULL,
  index_type          text NOT NULL CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'ndwi', 'evi', 'savi')),
  mean                numeric(6, 4),
  median              numeric(6, 4),
  p10                 numeric(6, 4),
  p90                 numeric(6, 4),
  stddev              numeric(6, 4),
  valid_pixel_pct     numeric(5, 2) NOT NULL,
  -- Observations below the coverage threshold are kept but must not be shown as reliable.
  status              text NOT NULL CHECK (status IN ('valid', 'insufficient_coverage')),
  source              text NOT NULL DEFAULT 'sentinel-2',
  processing_version  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  UNIQUE NULLS NOT DISTINCT (field_id, scene_id, index_type, processing_version)
);
CREATE INDEX field_observations_field_idx ON field_observations (organization_id, field_id, index_type, observed_on);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_tenant ON tasks FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY satellite_scenes_read ON satellite_scenes FOR SELECT USING (true);
CREATE POLICY field_observations_tenant ON field_observations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO agmeo_app;
GRANT SELECT ON satellite_scenes, field_observations TO agmeo_app;
