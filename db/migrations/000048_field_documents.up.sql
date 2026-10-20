-- Documents attached to a field, optionally for one harvest year (agmeo: files linked to a
-- cultivation). The file itself lives in the file store; unlinking keeps it there.
CREATE TABLE IF NOT EXISTS field_documents (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id        uuid NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
  file_id         uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  harvest_year    smallint CHECK (harvest_year BETWEEN 1900 AND 2200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  PRIMARY KEY (field_id, file_id)
);
CREATE INDEX IF NOT EXISTS field_documents_file_idx ON field_documents (file_id);
ALTER TABLE field_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_documents_tenant ON field_documents;
CREATE POLICY field_documents_tenant ON field_documents FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_documents TO agmeo_app;
