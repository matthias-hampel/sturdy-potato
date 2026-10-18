-- Task board: operations carry a priority and a due date (the responsible employee is the
-- assignee), operations and tasks take comments, and deleted tasks leave a tombstone so
-- mobile clients syncing with `since` learn about deletions.

ALTER TABLE operations ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_priority_check;
ALTER TABLE operations ADD CONSTRAINT operations_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE operations ADD COLUMN IF NOT EXISTS due_on date;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks (organization_id, updated_at);

CREATE TABLE IF NOT EXISTS comments (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL CHECK (entity_type IN ('operation', 'task')),
  entity_id       uuid NOT NULL,
  author_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Kept so the comment still shows who wrote it after the author leaves.
  author_name     text NOT NULL,
  body            text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 5000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS comments_entity_idx ON comments (organization_id, entity_type, entity_id, created_at);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_tenant ON comments;
CREATE POLICY comments_tenant ON comments FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE ON comments TO agmeo_app;
