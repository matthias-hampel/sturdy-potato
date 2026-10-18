-- Default map view of a farm: maps without a field selection open at the farm location
-- with this zoom (MapLibre zoom level, set in the farm settings).

ALTER TABLE farms ADD COLUMN map_zoom real CHECK (map_zoom BETWEEN 0 AND 22);
