DROP TABLE IF EXISTS nmin_reference_values;
DROP TABLE IF EXISTS fertilizer_need_records;
DROP TABLE IF EXISTS soil_samples;
ALTER TABLE crop_cycles DROP COLUMN IF EXISTS protein_pct, DROP COLUMN IF EXISTS film_or_fleece, DROP COLUMN IF EXISTS straw_removed;
ALTER TABLE farms DROP COLUMN IF EXISTS federal_state;
ALTER TABLE fields DROP COLUMN IF EXISTS soil_texture, DROP COLUMN IF EXISTS phosphate_sensitive_zone, DROP COLUMN IF EXISTS nitrate_sensitive_zone;
