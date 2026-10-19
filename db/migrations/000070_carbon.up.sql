-- Carbon: the organization's NUTS 2 region for the regional reference of the CO2 analysis, and
-- the topsoil values the RothC humus model (Thünen AgriGHG tool) needs per field. The reference
-- app kept the region in the organization's metadata and the topsoil values as a soil sample;
-- here they get their own tables so the soil-sampling module stays independent.
CREATE TABLE IF NOT EXISTS carbon_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  nuts2_code      text CHECK (nuts2_code ~ '^DE[0-9A-G][0-9]$'),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

CREATE TABLE IF NOT EXISTS field_carbon_soil (
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  depth_cm        smallint NOT NULL DEFAULT 30 CHECK (depth_cm BETWEEN 1 AND 100),
  bulk_density    numeric(4, 2) NOT NULL CHECK (bulk_density BETWEEN 0.5 AND 2),
  clay_pct        numeric(5, 2) NOT NULL CHECK (clay_pct BETWEEN 0 AND 100),
  soc_pct         numeric(5, 2) NOT NULL CHECK (soc_pct BETWEEN 0.1 AND 10),
  sand_pct        numeric(5, 2) NOT NULL CHECK (sand_pct BETWEEN 0 AND 100),
  sampled_on      date,
  -- Lab report or other attachment, kept in the files module.
  file_id         uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  PRIMARY KEY (field_id),
  CHECK (clay_pct + sand_pct <= 100),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id) REFERENCES files (organization_id, id) ON DELETE SET NULL (file_id)
);
CREATE INDEX IF NOT EXISTS field_carbon_soil_org_idx ON field_carbon_soil (organization_id);

ALTER TABLE carbon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_carbon_soil ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carbon_settings_tenant ON carbon_settings;
CREATE POLICY carbon_settings_tenant ON carbon_settings FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS field_carbon_soil_tenant ON field_carbon_soil;
CREATE POLICY field_carbon_soil_tenant ON field_carbon_soil FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON carbon_settings, field_carbon_soil TO agmeo_app;
