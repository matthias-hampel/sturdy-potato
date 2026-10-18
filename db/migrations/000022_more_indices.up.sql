-- EVI, bare soil index (BSI) and tillage index (NDTI) next to NDVI, NDRE and NDMI.
--
-- Imagery jobs record the processing version they last finished with; the geo worker queues
-- a job whose version is outdated again and rescans its whole history (existing jobs: NULL).

ALTER TABLE field_observations DROP CONSTRAINT IF EXISTS field_observations_index_type_check;
ALTER TABLE field_observations ADD CONSTRAINT field_observations_index_type_check
  CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'ndwi', 'evi', 'savi', 'bsi', 'ndti'));

ALTER TABLE field_imagery_jobs ADD COLUMN IF NOT EXISTS processing_version text;
