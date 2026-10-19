-- Rooting depth the FAO-56 water balance uses for a crop cycle (reference Cultivations.rootDepthM);
-- null = the crop's FAO-56 default.
ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS root_depth_m numeric(4, 2);
ALTER TABLE crop_cycles DROP CONSTRAINT IF EXISTS crop_cycles_root_depth_m_check;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_root_depth_m_check CHECK (root_depth_m BETWEEN 0.1 AND 3);
