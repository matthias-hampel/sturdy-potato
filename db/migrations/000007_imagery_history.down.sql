DROP TABLE IF EXISTS field_imagery_jobs;
DROP TABLE IF EXISTS field_rasters;
ALTER TABLE satellite_scenes DROP COLUMN IF EXISTS source;
