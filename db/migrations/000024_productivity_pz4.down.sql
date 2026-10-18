DROP POLICY IF EXISTS crops_geo_read ON crops;
DROP POLICY IF EXISTS growing_seasons_geo_read ON growing_seasons;
DROP POLICY IF EXISTS crop_cycles_geo_read ON crop_cycles;
REVOKE SELECT (id, organization_id, category) ON crops FROM agmeo_geo;
REVOKE SELECT (id, organization_id, harvest_year) ON growing_seasons FROM agmeo_geo;
REVOKE SELECT (id, organization_id, field_id, season_id, crop_id, role) ON crop_cycles FROM agmeo_geo;

ALTER TABLE productivity_analyses DROP COLUMN IF EXISTS min_correlation, DROP COLUMN IF EXISTS tercile_stability;
