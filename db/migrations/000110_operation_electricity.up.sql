-- Electricity per treated hectare of an operation (reference: "Strom" kWh/ha in the seeding and
-- tillage tables), beside the diesel per hectare.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS electricity_kwh_per_ha numeric(8, 2);
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_electricity_kwh_per_ha_check;
ALTER TABLE operations ADD CONSTRAINT operations_electricity_kwh_per_ha_check
  CHECK (electricity_kwh_per_ha BETWEEN 0 AND 10000);
