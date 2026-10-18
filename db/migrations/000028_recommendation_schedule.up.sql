-- Scheduled field recommendations: the worker recalculates every organization's
-- recommendations each morning and after relevant changes, without a signed-in user.
--
-- It connects with its own login role, a member of agmeo_recommender. That role acts for
-- one organization at a time through the ordinary tenant policies: app.org_id() accepts
-- `app.organization_id` without a membership only for agmeo_recommender sessions that set
-- no user, so no service user or membership is needed and recommendation_runs.created_by
-- stays NULL. Grants keep it to reading what the rule set needs and writing recommendations.
--
-- Migration numbers 000026/000027 are used on feat/parity-phase0 (jobs, locale units).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_recommender') THEN
    CREATE ROLE agmeo_recommender NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, app TO agmeo_recommender;

-- Organization of the current request: a member's organization, or, for a
-- recommender session without a user, any active organization it names.
CREATE OR REPLACE FUNCTION app.org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.organization_id
  FROM memberships m
  WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND m.user_id = app.current_user_id()
    AND m.status IN ('active', 'invited')
  UNION ALL
  SELECT o.id
  FROM organizations o
  WHERE o.id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND o.status = 'active'
    AND app.current_user_id() IS NULL
    AND pg_has_role(session_user, 'agmeo_recommender', 'MEMBER')
$$;

-- What the scheduler needs to decide which organizations are due, across tenants:
-- open main crop cycles on active fields and the time of the latest run of any kind.
CREATE OR REPLACE FUNCTION app.recommendation_schedule()
RETURNS TABLE (organization_id uuid, open_cycles integer, last_run_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id,
         (SELECT count(*)::int
            FROM crop_cycles cc JOIN fields f ON f.id = cc.field_id
           WHERE cc.organization_id = o.id AND cc.role = 'main'
             AND cc.status IN ('planned', 'active') AND f.status = 'active'),
         (SELECT max(r.generated_at) FROM recommendation_runs r WHERE r.organization_id = o.id)
  FROM organizations o
  WHERE o.status = 'active'
  ORDER BY o.id
$$;

REVOKE ALL ON FUNCTION app.org_id(), app.recommendation_schedule() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_id(), app.current_user_id() TO agmeo_recommender;
GRANT EXECUTE ON FUNCTION app.recommendation_schedule() TO agmeo_recommender;
GRANT EXECUTE ON FUNCTION app.psm_crop_ancestors(text) TO agmeo_recommender;

-- Facts of the rule set (calendar, crops, N balance, PSM checks, NDVI, zones, farm location).
GRANT SELECT ON
  growing_seasons, farms, fields, field_parts, field_geometry_versions, field_current_geometry,
  crops, crop_cycles, harvests, operations, operation_fields, operation_inputs, products,
  vra_maps, field_observations, productivity_analyses, zonings, zoning_zones,
  soil_samples, fertilizer_need_records, nmin_reference_values,
  psm_products, psm_uses, psm_codes, psm_crop_groups
TO agmeo_recommender;
-- Author names of N need records (the users policy, which reads memberships, limits them to
-- the organization's members).
GRANT SELECT (id, display_name) ON users TO agmeo_recommender;
GRANT SELECT (organization_id, user_id) ON memberships TO agmeo_recommender;
GRANT SELECT, INSERT, UPDATE ON recommendation_runs, recommendations TO agmeo_recommender;
