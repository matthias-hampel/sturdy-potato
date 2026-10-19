-- BBCH observations of a crop (ported from AGVOLUTION/agmeo: CultivationBbchCalibration, the
-- BBCH column of the field table). A farmer enters the stage seen on the field; it is stored as an
-- offset in biological days against the phenology model on that day, and the model's daily BBCH
-- is shifted along a piecewise-linear curve through these anchors. One observation per crop and day.

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

ALTER TABLE crop_cycle_bbch_calibrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crop_cycle_bbch_calibrations_tenant ON crop_cycle_bbch_calibrations;
CREATE POLICY crop_cycle_bbch_calibrations_tenant ON crop_cycle_bbch_calibrations FOR ALL TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crop_cycle_bbch_calibrations TO agmeo_app;

