DROP TABLE IF EXISTS comments;
DROP INDEX IF EXISTS tasks_updated_idx;
ALTER TABLE tasks DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_priority_check;
ALTER TABLE operations DROP COLUMN IF EXISTS due_on, DROP COLUMN IF EXISTS priority;
