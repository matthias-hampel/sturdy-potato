-- Machinery details after the reference app: machines and implements with their categories,
-- masses and tyres (soil compaction index), purchase, depreciation and financing, inspection and
-- insurance dates, irrigation data and a default operator. Operator details on employees.
-- An organization's catalogue of actions (Maßnahmenkatalog) with diesel and hours per hectare and
-- default machine, implement and operator, and the diesel per hectare of an operation.

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS class text NOT NULL DEFAULT 'machine' CHECK (class IN ('machine', 'implement'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS category text;
-- `kind` stays as the coarse group (icons, older clients); it follows the category. Rows written
-- with only a kind get the matching category, and the former statuses are mapped on write.
CREATE OR REPLACE FUNCTION app.equipment_kind_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS NULL AND NEW.kind IS NOT NULL THEN
    NEW.class := CASE WHEN NEW.kind IN ('sprayer', 'spreader', 'seeder', 'tillage', 'trailer') THEN 'implement' ELSE 'machine' END;
    NEW.category := CASE NEW.kind
      WHEN 'tractor' THEN 'tractor_medium' WHEN 'combine' THEN 'combine' WHEN 'sprayer' THEN 'sprayer'
      WHEN 'spreader' THEN 'fertilizer_spreader' WHEN 'seeder' THEN 'drill' WHEN 'tillage' THEN 'cultivator'
      WHEN 'trailer' THEN 'trailer' WHEN 'loader' THEN 'front_loader' WHEN 'vehicle' THEN 'transporter' ELSE 'other' END;
  END IF;
  NEW.kind := CASE
    WHEN NEW.category LIKE 'tractor%' OR NEW.category = 'track_tractor' THEN 'tractor'
    WHEN NEW.category IN ('combine', 'self_propelled_forage_harvester', 'self_propelled_root_harvester', 'potato_harvester', 'sugar_beet_harvester') THEN 'combine'
    WHEN NEW.category IN ('sprayer', 'self_propelled_sprayer') THEN 'sprayer'
    WHEN NEW.category IN ('fertilizer_spreader', 'manure_spreader', 'slurry_tanker', 'slurry_carrier_vehicle') THEN 'spreader'
    WHEN NEW.category IN ('drill', 'seeder', 'combination_drill', 'precision_drill', 'potato_planter', 'grassland_overseeder') THEN 'seeder'
    WHEN NEW.category IN ('plow', 'cultivator', 'harrow', 'disc_harrow', 'power_harrow', 'rotary_harrow', 'tine_harrow_weeder',
                          'row_crop_cultivator', 'roller', 'cultipacker', 'mulcher', 'meadow_harrow', 'grassland_mulcher', 'grassland_combo') THEN 'tillage'
    WHEN NEW.category IN ('trailer', 'overload_wagon', 'water_tanker') THEN 'trailer'
    WHEN NEW.category IN ('front_loader', 'telehandler') THEN 'loader'
    WHEN NEW.category = 'transporter' THEN 'vehicle'
    ELSE 'other' END;
  IF NEW.status = 'maintenance' THEN NEW.status := 'in_repair'; END IF;
  IF NEW.status = 'retired' THEN NEW.status := 'decommissioned'; END IF;
  RETURN NEW;
END $$;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS kind text;
-- Statuses of the reference; "maintenance" becomes "in_repair", "retired" becomes "decommissioned".
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
DROP TRIGGER IF EXISTS equipment_kind_sync ON equipment;
CREATE TRIGGER equipment_kind_sync BEFORE INSERT OR UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION app.equipment_kind_sync();
-- Existing rows get their category, kind and status through the trigger.
UPDATE equipment SET status = status;
UPDATE equipment SET category = 'other' WHERE category IS NULL;
ALTER TABLE equipment ALTER COLUMN category SET NOT NULL;
ALTER TABLE equipment ALTER COLUMN kind SET NOT NULL;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_kind_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_kind_check
  CHECK (kind IN ('tractor', 'combine', 'sprayer', 'spreader', 'seeder', 'tillage', 'trailer', 'loader', 'vehicle', 'other'));
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check
  CHECK (status IN ('active', 'in_repair', 'loaned_out', 'sold', 'scrapped', 'decommissioned'));
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_category_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_category_check CHECK (
  (class = 'machine' AND category IN ('tractor_small', 'tractor_medium', 'tractor_large', 'tractor_xlarge', 'combine',
    'self_propelled_sprayer', 'self_propelled_forage_harvester', 'self_propelled_root_harvester', 'track_tractor',
    'telehandler', 'front_loader', 'transporter', 'irrigation_pump', 'other'))
  OR (class = 'implement' AND category IN ('plow', 'cultivator', 'harrow', 'disc_harrow', 'power_harrow', 'rotary_harrow',
    'drill', 'seeder', 'combination_drill', 'precision_drill', 'fertilizer_spreader', 'manure_spreader', 'mower', 'tedder',
    'rake', 'baler_round', 'baler_square', 'baler_variable', 'trailer', 'slurry_tanker', 'water_tanker', 'overload_wagon',
    'tine_harrow_weeder', 'row_crop_cultivator', 'roller', 'cultipacker', 'mulcher', 'stone_picker', 'potato_planter',
    'potato_harvester', 'sugar_beet_harvester', 'sprayer', 'grassland_overseeder', 'grassland_combo', 'meadow_harrow',
    'grassland_mulcher', 'slurry_carrier_vehicle', 'irrigation_drip_line', 'irrigation_sprinkler', 'irrigation_hose_reel',
    'irrigation_pivot', 'other')));

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS mount_type text CHECK (mount_type IN ('three_point', 'trailed', 'semi_mounted', 'self_propelled', 'stationary'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS serial_number text CHECK (length(serial_number) <= 100);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS inventory_number text CHECK (length(inventory_number) <= 100);
-- Entry of the machinery catalogue the data was taken from.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS catalogue_id text CHECK (length(catalogue_id) <= 200);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS power_kw integer CHECK (power_kw BETWEEN 0 AND 2000);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS empty_mass_kg integer CHECK (empty_mass_kg BETWEEN 0 AND 100000);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS operating_mass_kg integer CHECK (operating_mass_kg BETWEEN 0 AND 100000);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS front_axle_fraction numeric(4, 3) CHECK (front_axle_fraction BETWEEN 0 AND 1);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS tank_capacity_l integer CHECK (tank_capacity_l BETWEEN 0 AND 100000);
-- {size, widthM, diameterM, profilePct, rimDiameterInches, recommendedPressureKpa, isFlexTyre}
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS front_tyre jsonb;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS rear_tyre jsonb;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS max_fill_mass_kg integer CHECK (max_fill_mass_kg BETWEEN 0 AND 100000);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS working_width_m numeric(6, 2) CHECK (working_width_m BETWEEN 0 AND 100);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS purchase_price_net numeric(14, 2) CHECK (purchase_price_net >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS acquisition_type text CHECK (acquisition_type IN ('owned', 'leased', 'rented', 'shared_machine_ring', 'contractor_owned', 'on_demonstration'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS depreciation_method text CHECK (depreciation_method IN ('linear', 'declining_balance', 'performance_based', 'not_depreciating'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS useful_life_years smallint CHECK (useful_life_years BETWEEN 1 AND 100);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS residual_value numeric(14, 2) CHECK (residual_value >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS insurance_annual numeric(12, 2) CHECK (insurance_annual >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS financing_type text CHECK (financing_type IN ('cash', 'loan', 'leasing', 'operating_lease', 'manufacturer_financing'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS financing_monthly_payment numeric(12, 2) CHECK (financing_monthly_payment >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS financing_end_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS lease_end_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS machine_ring_member_number text CHECK (length(machine_ring_member_number) <= 100);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS inspection_until date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS insurance_until date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS irrigation_type text CHECK (irrigation_type IN ('drip', 'sprinkler', 'pivot', 'hose_reel', 'sub_irrigation', 'flood', 'micro_sprinkler'));
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS irrigation_flow_l_per_min integer CHECK (irrigation_flow_l_per_min BETWEEN 0 AND 1000000);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS irrigation_coverage_ha numeric(10, 2) CHECK (irrigation_coverage_ha >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS irrigation_pressure_bar numeric(6, 2) CHECK (irrigation_pressure_bar >= 0);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS default_employee_id uuid;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_default_employee_fk;
ALTER TABLE equipment ADD CONSTRAINT equipment_default_employee_fk
  FOREIGN KEY (organization_id, default_employee_id) REFERENCES employees (organization_id, id) ON DELETE SET NULL (default_employee_id);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'field_worker' CHECK (role IN ('machine_operator', 'field_worker', 'manager', 'other'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS staff_number text CHECK (length(staff_number) <= 50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes text CHECK (length(notes) <= 4000);

CREATE TABLE IF NOT EXISTS operation_actions (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  operation_type      text NOT NULL CHECK (operation_type IN ('tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other')),
  diesel_l_per_ha     numeric(8, 2) CHECK (diesel_l_per_ha BETWEEN 0 AND 1000),
  hours_per_ha        numeric(8, 3) CHECK (hours_per_ha BETWEEN 0 AND 100),
  machine_id          uuid,
  implement_id        uuid,
  employee_id         uuid,
  notes               text CHECK (length(notes) <= 4000),
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, machine_id) REFERENCES equipment (organization_id, id) ON DELETE SET NULL (machine_id),
  FOREIGN KEY (organization_id, implement_id) REFERENCES equipment (organization_id, id) ON DELETE SET NULL (implement_id),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_actions_name_idx ON operation_actions (organization_id, lower(name)) WHERE archived_at IS NULL;
DROP TRIGGER IF EXISTS operation_actions_updated_at ON operation_actions;
CREATE TRIGGER operation_actions_updated_at BEFORE UPDATE ON operation_actions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
ALTER TABLE operation_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operation_actions_tenant ON operation_actions;
CREATE POLICY operation_actions_tenant ON operation_actions FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON operation_actions TO agmeo_app;

-- The action an operation was planned from, and its diesel per hectare (else estimated from machine hours).
ALTER TABLE operations ADD COLUMN IF NOT EXISTS action_id uuid;
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_action_fk;
ALTER TABLE operations ADD CONSTRAINT operations_action_fk
  FOREIGN KEY (organization_id, action_id) REFERENCES operation_actions (organization_id, id) ON DELETE SET NULL (action_id);
ALTER TABLE operations ADD COLUMN IF NOT EXISTS diesel_l_per_ha numeric(8, 2) CHECK (diesel_l_per_ha BETWEEN 0 AND 1000);
