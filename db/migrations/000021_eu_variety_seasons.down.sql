UPDATE crops SET eu_species_code = NULL
WHERE organization_id IS NULL AND eu_species_code IN ('TRITI_AES', 'HORDE_VUL', 'SECAL_CER', 'TRITL', 'AVENA_SAT', 'BRASS_NAP_NUS');
ALTER TABLE crops DROP CONSTRAINT IF EXISTS crops_eu_season_species;
ALTER TABLE crops DROP COLUMN IF EXISTS eu_season;
ALTER TABLE eu_varieties DROP COLUMN IF EXISTS season;
