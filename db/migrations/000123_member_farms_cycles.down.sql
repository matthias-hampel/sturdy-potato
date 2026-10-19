DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crop_cycle_bbch_calibrations', 'crop_cycle_n_planning', 'disease_risk_days', 'disease_risk_state', 'esm_runs',
    'fertilizer_need_records', 'harvests', 'maize_dmc_cycle_settings', 'yield_zone_yields'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_cycle_scope', t); END IF;
  END LOOP;
  IF to_regclass('cadastral_parcels') IS NOT NULL THEN DROP POLICY IF EXISTS cadastral_parcels_field_scope ON cadastral_parcels; END IF;
END
$$;
DROP FUNCTION IF EXISTS app.allowed_crop_cycle_ids();
