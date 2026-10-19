-- Warehouse details, prices per year and more product master data.
--
-- The stock ledger stays append-only: a booking is voided by a compensating `void` movement
-- that points at it, never by changing or deleting it. Manual outflows (sales, transfers
-- off the farm) are `issue` movements.

-- Harvested goods can be stocked like any other product.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
  CHECK (category IN ('seed', 'fertilizer', 'crop_protection', 'fuel', 'consumable', 'harvest', 'other'));
-- Humus effect (kg humus-C per t or m³ of fresh mass, VDLUFA) and the nitrogen effectiveness in
-- the year of application (% of total N), for organic fertilizers.
ALTER TABLE products ADD COLUMN IF NOT EXISTS humus_c_kg_per_t numeric(10, 3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS n_effectiveness_pct numeric(5, 2) CHECK (n_effectiveness_pct BETWEEN 0 AND 100);
-- Manufacturer's page and a datasheet stored in the files.
ALTER TABLE products ADD COLUMN IF NOT EXISTS website text CHECK (length(website) <= 500);
ALTER TABLE products ADD COLUMN IF NOT EXISTS datasheet_file_id uuid;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_datasheet_fk;
ALTER TABLE products ADD CONSTRAINT products_datasheet_fk
  FOREIGN KEY (organization_id, datasheet_file_id) REFERENCES files (organization_id, id) ON DELETE SET NULL (datasheet_file_id);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('receipt', 'issue', 'adjustment', 'consumption', 'reversal', 'void'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_number text CHECK (length(lot_number) <= 100);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS expiry_date date;
-- Supplier of a receipt or buyer of an issue.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS counterparty text CHECK (length(counterparty) <= 200);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS invoice_number text CHECK (length(invoice_number) <= 100);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS total_price numeric(14, 2) CHECK (total_price >= 0);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 2) CHECK (vat_rate BETWEEN 0 AND 100);
-- A void cancels exactly one manual booking, once.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS voids_movement_id uuid REFERENCES stock_movements(id);
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_void_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_void_check CHECK ((kind = 'void') = (voids_movement_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_void_once_idx ON stock_movements (voids_movement_id) WHERE voids_movement_id IS NOT NULL;
-- A harvest booked into stock.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS harvest_id uuid;
ALTER TABLE harvests ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE harvests DROP CONSTRAINT IF EXISTS harvests_product_fk;
ALTER TABLE harvests ADD CONSTRAINT harvests_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id);

-- Price per base unit of a product in a year. `warehouse` prices follow the priced receipts of
-- the year (weighted average); a `manual` price is the farm's own and is not overwritten.
CREATE TABLE IF NOT EXISTS product_prices (
  organization_id uuid NOT NULL,
  product_id      uuid NOT NULL,
  year            smallint NOT NULL CHECK (year BETWEEN 1990 AND 2200),
  price           numeric(14, 4) NOT NULL CHECK (price >= 0),
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'warehouse')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, product_id, year),
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE CASCADE
);
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_prices_tenant ON product_prices;
CREATE POLICY product_prices_tenant ON product_prices FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON product_prices TO agmeo_app;

-- Price per base unit of a product for a year: the year's price, else the latest earlier year's,
-- else the product's default. Runs as the caller, so row-level security applies.
CREATE OR REPLACE FUNCTION app.product_price(p_product uuid, p_year integer) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT pp.price FROM product_prices pp WHERE pp.product_id = p_product AND pp.year <= p_year ORDER BY pp.year DESC LIMIT 1),
    (SELECT p.unit_cost FROM products p WHERE p.id = p_product))
$$;
GRANT EXECUTE ON FUNCTION app.product_price(uuid, integer) TO agmeo_app;
