-- 20 % and 80 % quantiles per field and scene for the scene statistics (the reference's q20/q80).
ALTER TABLE field_observations ADD COLUMN IF NOT EXISTS p20 real;
ALTER TABLE field_observations ADD COLUMN IF NOT EXISTS p80 real;
