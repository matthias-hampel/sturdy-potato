-- Varieties of the EU Common Catalogue of agricultural plant species (Directive 2002/53/EC).
--
-- Seed of a variety listed in any member state may be marketed in Germany, so the catalogue
-- adds varieties that the Bundessortenamt never approved (many maize, sunflower and soybean
-- hybrids). Refreshed by the same job as the BSA catalogue (`pnpm sync:bsa`, role agmeo_refdata)
-- from the Commission's EU Plant Variety Portal, © European Union, reused under CC BY 4.0.
-- One row per variety and species, aggregated over the national registrations.

-- EUPVP (UPOV) species code of the crop, e.g. ZEAAA_MAY_GMA for maize.
-- Species the BSA splits into winter and spring forms (wheat, barley, rye, triticale, oats,
-- rapeseed) stay unmapped: the EU catalogue does not tell the forms apart.
ALTER TABLE crops ADD COLUMN eu_species_code text;

UPDATE crops SET eu_species_code = m.code
FROM (VALUES
  ('grain_maize', 'ZEAAA_MAY_GMA'),
  ('silage_maize', 'ZEAAA_MAY_GMA'),
  ('sunflower', 'HLNTS_ANN'),
  ('soybeans', 'GLYCI_MAX'),
  ('sugar_beet', 'BETAA_VUL_GVS'),
  ('potatoes', 'SOLAN_TUB'),
  ('field_beans', 'VICIA_FAB_MIN'),
  ('peas', 'PISUM_SAT'),
  ('alfalfa', 'MEDIC_SAT'),
  ('winter_spelt', 'TRITI_AES_SPE'),
  ('cc_mustard', 'SINAP_ALB'),
  ('cc_phacelia', 'PHACE_TAN'),
  ('cc_oil_radish', 'RAPHA_SAT_OLE')
) AS m (crop_code, code)
WHERE crops.organization_id IS NULL AND crops.code = m.crop_code;

CREATE TABLE eu_species (
  code            text PRIMARY KEY,
  botanical_name  text NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eu_varieties (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  species_code      text NOT NULL REFERENCES eu_species (code) ON DELETE CASCADE,
  name              text NOT NULL,
  -- Countries with a current registration (EUPVP codes: EL = Greece, XI = Northern Ireland).
  -- Empty once every registration has ended.
  countries         text[] NOT NULL DEFAULT '{}',
  -- Earliest national registration.
  registered_on     date,
  -- Latest end of the marketing extension after a registration ended.
  marketable_until  date,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (species_code, name)
);

ALTER TABLE crop_varieties
  ADD COLUMN eu_variety_id uuid REFERENCES eu_varieties (id) ON DELETE SET NULL;

GRANT SELECT ON eu_species, eu_varieties TO agmeo_app;

GRANT SELECT (eu_species_code) ON crops TO agmeo_refdata;
GRANT SELECT, INSERT, UPDATE, DELETE ON eu_species, eu_varieties TO agmeo_refdata;
