DROP POLICY IF EXISTS harvests_jobs_yield ON harvests;
REVOKE SELECT, INSERT, UPDATE ON harvests FROM agmeo_jobs;
DROP POLICY IF EXISTS zoning_zones_jobs_read ON zoning_zones;
DROP POLICY IF EXISTS zonings_jobs_read ON zonings;
DROP POLICY IF EXISTS field_geometry_versions_jobs_read ON field_geometry_versions;
DROP POLICY IF EXISTS field_parts_jobs_read ON field_parts;
DROP POLICY IF EXISTS crops_jobs_read ON crops;
DROP POLICY IF EXISTS growing_seasons_jobs_read ON growing_seasons;
DROP POLICY IF EXISTS crop_cycles_jobs_read ON crop_cycles;
REVOKE SELECT ON zonings, zoning_zones, field_geometry_versions, field_current_geometry, field_parts, crops, growing_seasons, crop_cycles FROM agmeo_jobs;

DROP POLICY IF EXISTS zoning_zones_yield_write ON zoning_zones;
DROP POLICY IF EXISTS zonings_yield_delete ON zonings;
DROP POLICY IF EXISTS zonings_yield_write ON zonings;
REVOKE INSERT, DELETE ON zonings FROM agmeo_app;
REVOKE INSERT ON zoning_zones FROM agmeo_app;

DELETE FROM zonings WHERE source IN ('yield_map', 'yield_estimate');
ALTER TABLE zoning_zones DROP COLUMN IF EXISTS mean_yield_t_ha;
DROP INDEX IF EXISTS zonings_crop_cycle_idx;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_yield_raster_fkey;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_crop_cycle_fkey;
ALTER TABLE zonings DROP COLUMN IF EXISTS params;
ALTER TABLE zonings DROP COLUMN IF EXISTS yield_raster_id;
ALTER TABLE zonings DROP COLUMN IF EXISTS crop_cycle_id;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_source_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_source_check CHECK (source IN ('productivity'));

ALTER TABLE harvests DROP CONSTRAINT IF EXISTS harvests_yield_raster_fkey;
ALTER TABLE harvests DROP COLUMN IF EXISTS yield_raster_id;

DROP TABLE IF EXISTS yield_zone_yields;
DROP TABLE IF EXISTS yield_rasters;
DROP TABLE IF EXISTS yield_map_sources;
