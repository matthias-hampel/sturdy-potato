-- Lab results of soil sampling (ported from AGVOLUTION/agmeo: SoilLabImports / SoilLabImportZones).
--
-- An import is one upload of lab files (CSV, XLSX or the returned Probenkarte shapefile). Its
-- rows are matched to the sampling zones by probe number (or location); the values are written
-- onto the zones and kept per import, so a later import of the same parameters can be told
-- apart. Each imported field also gets a soil sample (area-weighted mean of its zones) that
-- nutrient planning uses like a manually entered one.

CREATE TABLE IF NOT EXISTS soil_lab_imports (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  file_names       text[] NOT NULL,
  -- Originals archived in the "Soil imports" folder.
  file_ids         uuid[] NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS soil_lab_imports_org_idx ON soil_lab_imports (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS soil_lab_import_zones (
  organization_id  uuid NOT NULL,
  import_id        uuid NOT NULL,
  zone_id          uuid NOT NULL,
  values           jsonb NOT NULL,
  sampled_on       date NOT NULL,
  PRIMARY KEY (import_id, zone_id),
  FOREIGN KEY (organization_id, import_id) REFERENCES soil_lab_imports (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, zone_id) REFERENCES soil_zones (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS soil_lab_import_zones_zone_idx ON soil_lab_import_zones (zone_id);

ALTER TABLE soil_samples ADD COLUMN IF NOT EXISTS lab_import_id uuid;
ALTER TABLE soil_samples ADD COLUMN IF NOT EXISTS soil_zonation_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soil_samples_lab_import_fk') THEN
    ALTER TABLE soil_samples ADD CONSTRAINT soil_samples_lab_import_fk FOREIGN KEY (organization_id, lab_import_id)
      REFERENCES soil_lab_imports (organization_id, id) ON DELETE SET NULL (lab_import_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'soil_samples_zonation_fk') THEN
    ALTER TABLE soil_samples ADD CONSTRAINT soil_samples_zonation_fk FOREIGN KEY (organization_id, soil_zonation_id)
      REFERENCES soil_zonations (organization_id, id) ON DELETE SET NULL (soil_zonation_id);
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS soil_samples_lab_import_idx ON soil_samples (lab_import_id) WHERE lab_import_id IS NOT NULL;

ALTER TABLE soil_lab_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE soil_lab_import_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_lab_imports_tenant ON soil_lab_imports;
CREATE POLICY soil_lab_imports_tenant ON soil_lab_imports FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS soil_lab_import_zones_tenant ON soil_lab_import_zones;
CREATE POLICY soil_lab_import_zones_tenant ON soil_lab_import_zones FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON soil_lab_imports, soil_lab_import_zones TO agmeo_app;
