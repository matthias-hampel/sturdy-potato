DELETE FROM field_observations WHERE index_type = 'lai';
ALTER TABLE field_observations DROP CONSTRAINT IF EXISTS field_observations_index_type_check;
ALTER TABLE field_observations ADD CONSTRAINT field_observations_index_type_check
  CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'ndwi', 'evi', 'savi', 'bsi', 'ndti'));
