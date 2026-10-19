DROP FUNCTION IF EXISTS app.product_price(uuid, integer);
DROP TABLE IF EXISTS product_prices;
ALTER TABLE harvests DROP CONSTRAINT IF EXISTS harvests_product_fk;
ALTER TABLE harvests DROP COLUMN IF EXISTS product_id;
DROP INDEX IF EXISTS stock_movements_void_once_idx;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_void_check;
ALTER TABLE stock_movements DROP COLUMN IF EXISTS harvest_id, DROP COLUMN IF EXISTS voids_movement_id, DROP COLUMN IF EXISTS vat_rate,
  DROP COLUMN IF EXISTS total_price, DROP COLUMN IF EXISTS invoice_number, DROP COLUMN IF EXISTS counterparty,
  DROP COLUMN IF EXISTS expiry_date, DROP COLUMN IF EXISTS lot_number;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK (kind IN ('receipt', 'adjustment', 'consumption', 'reversal'));
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_datasheet_fk;
ALTER TABLE products DROP COLUMN IF EXISTS datasheet_file_id, DROP COLUMN IF EXISTS website, DROP COLUMN IF EXISTS n_effectiveness_pct, DROP COLUMN IF EXISTS humus_c_kg_per_t;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN ('seed', 'fertilizer', 'crop_protection', 'fuel', 'consumable', 'other'));
