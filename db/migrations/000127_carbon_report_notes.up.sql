-- Text of the CO2 report per organization and harvest year (agmeo Organizations.notes by year,
-- the analysis' report view): the edited summary (null keeps the generated one) and notes.
CREATE TABLE IF NOT EXISTS carbon_report_notes (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  harvest_year    smallint NOT NULL CHECK (harvest_year BETWEEN 1990 AND 2200),
  summary         text CHECK (length(summary) <= 20000),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  PRIMARY KEY (organization_id, harvest_year)
);
ALTER TABLE carbon_report_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carbon_report_notes_tenant ON carbon_report_notes;
CREATE POLICY carbon_report_notes_tenant ON carbon_report_notes FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON carbon_report_notes TO agmeo_app;
