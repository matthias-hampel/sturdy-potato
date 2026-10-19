-- Voice drafts (agmeo VoiceDrafts, cron/voice-transcription): a dictation recorded in the app, or
-- typed, is transcribed by the configured speech-to-text service and parsed into a draft operation
-- that the user reviews. Confirming links the operation created from it.
CREATE TABLE IF NOT EXISTS voice_drafts (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('audio', 'text')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'transcribing', 'draft', 'confirmed', 'rejected', 'failed')),
  -- Recording in object storage (orgs/<orgId>/voice/<id>).
  audio_key        text,
  audio_mime       text,
  audio_bytes      integer CHECK (audio_bytes >= 0),
  duration_sec     numeric(8, 2) CHECK (duration_sec >= 0),
  transcript       text CHECK (length(transcript) <= 20000),
  -- The OperationDraft contract (16 keys) and what it resolved to in the organization.
  draft            jsonb,
  resolved         jsonb,
  missing          jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence       text CHECK (confidence IN ('high', 'medium', 'low')),
  error            text,
  operation_id     uuid REFERENCES operations (id) ON DELETE SET NULL,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid
);
CREATE INDEX IF NOT EXISTS voice_drafts_org_created_idx ON voice_drafts (organization_id, created_at DESC);

ALTER TABLE voice_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_drafts_tenant ON voice_drafts;
CREATE POLICY voice_drafts_tenant ON voice_drafts FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_drafts TO agmeo_app;

-- The transcription job (agmeo_jobs) works on all drafts and matches field and product names.
DROP POLICY IF EXISTS voice_drafts_jobs ON voice_drafts;
CREATE POLICY voice_drafts_jobs ON voice_drafts FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON voice_drafts TO agmeo_jobs;
GRANT SELECT (id, organization_id, name, status) ON fields TO agmeo_jobs;
DROP POLICY IF EXISTS fields_jobs_voice_read ON fields;
CREATE POLICY fields_jobs_voice_read ON fields FOR SELECT TO agmeo_jobs USING (true);
GRANT SELECT (id, organization_id, name, category, base_unit, archived_at) ON products TO agmeo_jobs;
DROP POLICY IF EXISTS products_jobs_voice_read ON products;
CREATE POLICY products_jobs_voice_read ON products FOR SELECT TO agmeo_jobs USING (true);
