-- SAVI and LAI next to the other indices (the reference shows both); the geo worker's new processing
-- version rescans the history of every field.
ALTER TABLE field_observations DROP CONSTRAINT IF EXISTS field_observations_index_type_check;
ALTER TABLE field_observations ADD CONSTRAINT field_observations_index_type_check
  CHECK (index_type IN ('ndvi', 'ndre', 'ndmi', 'ndwi', 'evi', 'savi', 'lai', 'bsi', 'ndti'));
