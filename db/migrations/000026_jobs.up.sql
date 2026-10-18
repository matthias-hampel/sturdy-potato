-- Background jobs: a Postgres queue the worker claims with FOR UPDATE SKIP LOCKED.
--
-- The API enqueues jobs in the same transaction as the change that needs them (an
-- invitation e-mail with its membership), so a rolled-back change never sends anything.
-- Schedules enqueue one job per time slot; the unique (kind, dedupe_key) index makes that
-- idempotent when several workers run.
--
-- Jobs run as agmeo_jobs, a NOLOGIN role that sees tenant data only through policies
-- granted to it table by table, like agmeo_geo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_jobs') THEN
    CREATE ROLE agmeo_jobs NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public, app TO agmeo_jobs;

CREATE TABLE IF NOT EXISTS jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  payload         jsonb NOT NULL DEFAULT '{}',
  dedupe_key      text,
  run_at          timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  locked_until    timestamptz,
  last_error      text,
  finished_at     timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (kind, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (run_at) WHERE finished_at IS NULL AND failed_at IS NULL;

-- The API may only enqueue; the worker owns the queue. ON CONFLICT needs to read the
-- conflict columns, nothing else.
GRANT INSERT ON jobs TO agmeo_app;
GRANT SELECT (kind, dedupe_key) ON jobs TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO agmeo_jobs;

-- What jobs read for e-mails: recipients, their language and the organization name.
GRANT EXECUTE ON FUNCTION app.current_user_id() TO agmeo_jobs;
GRANT SELECT (id, email, display_name, locale) ON users TO agmeo_jobs;
GRANT SELECT (id, name, country) ON organizations TO agmeo_jobs;
DROP POLICY IF EXISTS users_jobs_read ON users;
CREATE POLICY users_jobs_read ON users FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS organizations_jobs_read ON organizations;
CREATE POLICY organizations_jobs_read ON organizations FOR SELECT TO agmeo_jobs USING (true);
