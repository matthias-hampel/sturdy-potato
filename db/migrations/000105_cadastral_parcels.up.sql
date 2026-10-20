-- Cadastral parcels (Flurstücke) and their leases, ported from AGVOLUTION/agmeo
-- (CadastralParcels, CadastralParcelLeases, lib/cadastral, the lease management and analytics).
--
-- A field's parcels come from the federal states' cadastre services (WFS, source 'wfs') or are
-- entered by hand ('manual'). Each parcel can carry one lease record: who owns it, who farms it,
-- the kind of tenure, rent and term. The rent of a field follows from the parcels by area of
-- intersection; economics uses it where the field has no lease of its own (fields.lease_per_ha).

CREATE TABLE IF NOT EXISTS cadastral_parcels (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_id        uuid NOT NULL,
  -- Flurstückskennzeichen (or the service's own identifier).
  official_id     text CHECK (length(official_id) <= 64),
  label           text CHECK (length(label) <= 200),
  -- Gemarkung, Flur, Flurstücksnummer (Zähler/Nenner).
  district        text CHECK (length(district) <= 120),
  sector          text CHECK (length(sector) <= 20),
  numerator       text CHECK (length(numerator) <= 20),
  denominator     text CHECK (length(denominator) <= 20),
  geometry        geometry(MultiPolygon, 4326) NOT NULL,
  -- Official area (amtliche Fläche) in m².
  area_m2         numeric(14, 1) NOT NULL CHECK (area_m2 >= 0),
  source          text NOT NULL DEFAULT 'wfs' CHECK (source IN ('wfs', 'manual')),
  -- Federal state whose cadastre the parcel came from (ISO 3166-2 suffix, e.g. NI).
  source_state    text CHECK (length(source_state) <= 8),
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS cadastral_parcels_field_official_idx ON cadastral_parcels (field_id, official_id) WHERE official_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cadastral_parcels_org_idx ON cadastral_parcels (organization_id, field_id);
CREATE INDEX IF NOT EXISTS cadastral_parcels_geom_idx ON cadastral_parcels USING gist (geometry);
DROP TRIGGER IF EXISTS cadastral_parcels_updated_at ON cadastral_parcels;
CREATE TRIGGER cadastral_parcels_updated_at BEFORE UPDATE ON cadastral_parcels
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS parcel_leases (
  parcel_id            uuid PRIMARY KEY,
  organization_id      uuid NOT NULL,
  lease_type           text NOT NULL DEFAULT 'ownership'
                       CHECK (lease_type IN ('ownership', 'lease_fixed_term', 'lease_indefinite', 'land_exchange', 'abandoned')),
  -- Owner of the parcel (the lessor when it is leased).
  owner_name           text CHECK (length(owner_name) <= 200),
  owner_address        text CHECK (length(owner_address) <= 500),
  leaseholder_name     text CHECK (length(leaseholder_name) <= 200),
  -- Rent, either per year for the whole parcel or per hectare of the parcel's official area.
  rent_amount          numeric(12, 2) CHECK (rent_amount >= 0),
  rent_basis           text NOT NULL DEFAULT 'per_year' CHECK (rent_basis IN ('per_year', 'per_ha')),
  starts_on            date,
  ends_on              date,
  land_register_volume text CHECK (length(land_register_volume) <= 50),
  land_register_sheet  text CHECK (length(land_register_sheet) <= 50),
  land_register_number text CHECK (length(land_register_number) <= 50),
  notes                text CHECK (length(notes) <= 2000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (organization_id, parcel_id) REFERENCES cadastral_parcels (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS parcel_leases_org_idx ON parcel_leases (organization_id, ends_on);
DROP TRIGGER IF EXISTS parcel_leases_updated_at ON parcel_leases;
CREATE TRIGGER parcel_leases_updated_at BEFORE UPDATE ON parcel_leases
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE cadastral_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cadastral_parcels_tenant ON cadastral_parcels;
CREATE POLICY cadastral_parcels_tenant ON cadastral_parcels FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS parcel_leases_tenant ON parcel_leases;
CREATE POLICY parcel_leases_tenant ON parcel_leases FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON cadastral_parcels, parcel_leases TO agmeo_app;
