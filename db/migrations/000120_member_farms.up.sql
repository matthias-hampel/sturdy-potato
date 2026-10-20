-- Members restricted to some farms of the organization. A membership with
-- restricted_to_farms = true sees only the farms listed in membership_farms (an empty list
-- means no farm at all), and with them only their fields and what hangs off a field or farm.
-- Enforced by restrictive row-level policies, so every query of the API is limited, not only
-- the screens. Requests without a user (jobs, the satellite worker) are not limited.

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS restricted_to_farms boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS membership_farms (
  organization_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  farm_id         uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, farm_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS membership_farms_farm_idx ON membership_farms (organization_id, farm_id);

ALTER TABLE membership_farms ENABLE ROW LEVEL SECURITY;
-- Members read their own limits in every organization (the organization list of /me), and all
-- limits of the organization they work in; changes need the organization context.
DROP POLICY IF EXISTS membership_farms_select ON membership_farms;
CREATE POLICY membership_farms_select ON membership_farms FOR SELECT
  USING (user_id = app.current_user_id() OR organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS membership_farms_tenant ON membership_farms;
CREATE POLICY membership_farms_tenant ON membership_farms FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON membership_farms TO agmeo_app;

-- Farms the current user may see in the current organization; NULL when not restricted.
-- SECURITY DEFINER: it reads memberships and membership_farms past their own policies.
CREATE OR REPLACE FUNCTION app.allowed_farm_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN m.restricted_to_farms THEN
           coalesce((SELECT array_agg(mf.farm_id) FROM membership_farms mf
                     WHERE mf.organization_id = m.organization_id AND mf.user_id = m.user_id), '{}')
         END
  FROM memberships m
  WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND m.user_id = app.current_user_id()
$$;

-- Fields on those farms; NULL when not restricted.
CREATE OR REPLACE FUNCTION app.allowed_field_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN a.ids IS NULL THEN NULL
         ELSE coalesce((SELECT array_agg(f.id) FROM fields f WHERE f.farm_id = ANY (a.ids)), '{}') END
  FROM (SELECT app.allowed_farm_ids() AS ids) a
$$;

-- Every role that reads tenant tables evaluates the policies below.
GRANT EXECUTE ON FUNCTION app.allowed_farm_ids(), app.allowed_field_ids() TO PUBLIC;

-- Restrictive policies: they narrow the existing tenant policies for restricted members.
DO $$
DECLARE
  t text;
BEGIN
  -- The farms themselves.
  EXECUTE 'DROP POLICY IF EXISTS farms_member_scope ON farms';
  EXECUTE 'CREATE POLICY farms_member_scope ON farms AS RESTRICTIVE FOR ALL
    USING ((SELECT app.allowed_farm_ids()) IS NULL OR id = ANY ((SELECT app.allowed_farm_ids())::uuid[]))
    WITH CHECK ((SELECT app.allowed_farm_ids()) IS NULL OR id = ANY ((SELECT app.allowed_farm_ids())::uuid[]))';

  -- Tables that belong to a farm (farm_id may be NULL for organization-wide rows).
  FOREACH t IN ARRAY ARRAY['fields', 'equipment', 'n170_inputs', 'operations', 'storage_locations', 'tasks', 'recommendations'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_farm_scope', t);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
        USING (farm_id IS NULL OR (SELECT app.allowed_farm_ids()) IS NULL OR farm_id = ANY ((SELECT app.allowed_farm_ids())::uuid[]))
        WITH CHECK (farm_id IS NULL OR (SELECT app.allowed_farm_ids()) IS NULL OR farm_id = ANY ((SELECT app.allowed_farm_ids())::uuid[]))',
        t || '_farm_scope', t);
    END IF;
  END LOOP;

  -- Tables that belong to a field (field_id may be NULL for rows without one).
  FOREACH t IN ARRAY ARRAY[
    'cost_entries', 'crop_cycles', 'emission_entries', 'field_annotations', 'field_carbon_soil', 'field_crop_rotations',
    'field_documents', 'field_geometry_versions', 'field_group_members', 'field_imagery_jobs',
    'field_observations', 'field_parts', 'field_rasters', 'maize_dmc_calibrations', 'maize_dmc_harvest_detections',
    'maize_dmc_runs', 'maize_dmc_satellite_status', 'operation_fields', 'productivity_analyses', 'recommendations',
    'soil_samples', 'soil_zonations', 'tasks', 'vra_maps', 'yield_map_sources', 'yield_rasters', 'zoning_jobs', 'zonings'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_field_scope', t);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
        USING (field_id IS NULL OR (SELECT app.allowed_field_ids()) IS NULL OR field_id = ANY ((SELECT app.allowed_field_ids())::uuid[]))
        WITH CHECK (field_id IS NULL OR (SELECT app.allowed_field_ids()) IS NULL OR field_id = ANY ((SELECT app.allowed_field_ids())::uuid[]))',
        t || '_field_scope', t);
    END IF;
  END LOOP;
END
$$;
