REVOKE SELECT (eu_species_code) ON crops FROM agmeo_refdata;
ALTER TABLE crop_varieties DROP COLUMN IF EXISTS eu_variety_id;
DROP TABLE IF EXISTS eu_varieties;
DROP TABLE IF EXISTS eu_species;
ALTER TABLE crops DROP COLUMN IF EXISTS eu_species_code;
