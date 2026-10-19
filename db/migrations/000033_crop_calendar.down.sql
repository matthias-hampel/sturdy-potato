DROP TABLE IF EXISTS org_crop_colors;
ALTER TABLE crop_cycles DROP CONSTRAINT IF EXISTS crop_cycles_usage_check;
ALTER TABLE crop_cycles DROP COLUMN IF EXISTS multiplication_generation, DROP COLUMN IF EXISTS seed_lot, DROP COLUMN IF EXISTS usage;
