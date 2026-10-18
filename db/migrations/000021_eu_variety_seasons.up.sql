-- EU Common Catalogue varieties for the crops the Bundessortenamt splits into winter and spring
-- forms (wheat, barley, rye, triticale, oats, rapeseed). The EU Plant Variety Portal registers a
-- single species for both forms; its "Season Type" tells them apart for 54 % (triticale) to 95 %
-- (rye) of the varieties and agrees with the BSA's form for 97-100 % of the names both list
-- (export of October 2026; the gaps are mostly French and Italian registrations).

-- Season Type over the variety's national registrations: 'alternative' (sown in autumn or
-- spring), or NULL when no registration states it or they disagree.
ALTER TABLE eu_varieties
  ADD COLUMN season text CHECK (season IN ('winter', 'spring', 'alternative'));

-- Form of the crop within its EU species. A crop with a form lists the EU varieties of that form,
-- the alternative ones and those of unknown form.
ALTER TABLE crops
  ADD COLUMN eu_season text CHECK (eu_season IN ('winter', 'spring')),
  ADD CONSTRAINT crops_eu_season_species CHECK (eu_season IS NULL OR eu_species_code IS NOT NULL);

UPDATE crops SET eu_species_code = m.code, eu_season = m.season
FROM (VALUES
  ('winter_wheat', 'TRITI_AES', 'winter'),
  ('spring_wheat', 'TRITI_AES', 'spring'),
  ('winter_barley', 'HORDE_VUL', 'winter'),
  ('spring_barley', 'HORDE_VUL', 'spring'),
  ('winter_rye', 'SECAL_CER', 'winter'),
  ('cc_winter_rye', 'SECAL_CER', 'winter'),
  ('triticale', 'TRITL', 'winter'),
  ('winter_oats', 'AVENA_SAT', 'winter'),
  ('oats', 'AVENA_SAT', 'spring'),
  ('winter_rapeseed', 'BRASS_NAP_NUS', 'winter'),
  ('spring_rapeseed', 'BRASS_NAP_NUS', 'spring')
) AS m (crop_code, code, season)
WHERE crops.organization_id IS NULL AND crops.code = m.crop_code;
