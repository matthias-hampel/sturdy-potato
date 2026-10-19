ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_action_fk;
ALTER TABLE operations DROP COLUMN IF EXISTS action_id, DROP COLUMN IF EXISTS diesel_l_per_ha;
DROP TABLE IF EXISTS operation_actions;
ALTER TABLE employees DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS staff_number, DROP COLUMN IF EXISTS notes;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_default_employee_fk;
DROP TRIGGER IF EXISTS equipment_kind_sync ON equipment;
DROP FUNCTION IF EXISTS app.equipment_kind_sync();
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
UPDATE equipment SET status = CASE status WHEN 'active' THEN 'active' WHEN 'in_repair' THEN 'maintenance' ELSE 'retired' END;
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK (status IN ('active', 'maintenance', 'retired'));
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_category_check;
ALTER TABLE equipment DROP COLUMN IF EXISTS class, DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS mount_type,
  DROP COLUMN IF EXISTS serial_number, DROP COLUMN IF EXISTS inventory_number, DROP COLUMN IF EXISTS catalogue_id,
  DROP COLUMN IF EXISTS power_kw, DROP COLUMN IF EXISTS empty_mass_kg, DROP COLUMN IF EXISTS operating_mass_kg,
  DROP COLUMN IF EXISTS front_axle_fraction, DROP COLUMN IF EXISTS tank_capacity_l, DROP COLUMN IF EXISTS front_tyre,
  DROP COLUMN IF EXISTS rear_tyre, DROP COLUMN IF EXISTS max_fill_mass_kg, DROP COLUMN IF EXISTS working_width_m,
  DROP COLUMN IF EXISTS purchase_date, DROP COLUMN IF EXISTS purchase_price_net, DROP COLUMN IF EXISTS acquisition_type,
  DROP COLUMN IF EXISTS depreciation_method, DROP COLUMN IF EXISTS useful_life_years, DROP COLUMN IF EXISTS residual_value,
  DROP COLUMN IF EXISTS insurance_annual, DROP COLUMN IF EXISTS financing_type, DROP COLUMN IF EXISTS financing_monthly_payment,
  DROP COLUMN IF EXISTS financing_end_date, DROP COLUMN IF EXISTS lease_end_date, DROP COLUMN IF EXISTS machine_ring_member_number,
  DROP COLUMN IF EXISTS inspection_until, DROP COLUMN IF EXISTS insurance_until, DROP COLUMN IF EXISTS irrigation_type,
  DROP COLUMN IF EXISTS irrigation_flow_l_per_min, DROP COLUMN IF EXISTS irrigation_coverage_ha, DROP COLUMN IF EXISTS irrigation_pressure_bar,
  DROP COLUMN IF EXISTS default_employee_id, DROP COLUMN IF EXISTS archived_at;
