-- Crop calendar: seed multiplication details on crops, and the organization's own crop colours.

ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS usage text NOT NULL DEFAULT 'commercial';
ALTER TABLE crop_cycles DROP CONSTRAINT IF EXISTS crop_cycles_usage_check;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_usage_check CHECK (usage IN ('commercial', 'seed_multiplication'));
-- Seed lot (Partie) and multiplication generation (e.g. Z1, Z2) of seed multiplication crops.
ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS seed_lot text CHECK (length(seed_lot) <= 100);
ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS multiplication_generation text CHECK (length(multiplication_generation) <= 20);

-- Colours an organization chose for catalogue (or its own) crops, shown everywhere instead of
-- the crop's default colour.
CREATE TABLE IF NOT EXISTS org_crop_colors (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crop_id         uuid NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  color           text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  PRIMARY KEY (organization_id, crop_id)
);
ALTER TABLE org_crop_colors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_crop_colors_tenant ON org_crop_colors;
CREATE POLICY org_crop_colors_tenant ON org_crop_colors FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON org_crop_colors TO agmeo_app;
