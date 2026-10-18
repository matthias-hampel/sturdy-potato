DROP POLICY IF EXISTS crops_refdata_read ON crops;
REVOKE ALL ON crops FROM agmeo_refdata;
ALTER TABLE crop_varieties DROP COLUMN IF EXISTS bsa_variety_id;
DROP TABLE IF EXISTS bsa_varieties;
DROP TABLE IF EXISTS bsa_species;
ALTER TABLE crops DROP COLUMN IF EXISTS bsa_species_code;
REVOKE USAGE ON SCHEMA public FROM agmeo_refdata;
