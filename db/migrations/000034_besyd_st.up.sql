-- webBESyD (Brandenburg, Sachsen, Sachsen-Anhalt, Thüringen) and the Sachsen-Anhalt
-- Mitteilungspflicht identify a farm by the 12-digit Betriebsnummer (Land key 12, 14, 15 or 16 +
-- 10 digits); ENNI and ENDO use the 15-digit 276… number in holding_number. The format-specific
-- master data (Berechnungsgrundlage, Boden-Klima-Raum, Amt, Landkreis, Bewirtschaftung, crop and
-- fertilizer code overrides per format) is kept in farms.regulatory under "besyd" and "st",
-- next to "enni" and "endo".

ALTER TABLE farms
  ADD COLUMN IF NOT EXISTS eu_holding_number text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'farms_eu_holding_number_check') THEN
    ALTER TABLE farms ADD CONSTRAINT farms_eu_holding_number_check CHECK (eu_holding_number ~ '^[0-9]{12}$');
  END IF;
END $$;

COMMENT ON COLUMN farms.eu_holding_number IS '12-digit Betriebsnummer for webBESyD and the Sachsen-Anhalt Mitteilungspflicht';
