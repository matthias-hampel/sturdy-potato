DROP FUNCTION IF EXISTS app.psm_crop_ancestors(text);
DROP TABLE IF EXISTS psm_codes;
DROP TABLE IF EXISTS psm_crop_groups;
DROP TABLE IF EXISTS psm_uses;
DROP TABLE IF EXISTS psm_products;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_catalogue_entry_fkey;
DROP TABLE IF EXISTS fertilizer_catalogue;
ALTER TABLE products
  DROP COLUMN IF EXISTS catalogue_entry_id,
  DROP COLUMN IF EXISTS fertilizer_type,
  DROP COLUMN IF EXISTS density_t_m3,
  DROP COLUMN IF EXISTS dry_matter_pct,
  DROP COLUMN IF EXISTS cao_pct,
  DROP COLUMN IF EXISTS mgo_pct,
  DROP COLUMN IF EXISTS nh4_n_pct;
