-- Inventory ledger (ADR-005), field operations (ADR-004), cost entries and harvests.

CREATE TABLE storage_locations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  farm_id         uuid,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE SET NULL (farm_id)
);

CREATE TABLE products (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category            text NOT NULL CHECK (category IN ('seed', 'fertilizer', 'crop_protection', 'fuel', 'consumable', 'other')),
  name                text NOT NULL CHECK (length(trim(name)) > 0),
  manufacturer        text,
  -- All quantities of this product (stock, rates, consumption) are stored in this unit.
  base_unit           text NOT NULL CHECK (base_unit IN ('kg', 't', 'l', 'm3', 'unit')),
  -- Default valuation per base unit; operations may override it per application.
  unit_cost           numeric(14, 4) CHECK (unit_cost >= 0),
  -- Plant-protection authorization number (e.g. BVL Zulassungsnummer).
  registration_number text,
  active_ingredients  text,
  -- Nutrient content in percent of mass, for fertilizers.
  n_pct               numeric(6, 3) CHECK (n_pct BETWEEN 0 AND 100),
  p2o5_pct            numeric(6, 3) CHECK (p2o5_pct BETWEEN 0 AND 100),
  k2o_pct             numeric(6, 3) CHECK (k2o_pct BETWEEN 0 AND 100),
  s_pct               numeric(6, 3) CHECK (s_pct BETWEEN 0 AND 100),
  low_stock_threshold numeric(16, 4) CHECK (low_stock_threshold >= 0),
  notes               text,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX products_org_idx ON products (organization_id, category);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Operations: the central transactional record
-- ---------------------------------------------------------------------------

CREATE TABLE operations (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL,
  farm_id                 uuid NOT NULL,
  type                    text NOT NULL CHECK (type IN ('tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other')),
  title                   text NOT NULL CHECK (length(trim(title)) > 0),
  status                  text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'canceled')),
  planned_on              date,
  performed_at            timestamptz,
  responsible_employee_id uuid,
  contractor_name         text,
  contractor_cost         numeric(12, 2) CHECK (contractor_cost >= 0),
  -- Agronomic context required by plant-protection records (EU 2023/564).
  bbch_stage              text,
  target_organism         text,
  weather_conditions      text,
  -- Type-specific attributes (e.g. irrigation mm, seed rate per m², tillage depth).
  details                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                   text,
  -- Incremented on every completion so that side effects of each completion (and of its
  -- reversal) are uniquely keyed and can never be applied twice.
  completion_seq          integer NOT NULL DEFAULT 0,
  -- Optimistic concurrency token.
  version                 integer NOT NULL DEFAULT 1,
  completed_at            timestamptz,
  completed_by            uuid REFERENCES users(id),
  created_by              uuid REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, responsible_employee_id) REFERENCES employees (organization_id, id) ON DELETE SET NULL (responsible_employee_id),
  CHECK (status <> 'completed' OR performed_at IS NOT NULL)
);
CREATE INDEX operations_org_idx ON operations (organization_id, status, planned_on);
CREATE TRIGGER operations_updated_at BEFORE UPDATE ON operations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- One operation may cover several fields while keeping per-field area and allocations.
CREATE TABLE operation_fields (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  operation_id        uuid NOT NULL,
  field_id            uuid NOT NULL,
  crop_cycle_id       uuid,
  -- Boundary version the work was carried out on (historical traceability).
  geometry_version_id uuid,
  treated_area_ha     numeric(14, 4) NOT NULL CHECK (treated_area_ha > 0),
  UNIQUE (operation_id, field_id),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE SET NULL (crop_cycle_id),
  FOREIGN KEY (organization_id, geometry_version_id) REFERENCES field_geometry_versions (organization_id, id)
);
CREATE INDEX operation_fields_field_idx ON operation_fields (organization_id, field_id);
CREATE INDEX operation_fields_cycle_idx ON operation_fields (crop_cycle_id);

CREATE TABLE operation_inputs (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  operation_id        uuid NOT NULL,
  product_id          uuid NOT NULL,
  storage_location_id uuid,
  -- In the product's base unit per hectare.
  rate_per_ha         numeric(16, 4) CHECK (rate_per_ha >= 0),
  -- In the product's base unit, across all treated fields.
  total_quantity      numeric(16, 4) NOT NULL CHECK (total_quantity > 0),
  -- Valuation override per base unit; falls back to products.unit_cost at completion.
  unit_cost           numeric(14, 4) CHECK (unit_cost >= 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id),
  FOREIGN KEY (organization_id, storage_location_id) REFERENCES storage_locations (organization_id, id)
);
CREATE INDEX operation_inputs_operation_idx ON operation_inputs (operation_id);

CREATE TABLE operation_labor (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  operation_id    uuid NOT NULL,
  employee_id     uuid NOT NULL,
  hours           numeric(8, 2) NOT NULL CHECK (hours > 0),
  hourly_rate     numeric(10, 2) CHECK (hourly_rate >= 0),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id)
);
CREATE INDEX operation_labor_operation_idx ON operation_labor (operation_id);

CREATE TABLE operation_equipment (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  operation_id    uuid NOT NULL,
  equipment_id    uuid NOT NULL,
  hours           numeric(8, 2) NOT NULL CHECK (hours > 0),
  hourly_cost     numeric(10, 2) CHECK (hourly_cost >= 0),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, equipment_id) REFERENCES equipment (organization_id, id)
);
CREATE INDEX operation_equipment_operation_idx ON operation_equipment (operation_id);

