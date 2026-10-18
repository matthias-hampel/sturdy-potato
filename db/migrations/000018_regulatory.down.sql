ALTER TABLE crop_cycles DROP COLUMN IF EXISTS land_use_code;
ALTER TABLE crops DROP COLUMN IF EXISTS land_use_code;
DROP TABLE IF EXISTS land_use_codes;
DROP TABLE IF EXISTS n170_inputs;
ALTER TABLE farms
  DROP COLUMN IF EXISTS regulatory,
  DROP COLUMN IF EXISTS organic_certified,
  DROP COLUMN IF EXISTS fertilizer_year_start,
  DROP COLUMN IF EXISTS holding_number;
