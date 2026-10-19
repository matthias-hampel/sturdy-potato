DROP POLICY IF EXISTS products_jobs_voice_read ON products;
REVOKE SELECT (id, organization_id, name, category, base_unit, archived_at) ON products FROM agmeo_jobs;
DROP POLICY IF EXISTS fields_jobs_voice_read ON fields;
REVOKE SELECT (id, organization_id, name, status) ON fields FROM agmeo_jobs;
DROP TABLE IF EXISTS voice_drafts;
