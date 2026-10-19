-- Beschreibende Sortenliste (BSL) of the Bundessortenamt: descriptive traits and 1–9 ratings of
-- varieties (agmeo VarietyProperties). Shared reference data like the BSA catalogue, loaded by the
-- BSL import (backend/agmeo-api, `pnpm sync:bsl`) as agmeo_refdata. One row per variety and BSL
-- use group (a variety tested for organic farming has its own ratings); `species_code` is the BSA
-- species ("Kennbuchstabe") crops map to, and the variety is linked to the BSA register by its
-- Kennnummer where it is listed there.
CREATE TABLE IF NOT EXISTS bsl_varieties (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Row id of the source list; the import upserts by it.
  bsl_id               integer NOT NULL UNIQUE,
  species_code         text,
  registration_number  integer,
  bsa_variety_id       uuid REFERENCES bsa_varieties (id) ON DELETE SET NULL,
  name                 text NOT NULL,
  kenn_nummer          text,
  bsl_species          text NOT NULL,
  bsl_subspecies       text NOT NULL,
  usage                text,
  registered_since     smallint,
  breeder              text,
  breeder_number       text,
  status               text,
  hybrid               boolean NOT NULL DEFAULT false,
  is_new               boolean NOT NULL DEFAULT false,
  note                 text,
  -- Property name → 1–9 rating or physical value (number) or text, as in the list.
  properties           jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality              jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bsl_varieties_species_idx ON bsl_varieties (species_code, name);
CREATE INDEX IF NOT EXISTS bsl_varieties_bsa_idx ON bsl_varieties (bsa_variety_id);

-- Public reference data: no row-level security, read-only for the API.
GRANT SELECT ON bsl_varieties TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bsl_varieties TO agmeo_refdata;
