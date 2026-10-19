-- Profitability depth after the reference app (lib/economics, analysis/_components/profitability):
-- the remaining farm-economics settings, a lease per field, crop benchmarks, and weekly market
-- quotes from the EU Agri-food Data Portal.

ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS accident_insurance_per_ha numeric(10, 2) NOT NULL DEFAULT 0 CHECK (accident_insurance_per_ha >= 0);
ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS rights_per_ha numeric(10, 2) NOT NULL DEFAULT 0 CHECK (rights_per_ha >= 0);
-- Default labour rate for hours of employees without their own rate.
ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS salary_per_hour numeric(10, 2) NOT NULL DEFAULT 0 CHECK (salary_per_hour >= 0);
ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS agri_env_per_ha numeric(10, 2) NOT NULL DEFAULT 0 CHECK (agri_env_per_ha >= 0);
ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS young_farmers_per_ha numeric(10, 2) NOT NULL DEFAULT 0 CHECK (young_farmers_per_ha >= 0);
-- Area the redistributive payment is computed on, when it differs from the cropped area.
ALTER TABLE farm_overheads ADD COLUMN IF NOT EXISTS total_ha_for_redistribution numeric(10, 2) CHECK (total_ha_for_redistribution >= 0);

-- A field's own lease; without it the farm's lease per ha applies.
ALTER TABLE fields ADD COLUMN IF NOT EXISTS lease_per_ha numeric(10, 2) CHECK (lease_per_ha >= 0);

CREATE TABLE IF NOT EXISTS crop_benchmarks (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crop_id                 uuid NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  name                    text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  yield_t_ha              numeric(8, 2),
  revenue_per_ha          numeric(12, 2),
  direct_costs_per_ha     numeric(12, 2),
  variable_costs_per_ha   numeric(12, 2),
  db1_per_ha              numeric(12, 2),
  db2_per_ha              numeric(12, 2),
  source                  text CHECK (length(source) <= 500),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, crop_id)
);
ALTER TABLE crop_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crop_benchmarks_tenant ON crop_benchmarks;
CREATE POLICY crop_benchmarks_tenant ON crop_benchmarks FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crop_benchmarks TO agmeo_app;

-- Weekly market quotes (EUR/t), public data written by the worker.
CREATE TABLE IF NOT EXISTS market_quotes (
  commodity   text NOT NULL,
  country     char(2) NOT NULL,
  quote_date  date NOT NULL,
  price       numeric(10, 2) NOT NULL CHECK (price > 0),
  source      text NOT NULL DEFAULT 'eu_agrifood',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (commodity, country, quote_date)
);
GRANT SELECT ON market_quotes TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON market_quotes TO agmeo_jobs;
