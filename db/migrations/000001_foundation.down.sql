DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS audit_events;
DROP POLICY IF EXISTS users_select ON users;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS users;
DROP SCHEMA IF EXISTS app CASCADE;
-- Roles and extensions are cluster-level and may be shared; they are intentionally kept.
