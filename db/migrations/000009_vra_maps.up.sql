-- Variable-rate application (VRA) maps.
--
-- A VRA map assigns an application rate to every zone of a zoning (for now: productivity
-- zones) of one field boundary. A map has one input (sowing, fertilizing, spraying) or several
-- inputs applied in one pass, each exported as its own attribute column. Rates are stored per
-- hectare; the unit system of a map only affects display and export. Maps are written by the
-- API only.

CREATE TABLE vra_maps (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  geometry_version_id uuid NOT NULL,
  -- Zonings of a finished analysis are kept; the worker only replaces the zonings of an
  -- analysis it recomputes, which never happens to one a map was made from.
  zoning_id           uuid NOT NULL,
  type                text NOT NULL CHECK (type IN ('sowing', 'fertilizing', 'spraying', 'several')),
  title               text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  unit_system         text NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric', 'imperial')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_by          uuid REFERENCES users(id),
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  FOREIGN KEY (organization_id, zoning_id) REFERENCES zonings (organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);
CREATE INDEX vra_maps_field_idx ON vra_maps (field_id, created_at DESC);
CREATE INDEX vra_maps_zoning_idx ON vra_maps (zoning_id);
CREATE TRIGGER vra_maps_updated_at BEFORE UPDATE ON vra_maps
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE vra_map_inputs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  vra_map_id      uuid NOT NULL,
  position        smallint NOT NULL CHECK (position >= 0),
  input_type      text NOT NULL CHECK (input_type IN ('sowing', 'fertilizing', 'spraying')),
  -- Optional link to the inventory, for planned operations and costs.
  product_id      uuid,
  crop_id         uuid REFERENCES crops(id),
  name            text NOT NULL DEFAULT '',
  unit            text NOT NULL CHECK (unit IN ('seeds/ha', 'kg/ha', 'l/ha')),
  standard_rate   numeric(14, 4) CHECK (standard_rate >= 0),
  -- Attribute column in exported Shapefiles (DBF names are short; terminals truncate further).
  column_name     text NOT NULL CHECK (column_name ~ '^[A-Z0-9]{1,6}$'),
  -- Rate per hectare by zone number: {"1": 140, "2": 160, ...}.
  rates           jsonb NOT NULL CHECK (jsonb_typeof(rates) = 'object'),
  FOREIGN KEY (organization_id, vra_map_id) REFERENCES vra_maps (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE SET NULL (product_id),
  UNIQUE (vra_map_id, position),
  UNIQUE (vra_map_id, column_name)
);
CREATE INDEX vra_map_inputs_product_idx ON vra_map_inputs (product_id) WHERE product_id IS NOT NULL;

ALTER TABLE vra_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE vra_map_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY vra_maps_tenant ON vra_maps FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY vra_map_inputs_tenant ON vra_map_inputs FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON vra_maps, vra_map_inputs TO agmeo_app;
