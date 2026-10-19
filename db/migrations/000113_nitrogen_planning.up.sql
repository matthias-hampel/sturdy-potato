-- agmeo N model per crop and fertilization strategies (reference CultivationsFertPlanning and
-- FertilizationStrategies on the nitrogen page).
--
-- n_planning keeps the farmer's values of the agmeo N balance (Nmin, spring mineralisation,
-- leaching and gaseous losses, target Nmin after harvest; null = model or estimate) and the
-- strategy last applied. A strategy splits the N need into up to three doses by percentage, each
-- with a fertilizer; public strategies (organization_id null) have no product and every
-- organization sees them.

CREATE TABLE IF NOT EXISTS fertilization_strategies (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid REFERENCES organizations (id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  split_percentages  smallint[] NOT NULL CHECK (cardinality(split_percentages) BETWEEN 1 AND 3),
  -- One product per dose (null = chosen when applying); own strategies only.
  product_ids        uuid[] NOT NULL DEFAULT '{}',
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fertilization_strategies_name_idx ON fertilization_strategies (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
ALTER TABLE fertilization_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fertilization_strategies_read ON fertilization_strategies;
CREATE POLICY fertilization_strategies_read ON fertilization_strategies FOR SELECT TO agmeo_app
  USING (organization_id IS NULL OR organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS fertilization_strategies_write ON fertilization_strategies;
CREATE POLICY fertilization_strategies_write ON fertilization_strategies FOR ALL TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON fertilization_strategies TO agmeo_app;

-- The reference's three public strategies (its seeds use calcium ammonium nitrate).
INSERT INTO fertilization_strategies (id, organization_id, name, split_percentages) VALUES
  ('00000000-0000-7000-8000-000000000001', NULL, '2 Gaben 30/70', '{30,70}'),
  ('00000000-0000-7000-8000-000000000002', NULL, '1 Gabe 100', '{100}'),
  ('00000000-0000-7000-8000-000000000003', NULL, '3 Gaben 40/35/25', '{40,35,25}')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crop_cycle_n_planning (
  crop_cycle_id      uuid PRIMARY KEY,
  organization_id    uuid NOT NULL,
  n_min              numeric(6, 1) CHECK (n_min BETWEEN 0 AND 1000),
  n_mineralization   numeric(6, 1) CHECK (n_mineralization BETWEEN 0 AND 1000),
  n_leaching         numeric(6, 1) CHECK (n_leaching BETWEEN 0 AND 1000),
  n_residual         numeric(6, 1) CHECK (n_residual BETWEEN 0 AND 1000),
  strategy_id        uuid REFERENCES fertilization_strategies (id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);
ALTER TABLE crop_cycle_n_planning ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crop_cycle_n_planning_tenant ON crop_cycle_n_planning;
CREATE POLICY crop_cycle_n_planning_tenant ON crop_cycle_n_planning FOR ALL TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crop_cycle_n_planning TO agmeo_app;
