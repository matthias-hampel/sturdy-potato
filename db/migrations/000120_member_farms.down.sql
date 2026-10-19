DO $$
DECLARE
  t text;
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS farms_member_scope ON farms';
  FOREACH t IN ARRAY ARRAY['fields', 'equipment', 'n170_inputs', 'operations', 'storage_locations', 'tasks', 'recommendations'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_farm_scope', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'cost_entries', 'crop_cycles', 'emission_entries', 'field_annotations', 'field_carbon_soil', 'field_crop_rotations',
    'field_documents', 'field_geometry_versions', 'field_group_members', 'field_imagery_jobs',
    'field_observations', 'field_parts', 'field_rasters', 'maize_dmc_calibrations', 'maize_dmc_harvest_detections',
    'maize_dmc_runs', 'maize_dmc_satellite_status', 'operation_fields', 'productivity_analyses', 'recommendations',
    'soil_samples', 'soil_zonations', 'tasks', 'vra_maps', 'yield_map_sources', 'yield_rasters', 'zoning_jobs', 'zonings'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_field_scope', t);
    END IF;
  END LOOP;
END
$$;
DROP FUNCTION IF EXISTS app.allowed_field_ids();
DROP FUNCTION IF EXISTS app.allowed_farm_ids();
DROP TABLE IF EXISTS membership_farms;
ALTER TABLE memberships DROP COLUMN IF EXISTS restricted_to_farms;
