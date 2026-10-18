-- A variable-rate map can belong to an operation: the zone rates of its input lines, set in
-- the zone-specific optimization of a crop. One map per operation; deleting the operation
-- keeps the map as a free-standing one.

ALTER TABLE vra_maps ADD COLUMN IF NOT EXISTS operation_id uuid;
ALTER TABLE vra_maps DROP CONSTRAINT IF EXISTS vra_maps_operation_fk;
ALTER TABLE vra_maps ADD CONSTRAINT vra_maps_operation_fk
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE SET NULL (operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS vra_maps_operation_idx ON vra_maps (operation_id) WHERE operation_id IS NOT NULL;
