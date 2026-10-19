-- Notes drawn on a satellite scene of a field: marker, freehand line, polygon or rectangle with a
-- colour and an optional text, per acquisition date (agmeo SpatialAnnotations).
CREATE TABLE IF NOT EXISTS field_annotations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id        uuid NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
  observed_on     date NOT NULL,
  source          text NOT NULL DEFAULT 'satellite' CHECK (source IN ('satellite')),
  layer           text,
  kind            text NOT NULL CHECK (kind IN ('marker', 'freehand', 'polygon', 'rectangle')),
  color           text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  note            text CHECK (char_length(note) <= 500),
  geometry        geometry(Geometry, 4326) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_annotations_field_idx ON field_annotations (field_id, observed_on);
ALTER TABLE field_annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_annotations_tenant ON field_annotations;
CREATE POLICY field_annotations_tenant ON field_annotations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON field_annotations TO agmeo_app;
