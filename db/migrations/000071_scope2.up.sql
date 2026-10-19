-- Scope 2 of the greenhouse-gas balance: purchased electricity and heat in kWh per organization,
-- harvest year and kind, with the emissions at the factor that applied when it was entered (agmeo
-- Scope2Entries). The factors are those of the calculation parameters (UBA 2018, BAFA 2025).
CREATE TABLE IF NOT EXISTS scope2_entries (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  harvest_year    smallint NOT NULL CHECK (harvest_year BETWEEN 1990 AND 2200),
  kind            text NOT NULL CHECK (kind IN ('electricityGrid', 'electricityRenewable', 'heatingHeizoelDiesel', 'heatingErdgas',
                                                 'heatingFluessiggas', 'heatingBiogas', 'heatingPellets', 'heatingBiomasseHolz',
                                                 'heatingNahFernwaerme')),
  kwh             numeric(14, 2) NOT NULL CHECK (kwh > 0),
  kg_co2e         numeric(14, 3) NOT NULL,
  -- Parameter id and value used, so a later factor change does not rewrite past years silently.
  parameter_id    text NOT NULL,
  factor          numeric(10, 5) NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  PRIMARY KEY (organization_id, harvest_year, kind)
);
ALTER TABLE scope2_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scope2_entries_tenant ON scope2_entries;
CREATE POLICY scope2_entries_tenant ON scope2_entries FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON scope2_entries TO agmeo_app;
