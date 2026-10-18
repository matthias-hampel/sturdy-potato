-- Employees, machinery, crop catalogue, growing seasons and crop cycles.

-- People who do farm work. Independent of app access: a seasonal worker or contractor
-- may be tracked for labor costs without a user account (user_id NULL).
CREATE TABLE employees (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  job_title       text,
  email           citext,
  phone           text,
  hourly_rate     numeric(10, 2) CHECK (hourly_rate >= 0),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE equipment (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  farm_id         uuid,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  kind            text NOT NULL CHECK (kind IN ('tractor', 'combine', 'sprayer', 'spreader', 'seeder', 'tillage', 'trailer', 'loader', 'vehicle', 'other')),
  manufacturer    text,
  model           text,
  model_year      smallint CHECK (model_year BETWEEN 1900 AND 2100),
  registration    text,
  -- Operating hours counter; increased by completed operations and maintenance readings.
  hour_meter      numeric(10, 1) NOT NULL DEFAULT 0 CHECK (hour_meter >= 0),
  hourly_cost     numeric(10, 2) CHECK (hourly_cost >= 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'retired')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE SET NULL (farm_id)
);
CREATE TRIGGER equipment_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE maintenance_records (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  equipment_id    uuid NOT NULL,
  performed_on    date NOT NULL,
  description     text NOT NULL,
  cost            numeric(12, 2) CHECK (cost >= 0),
  hour_meter      numeric(10, 1) CHECK (hour_meter >= 0),
  next_due_on     date,
  next_due_hours  numeric(10, 1),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, equipment_id) REFERENCES equipment (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX maintenance_records_equipment_idx ON maintenance_records (equipment_id, performed_on DESC);

-- Crops are shared reference data (organization_id NULL) plus organization-specific entries.
CREATE TABLE crops (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  name_de         text,
  category        text NOT NULL CHECK (category IN ('cereal', 'oilseed', 'legume', 'maize', 'root', 'grassland', 'cover', 'vegetable', 'other')),
  is_winter_crop  boolean NOT NULL DEFAULT false,
  color           text NOT NULL DEFAULT '#7c8f3a',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, code)
);

INSERT INTO crops (code, name, name_de, category, is_winter_crop, color) VALUES
  ('winter_wheat',    'Winter wheat',        'Winterweizen',        'cereal',    true,  '#d9a521'),
  ('spring_wheat',    'Spring wheat',        'Sommerweizen',        'cereal',    false, '#e8c25a'),
  ('winter_barley',   'Winter barley',       'Wintergerste',        'cereal',    true,  '#c98a2b'),
  ('spring_barley',   'Spring barley',       'Sommergerste',        'cereal',    false, '#dfae63'),
  ('winter_rye',      'Winter rye',          'Winterroggen',        'cereal',    true,  '#a8742c'),
  ('triticale',       'Winter triticale',    'Wintertriticale',     'cereal',    true,  '#b98f46'),
  ('oats',            'Oats',                'Hafer',               'cereal',    false, '#cdb57a'),
  ('winter_rapeseed', 'Winter oilseed rape', 'Winterraps',          'oilseed',   true,  '#e3d23a'),
  ('sunflower',       'Sunflower',           'Sonnenblume',         'oilseed',   false, '#f0b323'),
  ('grain_maize',     'Grain maize',         'Körnermais',          'maize',     false, '#5f9e3a'),
  ('silage_maize',    'Silage maize',        'Silomais',            'maize',     false, '#3f7d2c'),
  ('sugar_beet',      'Sugar beet',          'Zuckerrübe',          'root',      false, '#a2496b'),
  ('potatoes',        'Potatoes',            'Kartoffeln',          'root',      false, '#8a6d4b'),
  ('field_beans',     'Field beans',         'Ackerbohne',          'legume',    false, '#6b8f71'),
  ('peas',            'Field peas',          'Körnererbse',         'legume',    false, '#7fb069'),
  ('soybeans',        'Soybeans',            'Sojabohne',           'legume',    false, '#93a661'),
  ('grassland',       'Grassland',           'Grünland',            'grassland', false, '#4c9a52'),
  ('cover_crop',      'Cover crop',          'Zwischenfrucht',      'cover',     false, '#7aa37a'),
  ('fallow',          'Fallow',              'Brache',              'other',     false, '#b5a58a');

CREATE TABLE crop_varieties (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crop_id         uuid NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, crop_id, name)
);

-- A season is named by harvest year; winter crops span calendar years inside one season.
CREATE TABLE growing_seasons (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  harvest_year    smallint NOT NULL CHECK (harvest_year BETWEEN 1990 AND 2200),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, harvest_year),
  CHECK (end_date > start_date)
);

-- One production cycle of a crop on a field within a season.
CREATE TABLE crop_cycles (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL,
  field_id              uuid NOT NULL,
  season_id             uuid NOT NULL,
  crop_id               uuid NOT NULL REFERENCES crops(id),
  variety_id            uuid,
  status                text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'harvested', 'closed')),
  -- NULL means the whole current field area.
  area_ha               numeric(14, 4) CHECK (area_ha > 0),
  sowing_date           date,
  expected_harvest_date date,
  expected_yield_t_ha   numeric(10, 3) CHECK (expected_yield_t_ha >= 0),
  expected_price_per_t  numeric(12, 2) CHECK (expected_price_per_t >= 0),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, season_id) REFERENCES growing_seasons (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, variety_id) REFERENCES crop_varieties (organization_id, id) ON DELETE SET NULL (variety_id),
  CHECK (expected_harvest_date IS NULL OR sowing_date IS NULL OR expected_harvest_date > sowing_date)
);
CREATE INDEX crop_cycles_field_idx ON crop_cycles (organization_id, field_id);
CREATE INDEX crop_cycles_season_idx ON crop_cycles (organization_id, season_id);
CREATE TRIGGER crop_cycles_updated_at BEFORE UPDATE ON crop_cycles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_varieties ENABLE ROW LEVEL SECURITY;
ALTER TABLE growing_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_tenant ON employees FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY equipment_tenant ON equipment FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY maintenance_records_tenant ON maintenance_records FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY crops_read ON crops FOR SELECT
  USING (organization_id IS NULL OR organization_id = (SELECT app.org_id()));
CREATE POLICY crops_write ON crops FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY crop_varieties_tenant ON crop_varieties FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY growing_seasons_tenant ON growing_seasons FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY crop_cycles_tenant ON crop_cycles FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON employees, equipment, maintenance_records, crops,
  crop_varieties, growing_seasons, crop_cycles TO agmeo_app;