-- ---------------------------------------------------------------------------
-- Stock ledger: immutable movements; balances are always computed.
-- ---------------------------------------------------------------------------

CREATE TABLE stock_movements (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL,
  product_id          uuid NOT NULL,
  storage_location_id uuid,
  kind                text NOT NULL CHECK (kind IN ('receipt', 'adjustment', 'consumption', 'reversal')),
  quantity_delta      numeric(16, 4) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost           numeric(14, 4) CHECK (unit_cost >= 0),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  operation_id        uuid,
  operation_input_id  uuid,
  completion_seq      integer,
  note                text,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id),
  FOREIGN KEY (organization_id, storage_location_id) REFERENCES storage_locations (organization_id, id),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id),
  CHECK ((kind IN ('consumption', 'reversal')) = (operation_input_id IS NOT NULL AND completion_seq IS NOT NULL))
);
-- Exactly-once side effects: one consumption and at most one reversal per input and completion.
CREATE UNIQUE INDEX stock_movements_once_idx ON stock_movements (operation_input_id, completion_seq, kind)
  WHERE operation_input_id IS NOT NULL;
CREATE INDEX stock_movements_product_idx ON stock_movements (organization_id, product_id, occurred_at DESC);

CREATE VIEW stock_balances WITH (security_invoker = true) AS
  SELECT organization_id, product_id, storage_location_id, sum(quantity_delta) AS quantity
  FROM stock_movements
  GROUP BY organization_id, product_id, storage_location_id;

-- ---------------------------------------------------------------------------
-- Economics
-- ---------------------------------------------------------------------------

CREATE TABLE cost_entries (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  season_id       uuid,
  crop_cycle_id   uuid,
  field_id        uuid,
  operation_id    uuid,
  category        text NOT NULL CHECK (category IN ('seed', 'fertilizer', 'crop_protection', 'fuel', 'other_input', 'labor', 'machinery', 'contractor', 'land', 'insurance', 'other')),
  -- Signed: reversals of operation costs are negative compensating entries.
  amount          numeric(14, 2) NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'EUR',
  basis           text NOT NULL DEFAULT 'actual' CHECK (basis IN ('actual', 'estimated')),
  source          text NOT NULL CHECK (source IN ('operation', 'reversal', 'manual')),
  completion_seq  integer,
  description     text,
  incurred_on     date NOT NULL,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, season_id) REFERENCES growing_seasons (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id),
  CHECK ((source = 'manual') = (operation_id IS NULL))
);
CREATE UNIQUE INDEX cost_entries_once_idx ON cost_entries (operation_id, completion_seq, source, field_id, category)
  NULLS NOT DISTINCT WHERE operation_id IS NOT NULL;
CREATE INDEX cost_entries_cycle_idx ON cost_entries (organization_id, crop_cycle_id);
CREATE INDEX cost_entries_season_idx ON cost_entries (organization_id, season_id);

CREATE TABLE harvests (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL,
  crop_cycle_id     uuid NOT NULL,
  operation_id      uuid,
  harvest_date      date NOT NULL,
  harvested_area_ha numeric(14, 4) NOT NULL CHECK (harvested_area_ha > 0),
  quantity_t        numeric(14, 3) NOT NULL CHECK (quantity_t >= 0),
  moisture_pct      numeric(5, 2) CHECK (moisture_pct BETWEEN 0 AND 100),
  quality           text,
  price_per_t       numeric(12, 2) CHECK (price_per_t >= 0),
  price_basis       text NOT NULL DEFAULT 'expected' CHECK (price_basis IN ('actual', 'expected')),
  notes             text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE SET NULL (operation_id)
);
CREATE INDEX harvests_cycle_idx ON harvests (organization_id, crop_cycle_id);
CREATE TRIGGER harvests_updated_at BEFORE UPDATE ON harvests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvests ENABLE ROW LEVEL SECURITY;

CREATE POLICY storage_locations_tenant ON storage_locations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY products_tenant ON products FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY operations_tenant ON operations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY operation_fields_tenant ON operation_fields FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY operation_inputs_tenant ON operation_inputs FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY operation_labor_tenant ON operation_labor FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY operation_equipment_tenant ON operation_equipment FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY stock_movements_tenant ON stock_movements FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY cost_entries_read ON cost_entries FOR SELECT
  USING (organization_id = (SELECT app.org_id()));
CREATE POLICY cost_entries_insert ON cost_entries FOR INSERT
  WITH CHECK (organization_id = (SELECT app.org_id()));
-- Only manually entered costs may be removed; operation costs are reversed instead.
CREATE POLICY cost_entries_delete_manual ON cost_entries FOR DELETE
  USING (organization_id = (SELECT app.org_id()) AND source = 'manual');
CREATE POLICY harvests_tenant ON harvests FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON storage_locations, products, operations, operation_fields,
  operation_inputs, operation_labor, operation_equipment, harvests TO agmeo_app;
GRANT SELECT, INSERT ON stock_movements TO agmeo_app;
GRANT SELECT, INSERT, DELETE ON cost_entries TO agmeo_app;
GRANT SELECT ON stock_balances TO agmeo_app;
