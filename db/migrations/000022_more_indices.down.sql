ALTER TABLE field_imagery_jobs DROP COLUMN processing_version;

DELETE FROM field_observations WHERE index_type IN ('bsi', 'ndti');
ALTER TABLE field_observations DROP CONSTRAINT field_observations_index_type_check;
ALTER TABLE field_observations ADD CONSTRAINT field_observations_index_type_check
  CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'ndwi', 'evi', 'savi'));
