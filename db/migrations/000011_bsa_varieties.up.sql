-- Variety catalogue of the Bundessortenamt (BSA, "Nationale Sorteninformationen").
--
-- Shared reference data, refreshed by the BSA sync job (backend/agmeo-api, `pnpm sync:bsa`).
-- The job connects with its own role (a member of agmeo_refdata) that can write the catalogue
-- tables and read which BSA species the crops map to, but no tenant data.
-- Organizations keep picking varieties into crop_varieties; a pick that matches a catalogue
-- entry is linked to it through crop_varieties.bsa_variety_id.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_refdata') THEN
    CREATE ROLE agmeo_refdata NOLOGIN;
  END IF;
END
$$;

-- BSA "Kennbuchstabe" of the species whose varieties apply to a crop (e.g. WW = Winterweichweizen).
-- Several crops may share a species (grain and silage maize are both M).
ALTER TABLE crops ADD COLUMN bsa_species_code text;

UPDATE crops SET bsa_species_code = m.code
FROM (VALUES
  ('winter_wheat', 'WW'),
  ('spring_wheat', 'WS'),
  ('winter_barley', 'GW'),
  ('spring_barley', 'GS'),
  ('winter_rye', 'RW'),
  ('triticale', 'TIW'),
  ('oats', 'HA'),
  ('winter_rapeseed', 'RAW'),
  ('sunflower', 'SOL'),
  ('grain_maize', 'M'),
  ('silage_maize', 'M'),
  ('sugar_beet', 'ZR'),
  ('potatoes', 'K'),
  ('field_beans', 'BA'),
  ('peas', 'EF'),
  ('soybeans', 'SJ')
) AS m (crop_code, code)
WHERE crops.organization_id IS NULL AND crops.code = m.crop_code;

CREATE TABLE bsa_species (
  code            text PRIMARY KEY,
  name_de         text NOT NULL,
  botanical_name  text NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bsa_varieties (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  species_code           text NOT NULL REFERENCES bsa_species (code) ON DELETE CASCADE,
  -- BSA "Kennnummer", unique within a species.
  registration_number    integer NOT NULL,
  name                   text NOT NULL,
  provisional_name       text,
  protection_applied_on  date,
  protection_granted_on  date,
  protection_ended_on    date,
  approval_applied_on    date,
  approval_granted_on    date,
  approval_ended_on      date,
  -- End of the run-off period ("Auslauffrist Inverkehrbringen") after an approval ended.
  marketable_until       date,
  -- Erhaltungssorte: approved as a conservation variety for its region of origin.
  conservation_region    text,
  synced_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (species_code, registration_number)
);
CREATE INDEX bsa_varieties_species_name_idx ON bsa_varieties (species_code, name);

ALTER TABLE crop_varieties
  ADD COLUMN bsa_variety_id uuid REFERENCES bsa_varieties (id) ON DELETE SET NULL;

-- The catalogue is public reference data: no row-level security, read-only for the API.
GRANT SELECT ON bsa_species, bsa_varieties TO agmeo_app;

GRANT USAGE ON SCHEMA public TO agmeo_refdata;
GRANT SELECT (organization_id, bsa_species_code) ON crops TO agmeo_refdata;
GRANT SELECT, INSERT, UPDATE, DELETE ON bsa_species, bsa_varieties TO agmeo_refdata;
-- crops has row-level security; the sync job needs the species of every crop, including custom ones.
CREATE POLICY crops_refdata_read ON crops FOR SELECT TO agmeo_refdata USING (true);
