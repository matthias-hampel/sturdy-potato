DROP INDEX vra_maps_operation_idx;
ALTER TABLE vra_maps DROP CONSTRAINT vra_maps_operation_fk;
ALTER TABLE vra_maps DROP COLUMN operation_id;
