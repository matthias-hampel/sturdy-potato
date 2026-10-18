DROP INDEX IF EXISTS cost_entries_once_idx;
ALTER TABLE cost_entries DROP COLUMN IF EXISTS field_part_id;
CREATE UNIQUE INDEX cost_entries_once_idx ON cost_entries (operation_id, completion_seq, source, field_id, category)
  NULLS NOT DISTINCT WHERE operation_id IS NOT NULL;

DROP INDEX IF EXISTS operation_fields_line_idx;
ALTER TABLE operation_fields DROP COLUMN IF EXISTS field_part_id;
ALTER TABLE operation_fields ADD CONSTRAINT operation_fields_operation_id_field_id_key UNIQUE (operation_id, field_id);

ALTER TABLE crop_cycles DROP COLUMN IF EXISTS field_part_id;

DROP TABLE IF EXISTS field_parts;
