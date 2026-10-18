-- Satellite pipeline (backend/agmeo-geo): registers processed Sentinel-2 scenes and writes
-- per-field zonal statistics for every organization.
--
-- The pipeline is cross-tenant by nature, so it connects with its own role (a member of
-- agmeo_geo) that is granted, through role-specific policies, read access to field
-- boundaries and write access to scenes and observations only. It cannot read any other
-- agronomic, financial or personal data.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_geo') THEN
    CREATE ROLE agmeo_geo NOLOGIN;
  END IF;
END
$$;

ALTER TABLE satellite_scenes
  ADD COLUMN tile text,
  -- Share of the acquisition footprint that kept a value after cloud/shadow/haze masking.
  ADD COLUMN clear_fraction numeric(5, 4) CHECK (clear_fraction BETWEEN 0 AND 1);
COMMENT ON COLUMN satellite_scenes.asset_refs IS
  'Location of the derived rasters relative to the archive root: {"dir": "...", "assets": {"ndvi": {"path", "band", "resolution_m"}}}';

GRANT USAGE ON SCHEMA public, app TO agmeo_geo;
-- Policies of other roles on the same tables reference these functions.
GRANT EXECUTE ON FUNCTION app.org_id(), app.current_user_id() TO agmeo_geo;

GRANT SELECT (id, organization_id, farm_id, name, status) ON fields TO agmeo_geo;
GRANT SELECT ON field_geometry_versions, field_current_geometry TO agmeo_geo;
GRANT SELECT, INSERT, UPDATE ON satellite_scenes TO agmeo_geo;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_observations TO agmeo_geo;

CREATE POLICY fields_geo_read ON fields FOR SELECT TO agmeo_geo USING (true);
CREATE POLICY field_geometry_versions_geo_read ON field_geometry_versions FOR SELECT TO agmeo_geo USING (true);
CREATE POLICY satellite_scenes_geo_write ON satellite_scenes FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
CREATE POLICY field_observations_geo_write ON field_observations FOR ALL TO agmeo_geo USING (true) WITH CHECK (true);
