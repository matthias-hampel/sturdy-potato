DROP TABLE IF EXISTS market_quotes;
DROP TABLE IF EXISTS crop_benchmarks;
ALTER TABLE fields DROP COLUMN IF EXISTS lease_per_ha;
ALTER TABLE farm_overheads DROP COLUMN IF EXISTS accident_insurance_per_ha, DROP COLUMN IF EXISTS rights_per_ha,
  DROP COLUMN IF EXISTS salary_per_hour, DROP COLUMN IF EXISTS agri_env_per_ha, DROP COLUMN IF EXISTS young_farmers_per_ha,
  DROP COLUMN IF EXISTS total_ha_for_redistribution;
