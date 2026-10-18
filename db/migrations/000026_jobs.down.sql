DROP POLICY IF EXISTS organizations_jobs_read ON organizations;
DROP POLICY IF EXISTS users_jobs_read ON users;
REVOKE ALL ON users, organizations FROM agmeo_jobs;
DROP TABLE IF EXISTS jobs;
