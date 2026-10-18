-- Economics and carbon: crop sale prices per harvest year, farm overheads and CAP payments per
-- season (farm result), fuel use of machines, and a ledger of greenhouse-gas emissions written
-- when operations are completed (the counterpart of cost_entries).

CREATE TABLE crop_prices (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crop_id         uuid NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  harvest_year    smallint NOT NULL CHECK (harvest_year BETWEEN 1990 AND 2200),
  price_per_t     numeric(12, 2) NOT NULL CHECK (price_per_t >= 0),
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, crop_id, harvest_year)
);
CREATE TRIGGER crop_prices_updated_at BEFORE UPDATE ON crop_prices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Costs that are not allocated to crops and the area payments, per hectare of the farm's
-- cropped area in a season. They turn contribution margins into an (indicative) farm result.
CREATE TABLE farm_overheads (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL,
  season_id                uuid NOT NULL,
  lease_per_ha             numeric(10, 2) NOT NULL DEFAULT 0 CHECK (lease_per_ha >= 0),
  land_tax_per_ha          numeric(10, 2) NOT NULL DEFAULT 0 CHECK (land_tax_per_ha >= 0),
  insurance_per_ha         numeric(10, 2) NOT NULL DEFAULT 0 CHECK (insurance_per_ha >= 0),
  buildings_per_ha         numeric(10, 2) NOT NULL DEFAULT 0 CHECK (buildings_per_ha >= 0),
  accounting_per_ha        numeric(10, 2) NOT NULL DEFAULT 0 CHECK (accounting_per_ha >= 0),
  other_per_ha             numeric(10, 2) NOT NULL DEFAULT 0 CHECK (other_per_ha >= 0),
  -- CAP direct payments: basic income support, redistributive payment for the first 40 ha
  -- and the next 20 ha, eco-schemes and other payments (agri-environment, young farmers).
  basic_payment_per_ha     numeric(10, 2) NOT NULL DEFAULT 0 CHECK (basic_payment_per_ha >= 0),
  redistributive1_per_ha   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (redistributive1_per_ha >= 0),
  redistributive2_per_ha   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (redistributive2_per_ha >= 0),
  eco_schemes_per_ha       numeric(10, 2) NOT NULL DEFAULT 0 CHECK (eco_schemes_per_ha >= 0),
  other_payments_per_ha    numeric(10, 2) NOT NULL DEFAULT 0 CHECK (other_payments_per_ha >= 0),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, season_id),
  FOREIGN KEY (organization_id, season_id) REFERENCES growing_seasons (organization_id, id) ON DELETE CASCADE
);
CREATE TRIGGER farm_overheads_updated_at BEFORE UPDATE ON farm_overheads
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Diesel per operating hour, used for emissions when an operation records no fuel.
ALTER TABLE equipment ADD COLUMN fuel_l_per_h numeric(6, 2) CHECK (fuel_l_per_h >= 0);

-- kg CO2e by source, allocated to fields (and crop cycles) by treated area. Written on
-- completion and reversed on reopening, exactly once per completion like cost entries.
CREATE TABLE emission_entries (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  operation_id    uuid NOT NULL,
  completion_seq  integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('operation', 'reversal')),
  season_id       uuid,
  crop_cycle_id   uuid,
  field_id        uuid NOT NULL,
  field_part_id   uuid,
  source          text NOT NULL,
  kg_co2e         numeric(14, 3) NOT NULL,
  factor_set      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES growing_seasons (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX emission_entries_once_idx ON emission_entries (operation_id, completion_seq, kind, field_id, field_part_id, source) NULLS NOT DISTINCT;
CREATE INDEX emission_entries_cycle_idx ON emission_entries (organization_id, crop_cycle_id);
CREATE INDEX emission_entries_season_idx ON emission_entries (organization_id, season_id);

ALTER TABLE crop_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_overheads ENABLE ROW LEVEL SECURITY;
ALTER TABLE emission_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY crop_prices_tenant ON crop_prices FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY farm_overheads_tenant ON farm_overheads FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
CREATE POLICY emission_entries_tenant ON emission_entries FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crop_prices, farm_overheads TO agmeo_app;
-- Append-only, like the stock ledger.
GRANT SELECT, INSERT ON emission_entries TO agmeo_app;
