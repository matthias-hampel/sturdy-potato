DROP TABLE IF EXISTS field_group_members;
DROP TABLE IF EXISTS field_groups;
ALTER TABLE field_geometry_versions DROP CONSTRAINT IF EXISTS field_geometry_versions_source_check;
ALTER TABLE field_geometry_versions ADD CONSTRAINT field_geometry_versions_source_check CHECK (source IN ('drawn', 'import', 'edit'));
ALTER TABLE field_geometry_versions DROP COLUMN IF EXISTS reason;
ALTER TABLE fields DROP CONSTRAINT IF EXISTS fields_merged_into_fk;
ALTER TABLE fields DROP COLUMN IF EXISTS merged_into_id, DROP COLUMN IF EXISTS archived_from, DROP COLUMN IF EXISTS parcel_number;
