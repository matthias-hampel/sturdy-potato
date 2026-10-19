ALTER TABLE farms DROP CONSTRAINT IF EXISTS farms_eu_holding_number_check;
ALTER TABLE farms DROP COLUMN IF EXISTS eu_holding_number;
