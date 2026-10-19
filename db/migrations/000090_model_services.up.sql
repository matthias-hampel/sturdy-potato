-- Results of AGVOLUTION's external model services after the reference app:
--
-- * ESM (ecosystem model server, lvl0-models esm/endpoints): a run models yield and the nitrogen
--   terms per zone of a crop. The API stores the /esm/run request in the user's context; the
--   worker sends it (sync mode, result in the response) and stores the zones.
-- * ISIP disease models (isip.de, as agmeo-crawlers queries them): per-day, per-disease risk
--   levels 0..3 of a crop, fetched daily by the worker from Feb 15 to Jun 30. The reference's
--   crawler wrote them into its own database; here the worker fetches and stores them itself.
--
-- The worker runs as agmeo_jobs and reaches these tenant tables through its own policies; the
-- crops to fetch disease risk for come from a SECURITY DEFINER function that exposes only ids,
-- the crop code and a point on the field.

CREATE TABLE IF NOT EXISTS esm_runs (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL,
  crop_cycle_id    uuid NOT NULL,
  zone_count       smallint NOT NULL CHECK (zone_count BETWEEN 1 AND 7),
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  -- Execution id the ESM assigned (UUID v7 of its endpoints).
  execution_id     text,
  -- The /esm/run body as sent: crop, geometry, sowing date, soil and parameters.
  request          jsonb NOT NULL,
  error            text CHECK (length(error) <= 2000),
  requested_by     uuid,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS esm_runs_cycle_idx ON esm_runs (organization_id, crop_cycle_id, requested_at DESC);

-- The zones of a run, numbered by rising modelled yield as the ESM sorts them.
CREATE TABLE IF NOT EXISTS esm_run_zones (
  organization_id          uuid NOT NULL,
  run_id                   uuid NOT NULL,
  zone_no                  smallint NOT NULL CHECK (zone_no BETWEEN 1 AND 50),
  area_ha                  numeric(12, 4) NOT NULL CHECK (area_ha >= 0),
  area_fraction            numeric(7, 6) NOT NULL CHECK (area_fraction BETWEEN 0 AND 1),
  yield_t_ha               real NOT NULL,
  -- N uptake of the crop (CNUP), mineral N at season start, mineralised N in the season, N loss; kg N/ha.
  n_crop_kg_ha             real,
  n_min_kg_ha              real NOT NULL,
  n_min_spring_kg_ha       real NOT NULL,
  n_loss_kg_ha             real NOT NULL,
  soil_type_lufa           text,
  soil_organic_carbon_pct  real,
  geometry                 geometry(MultiPolygon, 4326) NOT NULL,
  PRIMARY KEY (run_id, zone_no),
  FOREIGN KEY (organization_id, run_id) REFERENCES esm_runs (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS esm_run_zones_geom_idx ON esm_run_zones USING gist (geometry);

CREATE TABLE IF NOT EXISTS disease_risk_days (
  organization_id  uuid NOT NULL,
  crop_cycle_id    uuid NOT NULL,
  date             date NOT NULL,
  disease          text NOT NULL CHECK (disease IN ('brownRust', 'dtr', 'fusarium', 'yellowRust', 'powderyMildew', 'netBlotch', 'ramularia', 'leafBlotch', 'septoriaTritici', 'leafRust')),
  level            smallint NOT NULL CHECK (level BETWEEN 0 AND 3),
  PRIMARY KEY (crop_cycle_id, date, disease),
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);

-- When the disease risk of a crop was last fetched, and the last failure.
CREATE TABLE IF NOT EXISTS disease_risk_state (
  organization_id  uuid NOT NULL,
  crop_cycle_id    uuid PRIMARY KEY,
  refreshed_at     timestamptz,
  simulation_date  date,
  last_error       text CHECK (length(last_error) <= 2000),
  last_error_at    timestamptz,
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE esm_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE esm_run_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE disease_risk_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE disease_risk_state ENABLE ROW LEVEL SECURITY;

-- Users: runs are requested in the API, everything else is written by the worker.
DROP POLICY IF EXISTS esm_runs_tenant ON esm_runs;
CREATE POLICY esm_runs_tenant ON esm_runs FOR ALL TO agmeo_app
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS esm_run_zones_tenant ON esm_run_zones;
CREATE POLICY esm_run_zones_tenant ON esm_run_zones FOR SELECT TO agmeo_app USING (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS disease_risk_days_tenant ON disease_risk_days;
CREATE POLICY disease_risk_days_tenant ON disease_risk_days FOR SELECT TO agmeo_app USING (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS disease_risk_state_tenant ON disease_risk_state;
CREATE POLICY disease_risk_state_tenant ON disease_risk_state FOR SELECT TO agmeo_app USING (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE ON esm_runs TO agmeo_app;
GRANT SELECT ON esm_run_zones, disease_risk_days, disease_risk_state TO agmeo_app;

-- Worker.
DROP POLICY IF EXISTS esm_runs_jobs ON esm_runs;
CREATE POLICY esm_runs_jobs ON esm_runs FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS esm_run_zones_jobs ON esm_run_zones;
CREATE POLICY esm_run_zones_jobs ON esm_run_zones FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS disease_risk_days_jobs ON disease_risk_days;
CREATE POLICY disease_risk_days_jobs ON disease_risk_days FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS disease_risk_state_jobs ON disease_risk_state;
CREATE POLICY disease_risk_state_jobs ON disease_risk_state FOR ALL TO agmeo_jobs USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON esm_runs TO agmeo_jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON esm_run_zones, disease_risk_days, disease_risk_state TO agmeo_jobs;

-- Main crops of the given crop codes in a season running today, on active fields, whose disease
-- risk was not fetched within `p_min_age`: ids, crop code and a point on the crop's area.
CREATE OR REPLACE FUNCTION app.disease_risk_demand(p_crop_codes text[], p_min_age interval)
RETURNS TABLE (crop_cycle_id uuid, organization_id uuid, crop_code text, lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT cc.id, cc.organization_id, c.code,
         ST_Y(ST_PointOnSurface(coalesce(fp.geometry, g.geometry))), ST_X(ST_PointOnSurface(coalesce(fp.geometry, g.geometry)))
  FROM crop_cycles cc
  JOIN crops c ON c.id = cc.crop_id
  JOIN growing_seasons s ON s.id = cc.season_id
  JOIN fields f ON f.id = cc.field_id
  JOIN field_current_geometry g ON g.field_id = cc.field_id
  LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
  LEFT JOIN disease_risk_state st ON st.crop_cycle_id = cc.id
  WHERE cc.role = 'main' AND cc.status IN ('planned', 'active')
    AND f.status = 'active'
    AND c.code = ANY (p_crop_codes)
    AND s.start_date <= current_date AND s.end_date >= current_date
    AND (st.refreshed_at IS NULL OR st.refreshed_at < now() - p_min_age)
$$;
REVOKE ALL ON FUNCTION app.disease_risk_demand(text[], interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.disease_risk_demand(text[], interval) TO agmeo_jobs;
