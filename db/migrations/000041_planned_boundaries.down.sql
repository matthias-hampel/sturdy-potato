DROP POLICY IF EXISTS field_geometry_versions_delete_planned ON field_geometry_versions;
REVOKE DELETE ON field_geometry_versions FROM agmeo_app;

CREATE OR REPLACE VIEW field_current_geometry WITH (security_invoker = true) AS
  SELECT DISTINCT ON (field_id) id, organization_id, field_id, geometry, area_ha, valid_from
  FROM field_geometry_versions
  WHERE valid_to IS NULL
  ORDER BY field_id, valid_from DESC;
