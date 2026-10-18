DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS file_folders;
ALTER TABLE organizations DROP COLUMN IF EXISTS storage_limit_bytes;
