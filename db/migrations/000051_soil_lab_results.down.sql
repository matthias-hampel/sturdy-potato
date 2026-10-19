ALTER TABLE soil_samples DROP CONSTRAINT IF EXISTS soil_samples_lab_import_fk;
ALTER TABLE soil_samples DROP CONSTRAINT IF EXISTS soil_samples_zonation_fk;
ALTER TABLE soil_samples DROP COLUMN IF EXISTS lab_import_id;
ALTER TABLE soil_samples DROP COLUMN IF EXISTS soil_zonation_id;
DROP TABLE IF EXISTS soil_lab_import_zones;
DROP TABLE IF EXISTS soil_lab_imports;
