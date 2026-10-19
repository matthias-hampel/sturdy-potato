-- BBCH calibration and the water balance's rooting depth per crop cycle (reference
-- CultivationBbchCalibration and Cultivations.rootDepthM).
--
-- A calibration is an observed BBCH stage on a day. It is stored with the model's BBCH on that day
-- and the offset in biological days (observed − model) that shifts the ESM phenology model from
-- there on; one observation per crop cycle and day.

-- The table has the same definition as in migration 000100 of the field-table branch, which ports
-- the same reference table; whichever runs first creates it.
CREATE TABLE IF NOT EXISTS crop_cycle_bbch_calibrations (
  organization_id        uuid NOT NULL,
  crop_cycle_id          uuid NOT NULL,
  observed_on            date NOT NULL,
  observed_bbch          smallint NOT NULL CHECK (observed_bbch BETWEEN 0 AND 99),
  model_bbch             smallint CHECK (model_bbch BETWEEN 0 AND 99),
  bd_offset              double precision NOT NULL,
  created_by             uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crop_cycle_id, observed_on),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crop_cycle_bbch_calibrations_cycle_idx ON crop_cycle_bbch_calibrations (organization_id, crop_cycle_id, observed_on DESC);
ALTER TABLE crop_cycle_bbch_calibrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crop_cycle_bbch_calibrations_tenant ON crop_cycle_bbch_calibrations;
CREATE POLICY crop_cycle_bbch_calibrations_tenant ON crop_cycle_bbch_calibrations FOR ALL TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crop_cycle_bbch_calibrations TO agmeo_app;

-- Rooting depth the FAO-56 balance uses for this crop cycle; null = the crop's FAO-56 default.
ALTER TABLE crop_cycles ADD COLUMN IF NOT EXISTS root_depth_m numeric(4, 2);
ALTER TABLE crop_cycles DROP CONSTRAINT IF EXISTS crop_cycles_root_depth_m_check;
ALTER TABLE crop_cycles ADD CONSTRAINT crop_cycles_root_depth_m_check CHECK (root_depth_m BETWEEN 0.1 AND 3);
