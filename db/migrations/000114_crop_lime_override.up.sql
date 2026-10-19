-- Lime requirement entered for a crop cycle (dt CaO/ha over three years), overriding the value
-- computed from pH, soil class and humus (reference Cultivations.limeRequirementDtCaO).
ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS lime_requirement_dt_cao numeric(5, 1);
ALTER TABLE crop_cycles DROP CONSTRAINT IF EXISTS crop_cycles_lime_requirement_dt_cao_check;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_lime_requirement_dt_cao_check CHECK (lime_requirement_dt_cao BETWEEN 0 AND 500);
