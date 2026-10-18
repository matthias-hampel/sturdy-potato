DROP TABLE IF EXISTS field_crop_rotations;
DROP TABLE IF EXISTS crop_rotation_entries;
DROP TABLE IF EXISTS crop_rotations;
ALTER TABLE operations DROP COLUMN IF EXISTS template_step_id;
ALTER TABLE crop_cycles DROP COLUMN IF EXISTS template_id;
DROP TABLE IF EXISTS template_step_inputs;
DROP TABLE IF EXISTS template_steps;
DROP TABLE IF EXISTS cultivation_templates;
ALTER TABLE crop_cycles DROP COLUMN IF EXISTS role;
DELETE FROM crops WHERE organization_id IS NULL AND code IN (
  'winter_spelt', 'winter_oats', 'spring_rapeseed', 'lupins', 'field_grass', 'clover_grass', 'alfalfa',
  'cc_mustard', 'cc_phacelia', 'cc_oil_radish', 'cc_legume_mix', 'cc_winter_rye');
ALTER TABLE crops
  DROP COLUMN IF EXISTS eppo_code,
  DROP COLUMN IF EXISTS default_harvest_md,
  DROP COLUMN IF EXISTS default_sowing_md,
  DROP COLUMN IF EXISTS is_perennial,
  DROP COLUMN IF EXISTS is_legume;
