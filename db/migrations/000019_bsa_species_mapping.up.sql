-- BSA species for the crops added with cultivation planning (000014). Winter spelt pointed at
-- 'DI', which the BSA does not use; its code is SPW (Winterspelz, Winterdinkel).
-- Lupins stay unmapped: the BSA registers blue, yellow and white lupin as separate species.

UPDATE crops SET bsa_species_code = m.code
FROM (VALUES
  ('winter_spelt', 'SPW'),
  ('winter_oats', 'HAW'),
  ('spring_rapeseed', 'RAS'),
  ('alfalfa', 'LUZ'),
  ('cc_mustard', 'SF'),
  ('cc_phacelia', 'PHA'),
  ('cc_oil_radish', 'OR'),
  ('cc_winter_rye', 'RW')
) AS m (crop_code, code)
WHERE crops.organization_id IS NULL AND crops.code = m.crop_code;
