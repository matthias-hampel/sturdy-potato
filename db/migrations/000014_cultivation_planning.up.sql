-- Cultivation planning: main and catch crops, crop calendar defaults, crop rotations and
-- cultivation templates (reusable work plans that create planned operations for a crop).

-- ---------------------------------------------------------------------------
-- Crop catalogue
-- ---------------------------------------------------------------------------

ALTER TABLE crops
  ADD COLUMN is_legume boolean NOT NULL DEFAULT false,
  ADD COLUMN is_perennial boolean NOT NULL DEFAULT false,
  -- Typical sowing and harvest day in Germany ('MM-DD'), used when a crop has no dates of its own.
  -- Winter crops and catch crops are sown in the calendar year before the harvest year.
  ADD COLUMN default_sowing_md text CHECK (default_sowing_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  ADD COLUMN default_harvest_md text CHECK (default_harvest_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  -- EPPO code, used to match plant-protection authorizations to the crop.
  ADD COLUMN eppo_code text;

UPDATE crops SET is_legume = m.legume, is_perennial = m.perennial, default_sowing_md = m.sowing,
                 default_harvest_md = m.harvest, eppo_code = m.eppo
FROM (VALUES
  ('winter_wheat',    false, false, '10-10', '07-25', 'TRZAW'),
  ('spring_wheat',    false, false, '03-15', '08-10', 'TRZAS'),
  ('winter_barley',   false, false, '09-25', '07-10', 'HORVW'),
  ('spring_barley',   false, false, '03-20', '08-01', 'HORVS'),
  ('winter_rye',      false, false, '10-01', '07-20', 'SECCW'),
  ('triticale',       false, false, '10-01', '07-25', 'TTLWI'),
  ('oats',            false, false, '03-20', '08-05', 'AVESA'),
  ('winter_rapeseed', false, false, '08-25', '07-20', 'BRSNW'),
  ('sunflower',       false, false, '04-15', '09-15', 'HELAN'),
  ('grain_maize',     false, false, '04-25', '10-15', 'ZEAMX'),
  ('silage_maize',    false, false, '04-25', '09-20', 'ZEAMX'),
  ('sugar_beet',      false, false, '04-05', '10-15', 'BEAVA'),
  ('potatoes',        false, false, '04-20', '09-15', 'SOLTU'),
  ('field_beans',     true,  false, '03-10', '08-10', 'VICFM'),
  ('peas',            true,  false, '03-25', '07-25', 'PIBST'),
  ('soybeans',        true,  false, '05-01', '09-25', 'GLXMA'),
  ('grassland',       false, true,  NULL,    NULL,    NULL),
  ('cover_crop',      false, false, '08-20', '03-01', NULL),
  ('fallow',          false, false, NULL,    NULL,    NULL)
) AS m (code, legume, perennial, sowing, harvest, eppo)
WHERE crops.organization_id IS NULL AND crops.code = m.code;

INSERT INTO crops (code, name, name_de, category, is_winter_crop, color, is_legume, is_perennial,
                   default_sowing_md, default_harvest_md, eppo_code, bsa_species_code) VALUES
  ('winter_spelt',     'Winter spelt',          'Winterdinkel',           'cereal',    true,  '#c4a35a', false, false, '10-15', '08-01', 'TRZSP', 'DI'),
  ('winter_oats',      'Winter oats',           'Winterhafer',            'cereal',    true,  '#bfa76a', false, false, '09-25', '07-25', 'AVESA', NULL),
  ('spring_rapeseed',  'Spring oilseed rape',   'Sommerraps',             'oilseed',   false, '#ead85c', false, false, '04-01', '08-25', 'BRSNS', NULL),
  ('lupins',           'Lupins',                'Lupine',                 'legume',    false, '#8fa86b', true,  false, '03-25', '08-15', 'LUPSS', NULL),
  ('field_grass',      'Temporary grassland',   'Ackergras',              'grassland', false, '#5aa45f', false, true,  '04-01', '10-15', NULL,    NULL),
  ('clover_grass',     'Clover-grass ley',      'Kleegras',               'grassland', false, '#69a96d', true,  true,  '04-01', '10-15', NULL,    NULL),
  ('alfalfa',          'Alfalfa',               'Luzerne',                'legume',    false, '#7d9d5b', true,  true,  '04-01', '10-01', 'MEDSA', NULL),
  ('cc_mustard',       'Mustard (catch crop)',  'Senf (Zwischenfrucht)',  'cover',     false, '#c9cf63', false, false, '08-20', '03-01', 'SINAL', NULL),
  ('cc_phacelia',      'Phacelia (catch crop)', 'Phacelia (Zwischenfrucht)', 'cover',  false, '#8d86c9', false, false, '08-20', '03-01', 'PHCTA', NULL),
  ('cc_oil_radish',    'Oil radish (catch crop)', 'Ölrettich (Zwischenfrucht)', 'cover', false, '#a9b867', false, false, '08-20', '03-01', 'RAPSO', NULL),
  ('cc_legume_mix',    'Legume mix (catch crop)', 'Leguminosengemenge (Zwischenfrucht)', 'cover', false, '#83a974', true, false, '08-15', '03-01', NULL, NULL),
  ('cc_winter_rye',    'Rye (winter-hardy catch crop)', 'Grünroggen (Zwischenfrucht)', 'cover', true, '#9f8a4f', false, false, '09-15', '04-20', 'SECCW', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Crop roles and templates on crop cycles
-- ---------------------------------------------------------------------------

-- A catch crop (Zwischenfrucht) or undersown crop belongs to the season of the main crop it
-- precedes (the DüV convention), which with harvest-to-harvest seasons is the season it is sown in.
ALTER TABLE crop_cycles
  ADD COLUMN role text NOT NULL DEFAULT 'main' CHECK (role IN ('main', 'catch_crop', 'undersown'));

-- ---------------------------------------------------------------------------
-- Cultivation templates
-- ---------------------------------------------------------------------------

CREATE TABLE cultivation_templates (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crop_id             uuid NOT NULL REFERENCES crops(id),
  name                text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  notes               text,
  archived_at         timestamptz,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);
CREATE TRIGGER cultivation_templates_updated_at BEFORE UPDATE ON cultivation_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- One planned pass. Its date is the anchor date of the crop (sowing, expected harvest or the
-- start of the season) plus an offset in days, so a template fits every season and field.
CREATE TABLE template_steps (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  template_id     uuid NOT NULL,
  position        smallint NOT NULL CHECK (position >= 0),
  type            text NOT NULL CHECK (type IN ('tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other')),
  title           text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  anchor          text NOT NULL DEFAULT 'sowing' CHECK (anchor IN ('sowing', 'harvest', 'season_start')),
  offset_days     integer NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN -400 AND 400),
  bbch_stage      text,
  notes           text,
  UNIQUE (organization_id, id),
  UNIQUE (template_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, template_id) REFERENCES cultivation_templates (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE template_step_inputs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  step_id         uuid NOT NULL,
  product_id      uuid NOT NULL,
  -- In the product's base unit per hectare.
  rate_per_ha     numeric(16, 4) NOT NULL CHECK (rate_per_ha > 0),
  FOREIGN KEY (organization_id, step_id) REFERENCES template_steps (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id)
);
CREATE INDEX template_step_inputs_step_idx ON template_step_inputs (step_id);

ALTER TABLE crop_cycles ADD COLUMN template_id uuid;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_template_fkey
  FOREIGN KEY (organization_id, template_id) REFERENCES cultivation_templates (organization_id, id) ON DELETE SET NULL (template_id);

-- Planned operations created from a template step; replacing a template removes only those
-- that are still planned.
ALTER TABLE operations ADD COLUMN template_step_id uuid;
ALTER TABLE operations ADD CONSTRAINT operations_template_step_fkey
  FOREIGN KEY (organization_id, template_step_id) REFERENCES template_steps (organization_id, id) ON DELETE SET NULL (template_step_id);
CREATE INDEX operations_template_step_idx ON operations (template_step_id) WHERE template_step_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Crop rotations
-- ---------------------------------------------------------------------------

CREATE TABLE crop_rotations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);
CREATE TRIGGER crop_rotations_updated_at BEFORE UPDATE ON crop_rotations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- One year of the rotation: the main crop, optionally followed by a catch crop sown after its harvest.
CREATE TABLE crop_rotation_entries (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  rotation_id         uuid NOT NULL,
  position            smallint NOT NULL CHECK (position >= 0),
  crop_id             uuid NOT NULL REFERENCES crops(id),
  template_id         uuid,
  catch_crop_id       uuid REFERENCES crops(id),
  expected_yield_t_ha numeric(10, 3) CHECK (expected_yield_t_ha >= 0),
  UNIQUE (rotation_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, rotation_id) REFERENCES crop_rotations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, template_id) REFERENCES cultivation_templates (organization_id, id) ON DELETE SET NULL (template_id)
);

-- Which rotation a field follows, by harvest year. Periods of one field do not overlap.
CREATE TABLE field_crop_rotations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  rotation_id     uuid NOT NULL,
  start_year      smallint NOT NULL CHECK (start_year BETWEEN 1990 AND 2200),
  end_year        smallint CHECK (end_year BETWEEN 1990 AND 2200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_year IS NULL OR end_year >= start_year),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rotation_id) REFERENCES crop_rotations (organization_id, id) ON DELETE CASCADE,
  EXCLUDE USING gist (field_id WITH =, int4range(start_year, end_year, '[]') WITH &&)
);
CREATE INDEX field_crop_rotations_rotation_idx ON field_crop_rotations (rotation_id);

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE cultivation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_step_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_rotation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_crop_rotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY cultivation_templates_tenant ON cultivation_templates FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY template_steps_tenant ON template_steps FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY template_step_inputs_tenant ON template_step_inputs FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY crop_rotations_tenant ON crop_rotations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY crop_rotation_entries_tenant ON crop_rotation_entries FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY field_crop_rotations_tenant ON field_crop_rotations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON cultivation_templates, template_steps, template_step_inputs,
  crop_rotations, crop_rotation_entries, field_crop_rotations TO agmeo_app;
