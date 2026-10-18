-- Farms, fields and versioned field boundaries (ADR-003).

CREATE TABLE farms (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  address         text,
  country         char(2) NOT NULL DEFAULT 'DE',
  timezone        text NOT NULL DEFAULT 'Europe/Berlin',
  location        geometry(Point, 4326),
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX farms_org_idx ON farms (organization_id);
CREATE TRIGGER farms_updated_at BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE fields (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  farm_id         uuid NOT NULL,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  -- Official parcel identifier, e.g. the FLIK in Niedersachsen, or the farm's own number.
  identifier      text,
  tenure          text NOT NULL DEFAULT 'owned' CHECK (tenure IN ('owned', 'leased', 'other')),
  soil_type       text,
  notes           text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX fields_farm_idx ON fields (organization_id, farm_id);
CREATE TRIGGER fields_updated_at BEFORE UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A field's boundary over time. Exactly one open-ended version is current; periods of a
-- single field never overlap, so historical operations can be tied to the right shape.
CREATE TABLE field_geometry_versions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  geometry        geometry(MultiPolygon, 4326) NOT NULL,
  area_ha         numeric(14, 4) NOT NULL,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  source          text NOT NULL DEFAULT 'drawn' CHECK (source IN ('drawn', 'import', 'edit')),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  CHECK (ST_IsValid(geometry)),
  CHECK (area_ha > 0),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (field_id WITH =, tstzrange(valid_from, valid_to) WITH &&)
);
CREATE INDEX field_geometry_versions_geom_idx ON field_geometry_versions USING gist (geometry);
CREATE INDEX field_geometry_versions_current_idx ON field_geometry_versions (field_id) WHERE valid_to IS NULL;

CREATE VIEW field_current_geometry WITH (security_invoker = true) AS
  SELECT DISTINCT ON (field_id) id, organization_id, field_id, geometry, area_ha, valid_from
  FROM field_geometry_versions
  WHERE valid_to IS NULL
  ORDER BY field_id, valid_from DESC;

ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_geometry_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY farms_tenant ON farms FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY fields_tenant ON fields FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY field_geometry_versions_tenant ON field_geometry_versions FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON farms, fields TO agmeo_app;
-- Geometry versions are only ever closed (valid_to) and appended, never rewritten.
GRANT SELECT, INSERT ON field_geometry_versions TO agmeo_app;
GRANT UPDATE (valid_to) ON field_geometry_versions TO agmeo_app;
GRANT SELECT ON field_current_geometry TO agmeo_app;
