-- Farm-restricted members (000120), continued: tables keyed by crop cycle and the tables added by
-- branches merged after it. Re-run safely after new tables appear; missing tables are skipped.

-- Crop cycles on the member's fields; NULL when not restricted.
CREATE OR REPLACE FUNCTION app.allowed_crop_cycle_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN a.ids IS NULL THEN NULL
         ELSE coalesce((SELECT array_agg(c.id) FROM crop_cycles c WHERE c.field_id = ANY (a.ids)), '{}') END
  FROM (SELECT app.allowed_field_ids() AS ids) a
$$;
GRANT EXECUTE ON FUNCTION app.allowed_crop_cycle_ids() TO PUBLIC;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crop_cycle_bbch_calibrations', 'crop_cycle_n_planning', 'disease_risk_days', 'disease_risk_state', 'esm_runs',
    'fertilizer_need_records', 'harvests', 'maize_dmc_cycle_settings', 'yield_zone_yields'
  ] LOOP
    IF to_regclass(t) IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'crop_cycle_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_cycle_scope', t);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
        USING (crop_cycle_id IS NULL OR (SELECT app.allowed_crop_cycle_ids()) IS NULL OR crop_cycle_id = ANY ((SELECT app.allowed_crop_cycle_ids())::uuid[]))
        WITH CHECK (crop_cycle_id IS NULL OR (SELECT app.allowed_crop_cycle_ids()) IS NULL OR crop_cycle_id = ANY ((SELECT app.allowed_crop_cycle_ids())::uuid[]))',
        t || '_cycle_scope', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['cadastral_parcels'] LOOP
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
