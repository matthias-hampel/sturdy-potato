UPDATE crops SET bsa_species_code = NULL
WHERE organization_id IS NULL
  AND code IN ('winter_oats', 'spring_rapeseed', 'alfalfa', 'cc_mustard', 'cc_phacelia', 'cc_oil_radish', 'cc_winter_rye');
UPDATE crops SET bsa_species_code = 'DI' WHERE organization_id IS NULL AND code = 'winter_spelt';
