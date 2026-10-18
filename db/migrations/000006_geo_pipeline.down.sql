DROP POLICY IF EXISTS field_observations_geo_write ON field_observations;
DROP POLICY IF EXISTS satellite_scenes_geo_write ON satellite_scenes;
DROP POLICY IF EXISTS field_geometry_versions_geo_read ON field_geometry_versions;
DROP POLICY IF EXISTS fields_geo_read ON fields;
REVOKE ALL ON field_observations, satellite_scenes, field_geometry_versions, field_current_geometry, fields FROM agmeo_geo;
REVOKE EXECUTE ON FUNCTION app.org_id(), app.current_user_id() FROM agmeo_geo;
REVOKE USAGE ON SCHEMA public, app FROM agmeo_geo;
ALTER TABLE satellite_scenes DROP COLUMN IF EXISTS clear_fraction, DROP COLUMN IF EXISTS tile;
