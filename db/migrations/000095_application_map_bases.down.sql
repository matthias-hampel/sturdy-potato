DELETE FROM vra_map_inputs WHERE unit = 'plants/ha';
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_unit_check;
ALTER TABLE vra_map_inputs ADD CONSTRAINT vra_map_inputs_unit_check CHECK (unit IN ('seeds/ha', 'kg/ha', 'l/ha'));
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_strategy_check;
ALTER TABLE vra_map_inputs DROP CONSTRAINT IF EXISTS vra_map_inputs_germination_pct_check;
ALTER TABLE vra_map_inputs DROP COLUMN IF EXISTS strategy;
ALTER TABLE vra_map_inputs DROP COLUMN IF EXISTS germination_pct;
DROP INDEX IF EXISTS vra_maps_batch_idx;
DROP INDEX IF EXISTS vra_maps_org_idx;
ALTER TABLE vra_maps DROP COLUMN IF EXISTS batch_id;

DROP TABLE IF EXISTS zoning_jobs;

DROP POLICY IF EXISTS zoning_zones_base_write ON zoning_zones;
DROP POLICY IF EXISTS zonings_base_update ON zonings;
DROP POLICY IF EXISTS zonings_base_delete ON zonings;
DROP POLICY IF EXISTS zonings_base_write ON zonings;
REVOKE UPDATE (name, is_default, listed) ON zonings FROM agmeo_app;

-- Maps on these zonings go with them (vra_maps cascades from zonings).
DELETE FROM zonings WHERE source IN ('soil', 'upload', 'satellite', 'manual', 'uniform');
DELETE FROM zonings WHERE zone_count NOT BETWEEN 2 AND 7;
ALTER TABLE zoning_zones DROP CONSTRAINT IF EXISTS zoning_zones_zone_no_check;
ALTER TABLE zoning_zones ADD CONSTRAINT zoning_zones_zone_no_check CHECK (zone_no BETWEEN 1 AND 7);
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_zone_count_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_zone_count_check CHECK (zone_count BETWEEN 2 AND 7);
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_source_check;
ALTER TABLE zonings ADD CONSTRAINT zonings_source_check CHECK (source IN ('productivity', 'yield_map', 'yield_estimate'));

DROP INDEX IF EXISTS zonings_field_idx;
DROP INDEX IF EXISTS zonings_default_idx;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_name_check;
ALTER TABLE zonings DROP CONSTRAINT IF EXISTS zonings_created_by_fkey;
ALTER TABLE zonings DROP COLUMN IF EXISTS created_by;
ALTER TABLE zonings DROP COLUMN IF EXISTS listed;
ALTER TABLE zonings DROP COLUMN IF EXISTS is_default;
ALTER TABLE zonings DROP COLUMN IF EXISTS name;
