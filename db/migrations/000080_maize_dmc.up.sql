-- Maize dry-matter (DMC) monitoring, after the reference's lib/maizeDmc: forecasts of the
-- whole-plant dry matter of silage and grain maize from AGVOLUTION's maize-dmc-api, the
-- farm's own DM measurements that calibrate them, per-variety offsets, and the satellite
-- harvest detection the worker runs once a day.
--
-- Idempotent: the shared development database is migrated by hand (IF NOT EXISTS, DROP ... IF EXISTS).

-- FAO maturity (Siloreifezahl / Körnerreifezahl) the model needs. A variety carries it for
-- every cycle it is sown on; a cycle may override it (or carry it when it has no variety).
CREATE TABLE IF NOT EXISTS maize_dmc_variety_maturities (
  variety_id      uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  fao_maturity    integer NOT NULL CHECK (fao_maturity BETWEEN 150 AND 800),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, variety_id) REFERENCES crop_varieties (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maize_dmc_cycle_settings (
  crop_cycle_id   uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  fao_maturity    integer CHECK (fao_maturity BETWEEN 150 AND 800),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);

-- One maize-dmc-api execution per cycle, UTC day, mode, resolution and resolved calibration:
-- a second request on the same day reuses it, the next day gets a fresh run. The prediction
-- arrays (index 0 = pred_from_date) are copied out of the response so lists read "today" by
-- index instead of scanning the JSON.
CREATE TABLE IF NOT EXISTS maize_dmc_runs (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL,
  crop_cycle_id      uuid NOT NULL,
  field_id           uuid NOT NULL,
  harvest_year       integer NOT NULL,
  run_date           date NOT NULL,
  mode               text NOT NULL CHECK (mode IN ('standard', 'calibrated')),
  resolution         text NOT NULL CHECK (resolution IN ('10m', '3m')),
  calibration_hash   text,
  calibration_source text,
  execution_id       text NOT NULL,
  model_version      text,
  sowing_date        date,
  fao_maturity       integer,
  variety_id         uuid,
  pred_from_date     date,
  pred_medians       real[],
  pred_p10           real[],
  pred_p90           real[],
  -- Accumulated GDD of the first predicted day: the plausibility guard's reference.
  accumulated_gdd    real,
  response           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (crop_cycle_id, run_date, mode, resolution, calibration_hash),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS maize_dmc_runs_year_idx ON maize_dmc_runs (organization_id, harvest_year, run_date DESC);
CREATE INDEX IF NOT EXISTS maize_dmc_runs_execution_idx ON maize_dmc_runs (organization_id, execution_id);

-- Measured whole-plant DM (fraction 0–1). The newest active measurement of a cycle calibrates
-- its forecast (field mode); `dm_offset` = measured − standard model at the measurement date
-- is one point of the variety-offset basis. Corrections supersede, nothing is overwritten.
CREATE TABLE IF NOT EXISTS maize_dmc_calibrations (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL,
  crop_cycle_id           uuid NOT NULL,
  field_id                uuid NOT NULL,
  variety_id              uuid,
  harvest_year            integer NOT NULL,
  measurement_date        date NOT NULL,
  measured_dm             real NOT NULL CHECK (measured_dm > 0 AND measured_dm < 1),
  model_dm_at_measurement real,
  dm_offset               real,
  source                  text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'lab', 'api')),
  notes                   text CHECK (length(notes) <= 2000),
  -- Per-replicate detail behind the averaged value: [{lat, lon, dmPct}].
  samples                 jsonb,
  observed_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  superseded_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS maize_dmc_calibrations_cycle_idx ON maize_dmc_calibrations (organization_id, crop_cycle_id, measurement_date DESC);
CREATE INDEX IF NOT EXISTS maize_dmc_calibrations_year_idx ON maize_dmc_calibrations (organization_id, harvest_year);

-- Offsets applied to every cycle of a variety without its own measurement (the reference's
-- region offsets, per variety). Append-only: re-applying or revoking supersedes the active row.
CREATE TABLE IF NOT EXISTS maize_dmc_variety_offsets (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL,
  harvest_year          integer NOT NULL,
  variety_id            uuid NOT NULL,
  dm_offset             real NOT NULL CHECK (dm_offset BETWEEN -0.3 AND 0.3),
  suggested_offset      real,
  basis_count           integer NOT NULL DEFAULT 0 CHECK (basis_count >= 0),
  basis_from            date,
  basis_to              date,
  basis_calibration_ids uuid[] NOT NULL DEFAULT '{}',
  comment               text CHECK (length(comment) <= 2000),
  applied_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at            timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  FOREIGN KEY (organization_id, variety_id) REFERENCES crop_varieties (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS maize_dmc_variety_offsets_active_idx
  ON maize_dmc_variety_offsets (organization_id, harvest_year, variety_id) WHERE superseded_at IS NULL;

-- Satellite harvest detection per cycle (written by the worker), and the newest clear scene
-- that backs the standing-crop veto.
CREATE TABLE IF NOT EXISTS maize_dmc_harvest_detections (
  crop_cycle_id   uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  harvest_year    integer NOT NULL,
  status          text NOT NULL CHECK (status IN ('unconfirmed', 'confirmed', 'rejected')),
  trust           text NOT NULL CHECK (trust IN ('high', 'medium')),
  window_start    date NOT NULL,
  window_end      date NOT NULL,
  confirm_date    date,
  rejected_reason text,
  evidence        jsonb NOT NULL DEFAULT '{}',
  confirmed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maize_dmc_satellite_status (
  crop_cycle_id     uuid PRIMARY KEY,
  organization_id   uuid NOT NULL,
  field_id          uuid NOT NULL,
  harvest_year      integer NOT NULL,
  latest_clear_date date NOT NULL,
  latest_clear_ndvi real NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE maize_dmc_variety_maturities ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_cycle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_variety_offsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_harvest_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE maize_dmc_satellite_status ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maize_dmc_variety_maturities', 'maize_dmc_cycle_settings', 'maize_dmc_runs', 'maize_dmc_calibrations',
                           'maize_dmc_variety_offsets', 'maize_dmc_harvest_detections', 'maize_dmc_satellite_status'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()))', t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON maize_dmc_variety_maturities, maize_dmc_cycle_settings, maize_dmc_calibrations TO agmeo_app;
GRANT SELECT, INSERT, UPDATE ON maize_dmc_variety_offsets TO agmeo_app;
-- Runs are written once and never changed; detections belong to the worker.
GRANT SELECT, INSERT ON maize_dmc_runs TO agmeo_app;
GRANT SELECT ON maize_dmc_harvest_detections, maize_dmc_satellite_status TO agmeo_app;

-- The harvest detection job (agmeo_jobs): reads the standard runs' DM and the measurement dates
-- (a sample proves the crop was still standing), writes detections and the clear-scene status.
GRANT SELECT (organization_id, crop_cycle_id, harvest_year, run_date, mode, pred_from_date, pred_medians, created_at) ON maize_dmc_runs TO agmeo_jobs;
GRANT SELECT (organization_id, crop_cycle_id, harvest_year, measurement_date) ON maize_dmc_calibrations TO agmeo_jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON maize_dmc_harvest_detections, maize_dmc_satellite_status TO agmeo_jobs;
DROP POLICY IF EXISTS maize_dmc_runs_jobs_read ON maize_dmc_runs;
CREATE POLICY maize_dmc_runs_jobs_read ON maize_dmc_runs FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS maize_dmc_calibrations_jobs_read ON maize_dmc_calibrations;
CREATE POLICY maize_dmc_calibrations_jobs_read ON maize_dmc_calibrations FOR SELECT TO agmeo_jobs USING (true);
DROP POLICY IF EXISTS maize_dmc_harvest_detections_jobs ON maize_dmc_harvest_detections;
CREATE POLICY maize_dmc_harvest_detections_jobs ON maize_dmc_harvest_detections FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS maize_dmc_satellite_status_jobs ON maize_dmc_satellite_status;
CREATE POLICY maize_dmc_satellite_status_jobs ON maize_dmc_satellite_status FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);

-- Input of the harvest detection: every cycle with a DMC run in the harvest year, with its
-- field's name and centroid (site key) and the field-mean NDVI per acquisition day since
-- `p_since` (the best-covered observation of the day). Exposes nothing beyond what the
-- detector needs, so the job role gets no general read access to fields or observations.
CREATE OR REPLACE FUNCTION app.maize_dmc_detection_inputs(p_year integer, p_since date)
RETURNS TABLE (organization_id uuid, crop_cycle_id uuid, field_id uuid, field_name text, lat double precision, lng double precision, scenes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT cc.organization_id, cc.id, cc.field_id, f.name,
         ST_Y(ST_PointOnSurface(g.geometry)), ST_X(ST_PointOnSurface(g.geometry)),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object('date', o.observed_on, 'ndvi', o.mean, 'validPixelPct', o.valid_pixel_pct, 'status', o.status) ORDER BY o.observed_on)
           FROM (
             SELECT DISTINCT ON (fo.observed_on) fo.observed_on, fo.mean, fo.valid_pixel_pct, fo.status
             FROM field_observations fo
             WHERE fo.organization_id = cc.organization_id AND fo.field_id = cc.field_id
               AND fo.index_type = 'ndvi' AND fo.observed_on >= p_since
             ORDER BY fo.observed_on, fo.valid_pixel_pct DESC, fo.created_at DESC
           ) o
         ), '[]'::jsonb)
  FROM crop_cycles cc
  JOIN fields f ON f.id = cc.field_id
  JOIN field_current_geometry g ON g.field_id = cc.field_id
  WHERE EXISTS (SELECT 1 FROM maize_dmc_runs r WHERE r.crop_cycle_id = cc.id AND r.harvest_year = p_year)
$$;
REVOKE ALL ON FUNCTION app.maize_dmc_detection_inputs(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.maize_dmc_detection_inputs(integer, date) TO agmeo_jobs;
