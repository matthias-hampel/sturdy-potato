-- Local development only. Creates the login roles the services connect with.
-- Production creates equivalent login roles out of band (secrets manager / IaC)
-- and grants them membership in the NOLOGIN roles defined by the migrations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_app') THEN
    CREATE ROLE agmeo_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_outbox_relay') THEN
    CREATE ROLE agmeo_outbox_relay NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_geo') THEN
    CREATE ROLE agmeo_geo NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_refdata') THEN
    CREATE ROLE agmeo_refdata NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_recommender') THEN
    CREATE ROLE agmeo_recommender NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_jobs') THEN
    CREATE ROLE agmeo_jobs NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_api') THEN
    CREATE ROLE agmeo_api LOGIN PASSWORD 'agmeo_api' IN ROLE agmeo_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_worker') THEN
    CREATE ROLE agmeo_worker LOGIN PASSWORD 'agmeo_worker' IN ROLE agmeo_outbox_relay;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_jobs_worker') THEN
    CREATE ROLE agmeo_jobs_worker LOGIN PASSWORD 'agmeo_jobs_worker' IN ROLE agmeo_jobs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_geo_worker') THEN
    CREATE ROLE agmeo_geo_worker LOGIN PASSWORD 'agmeo_geo_worker' IN ROLE agmeo_geo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_recommender_worker') THEN
    CREATE ROLE agmeo_recommender_worker LOGIN PASSWORD 'agmeo_recommender_worker' IN ROLE agmeo_recommender;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_refdata_sync') THEN
    CREATE ROLE agmeo_refdata_sync LOGIN PASSWORD 'agmeo_refdata_sync' IN ROLE agmeo_refdata;
  END IF;
END
$$;
