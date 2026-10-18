-- Part fields (Teilschläge): a field divided for one season, e.g. a flower strip (Blühstreifen),
-- fallow (Brache) or an area leased out. The parts of a field and season do not overlap and
-- together cover its boundary; one of them may be the remainder (what the drawn parts leave).
-- A field without parts in a season is used as a whole, as before.

CREATE TABLE field_parts (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  field_id            uuid NOT NULL,
  season_id           uuid NOT NULL,
  name                text NOT NULL CHECK (length(trim(name)) > 0),
  usage               text NOT NULL DEFAULT 'cropped' CHECK (usage IN (
                        'cropped', 'fallow', 'flower_strip', 'buffer_strip', 'landscape_element', 'leased_out', 'other')),
  is_remainder        boolean NOT NULL DEFAULT false,
  geometry            geometry(MultiPolygon, 4326) NOT NULL,
  area_ha             numeric(14, 4) NOT NULL CHECK (area_ha > 0),
  -- Field boundary the part was cut from; a later boundary change makes the split outdated.
  geometry_version_id uuid NOT NULL,
  sort_order          smallint NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  -- Targets of the composite foreign keys that keep crops and operations on their own field and season.
  UNIQUE (organization_id, field_id, id),
  UNIQUE (organization_id, field_id, season_id, id),
  -- Deferred so that a re-split may swap names between parts.
  CONSTRAINT field_parts_name_key UNIQUE (field_id, season_id, name) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, season_id) REFERENCES growing_seasons (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id),
  CHECK (ST_IsValid(geometry))
);
CREATE UNIQUE INDEX field_parts_remainder_idx ON field_parts (field_id, season_id) WHERE is_remainder;
CREATE INDEX field_parts_season_idx ON field_parts (organization_id, season_id, field_id);
CREATE INDEX field_parts_geom_idx ON field_parts USING gist (geometry);
CREATE TRIGGER field_parts_updated_at BEFORE UPDATE ON field_parts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A crop grown on a part; NULL means the whole field (fields without parts in that season).
ALTER TABLE crop_cycles ADD COLUMN field_part_id uuid;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_field_part_fkey
  FOREIGN KEY (organization_id, field_id, season_id, field_part_id) REFERENCES field_parts (organization_id, field_id, season_id, id);
CREATE INDEX crop_cycles_part_idx ON crop_cycles (field_part_id) WHERE field_part_id IS NOT NULL;

-- Operations may be recorded per part, so a field can appear once per part.
ALTER TABLE operation_fields ADD COLUMN field_part_id uuid;
ALTER TABLE operation_fields ADD CONSTRAINT operation_fields_field_part_fkey
  FOREIGN KEY (organization_id, field_id, field_part_id) REFERENCES field_parts (organization_id, field_id, id);
ALTER TABLE operation_fields DROP CONSTRAINT operation_fields_operation_id_field_id_key;
CREATE UNIQUE INDEX operation_fields_line_idx ON operation_fields (operation_id, field_id, field_part_id) NULLS NOT DISTINCT;
CREATE INDEX operation_fields_part_idx ON operation_fields (field_part_id) WHERE field_part_id IS NOT NULL;

ALTER TABLE cost_entries ADD COLUMN field_part_id uuid;
ALTER TABLE cost_entries ADD CONSTRAINT cost_entries_field_part_fkey
  FOREIGN KEY (organization_id, field_part_id) REFERENCES field_parts (organization_id, id);
DROP INDEX cost_entries_once_idx;
CREATE UNIQUE INDEX cost_entries_once_idx ON cost_entries (operation_id, completion_seq, source, field_id, field_part_id, category)
  NULLS NOT DISTINCT WHERE operation_id IS NOT NULL;

ALTER TABLE field_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY field_parts_tenant ON field_parts FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_parts TO agmeo_app;
