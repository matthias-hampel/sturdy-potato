-- Field management: field numbers, archiving with a date, merging, boundary reasons and
-- field groups (management tags).

-- The farm's own field number (Schlagnummer), next to the official identifier (FLIK).
ALTER TABLE fields ADD COLUMN IF NOT EXISTS parcel_number text;
-- Archived fields keep their history; archived_from is the first day the field is no longer
-- farmed. A merged field points at the field it became part of.
ALTER TABLE fields ADD COLUMN IF NOT EXISTS archived_from date;
ALTER TABLE fields ADD COLUMN IF NOT EXISTS merged_into_id uuid;
ALTER TABLE fields DROP CONSTRAINT IF EXISTS fields_merged_into_fk;
ALTER TABLE fields ADD CONSTRAINT fields_merged_into_fk
  FOREIGN KEY (organization_id, merged_into_id) REFERENCES fields (organization_id, id) ON DELETE SET NULL (merged_into_id);

-- Why a boundary changed, and where it came from.
ALTER TABLE field_geometry_versions ADD COLUMN IF NOT EXISTS reason text CHECK (length(reason) <= 500);
ALTER TABLE field_geometry_versions DROP CONSTRAINT IF EXISTS field_geometry_versions_source_check;
ALTER TABLE field_geometry_versions ADD CONSTRAINT field_geometry_versions_source_check
  CHECK (source IN ('drawn', 'import', 'edit', 'merge', 'restore'));
-- A merged-away field's last boundary is closed at the merge date.
GRANT UPDATE (valid_to) ON field_geometry_versions TO agmeo_app;

-- Field groups: freely named, coloured tags for grouping fields (management groups).
CREATE TABLE IF NOT EXISTS field_groups (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  color           text NOT NULL DEFAULT '#5c6b73' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS field_groups_name_idx ON field_groups (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS field_group_members (
  organization_id uuid NOT NULL,
  group_id        uuid NOT NULL,
  field_id        uuid NOT NULL,
  PRIMARY KEY (group_id, field_id),
  FOREIGN KEY (organization_id, group_id) REFERENCES field_groups (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS field_group_members_field_idx ON field_group_members (field_id);

ALTER TABLE field_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_groups_tenant ON field_groups;
CREATE POLICY field_groups_tenant ON field_groups FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS field_group_members_tenant ON field_group_members;
CREATE POLICY field_group_members_tenant ON field_group_members FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_groups, field_group_members TO agmeo_app;
