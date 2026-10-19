REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agmeo_recommender;
DROP FUNCTION IF EXISTS app.recommendation_schedule();

CREATE OR REPLACE FUNCTION app.org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.organization_id
  FROM memberships m
  WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND m.user_id = app.current_user_id()
    AND m.status IN ('active', 'invited')
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_recommender') THEN
    REVOKE ALL ON FUNCTION app.org_id(), app.current_user_id(), app.psm_crop_ancestors(text) FROM agmeo_recommender;
    REVOKE USAGE ON SCHEMA public, app FROM agmeo_recommender;
    -- The login role of the worker is created outside the migrations.
    DROP ROLE IF EXISTS agmeo_recommender;
  END IF;
END
$$;
