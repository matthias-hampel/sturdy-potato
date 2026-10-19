-- Files: an organization's documents in nested folders, with a trash.
--
-- The bytes live in object storage under `storage_key`; rows hold names, folders and
-- metadata. Deleting moves a file or folder subtree to the trash (deleted_at); emptying
-- the trash deletes the rows and queues the objects for removal. System folders (imports,
-- exports, application maps, reports, soil) are ordinary folders that the app finds by
-- `system_key` and recreates when the user has deleted them.

CREATE TABLE IF NOT EXISTS file_folders (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id       uuid,
  name            text NOT NULL CHECK (length(trim(name)) > 0 AND name !~ '[/\\]'),
  system_key      text,
  deleted_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, parent_id) REFERENCES file_folders (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS file_folders_system_key_idx ON file_folders (organization_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS file_folders_parent_idx ON file_folders (organization_id, parent_id);

CREATE TABLE IF NOT EXISTS files (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id       uuid,
  name            text NOT NULL CHECK (length(trim(name)) > 0 AND name !~ '[/\\]'),
  -- Harvest year the document belongs to (editable; uploads take the selected season's).
  year            smallint CHECK (year BETWEEN 1900 AND 2200),
  description     text,
  mime_type       text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key     text NOT NULL UNIQUE,
  deleted_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, folder_id) REFERENCES file_folders (organization_id, id) ON DELETE SET NULL (folder_id)
);
CREATE INDEX IF NOT EXISTS files_folder_idx ON files (organization_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS files_trash_idx ON files (organization_id) WHERE deleted_at IS NOT NULL;
DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Storage allowance per organization; NULL uses the deployment default (STORAGE_DEFAULT_LIMIT_GB).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS storage_limit_bytes bigint CHECK (storage_limit_bytes >= 0);

ALTER TABLE file_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS file_folders_tenant ON file_folders;
CREATE POLICY file_folders_tenant ON file_folders FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS files_tenant ON files;
CREATE POLICY files_tenant ON files FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON file_folders, files TO agmeo_app;
