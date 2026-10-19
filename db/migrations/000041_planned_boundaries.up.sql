-- Planned boundary changes: a version may start in the future. The current boundary is the one
-- valid now, not the open-ended one, so a planned change only shows once it takes effect.

CREATE OR REPLACE VIEW field_current_geometry WITH (security_invoker = true) AS
  SELECT DISTINCT ON (field_id) id, organization_id, field_id, geometry, area_ha, valid_from
  FROM field_geometry_versions
  WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
  ORDER BY field_id, valid_from DESC;

-- A planned version may be cancelled before it takes effect; history stays append-only.
GRANT DELETE ON field_geometry_versions TO agmeo_app;
DROP POLICY IF EXISTS field_geometry_versions_delete_planned ON field_geometry_versions;
CREATE POLICY field_geometry_versions_delete_planned ON field_geometry_versions AS RESTRICTIVE FOR DELETE
  USING (valid_from > now());
