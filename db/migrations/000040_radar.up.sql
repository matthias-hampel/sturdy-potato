-- DWD precipitation radar after the reference app (src/lib/dwd): the worker renders RADOLAN RY
-- analyses and the RV nowcast into PNGs under the radar/ prefix of object storage; these tables
-- index the stored frames and hold the refresh state. Radar is public weather data, not tenant
-- data: no organization, no row-level security.

CREATE TABLE IF NOT EXISTS radar_frames (
  -- YYMMDDHHMM (UTC) for analyses, YYMMDDHHMM-SSS (run and lead minutes) for the nowcast.
  key           text PRIMARY KEY CHECK (key ~ '^[0-9]{10}(-[0-9]{3})?$'),
  kind          text NOT NULL CHECK (kind IN ('analysis', 'nowcast')),
  -- When the precipitation is valid; the run it comes from (equal for analyses).
  valid_at      timestamptz NOT NULL,
  run_at        timestamptz NOT NULL,
  lead_minutes  integer NOT NULL DEFAULT 0 CHECK (lead_minutes >= 0),
  storage_key   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS radar_frames_kind_valid_idx ON radar_frames (kind, valid_at);
CREATE INDEX IF NOT EXISTS radar_frames_run_idx ON radar_frames (run_at) WHERE kind = 'nowcast';

-- One row. last_viewed_at is the demand signal (the reference keeps it in Redis): the API
-- stamps it when someone loads the radar, and the worker refreshes only while it is recent.
CREATE TABLE IF NOT EXISTS radar_state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_viewed_at  timestamptz,
  -- The nowcast run whose frames the manifest lists.
  nowcast_run_at  timestamptz,
  refreshed_at    timestamptz,
  last_error      text,
  last_error_at   timestamptz
);
INSERT INTO radar_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON radar_frames, radar_state TO agmeo_app;
GRANT UPDATE (last_viewed_at) ON radar_state TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON radar_frames TO agmeo_jobs;
GRANT SELECT, UPDATE ON radar_state TO agmeo_jobs;
