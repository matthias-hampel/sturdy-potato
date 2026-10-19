-- Stored weather (F5) after the reference app's weather crawler: daily values from the start of the
-- running seasons and an hourly window (today − 7 … today + 14) per 0.01° grid cell. Weather is not
-- tenant data; fields read the cell under their centroid. The worker refreshes a cell once a day in
-- the morning slot of the farms that use it, and new cells right away.

CREATE TABLE IF NOT EXISTS weather_cells (
  lat                 numeric(6, 2) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 numeric(6, 2) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- IANA zone Open-Meteo resolved for the cell; hourly times are local to it.
  timezone            text,
  utc_offset_seconds  integer,
  -- First day the backfill asked for (the free API returns less), and when the cell was last refreshed.
  backfilled_from     date,
  refreshed_at        timestamptz,
  last_error          text,
  last_error_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lat, lng)
);

CREATE TABLE IF NOT EXISTS weather_daily (
  lat                  numeric(6, 2) NOT NULL,
  lng                  numeric(6, 2) NOT NULL,
  date                 date NOT NULL,
  temp_min             real,
  temp_max             real,
  temp_mean            real,
  precipitation        real,
  humidity_min         real,
  humidity_max         real,
  humidity_mean        real,
  dew_point_min        real,
  dew_point_max        real,
  dew_point_mean       real,
  wind_speed_max       real,
  wind_speed_mean      real,
  wind_gusts_max       real,
  wind_gusts_mean      real,
  et0                  real,
  radiation_sum        real,
  soil_temp_0_7        real,
  soil_temp_7_28       real,
  soil_moisture_0_7    real,
  soil_moisture_7_28   real,
  -- Forecast days are replaced by later refreshes; archive days are final.
  source               text NOT NULL CHECK (source IN ('archive', 'forecast')),
  PRIMARY KEY (lat, lng, date),
  FOREIGN KEY (lat, lng) REFERENCES weather_cells (lat, lng) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weather_hourly (
  lat                        numeric(6, 2) NOT NULL,
  lng                        numeric(6, 2) NOT NULL,
  time                       timestamptz NOT NULL,
  temp                       real,
  humidity                   real,
  dew_point                  real,
  precipitation              real,
  precipitation_probability  real,
  wind_speed                 real,
  wind_gusts                 real,
  PRIMARY KEY (lat, lng, time),
  FOREIGN KEY (lat, lng) REFERENCES weather_cells (lat, lng) ON DELETE CASCADE
);

GRANT SELECT ON weather_cells, weather_daily, weather_hourly TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON weather_cells, weather_daily, weather_hourly TO agmeo_jobs;

-- The grid cell of a point (0.01°, as the reference's crawler).
CREATE OR REPLACE FUNCTION app.weather_cell(p geometry) RETURNS TABLE (lat numeric, lng numeric)
LANGUAGE sql IMMUTABLE AS $$
  SELECT round(ST_Y(p)::numeric, 2), round(ST_X(p)::numeric, 2)
$$;
GRANT EXECUTE ON FUNCTION app.weather_cell(geometry) TO agmeo_app, agmeo_jobs;

-- The cells active fields lie in, with the farms' time zones and the earliest start of a season
-- that has not ended more than a year ago. Exposes coordinates rounded to the grid only.
CREATE OR REPLACE FUNCTION app.weather_cell_demand() RETURNS TABLE (lat numeric, lng numeric, timezones text[], season_start date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT c.lat, c.lng, array_agg(DISTINCT fa.timezone), min(s.start_date)
  FROM fields f
  JOIN farms fa ON fa.id = f.farm_id
  JOIN field_current_geometry g ON g.field_id = f.id
  CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
  LEFT JOIN growing_seasons s ON s.organization_id = f.organization_id AND s.end_date >= current_date - 365 AND s.start_date <= current_date + 365
  WHERE f.status = 'active'
  GROUP BY c.lat, c.lng
$$;
REVOKE ALL ON FUNCTION app.weather_cell_demand() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.weather_cell_demand() TO agmeo_jobs;
