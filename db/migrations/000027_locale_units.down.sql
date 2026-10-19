ALTER TABLE organizations DROP COLUMN IF EXISTS measurement_setting;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
UPDATE users SET locale = 'en' WHERE locale IS NULL;
ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
ALTER TABLE users ALTER COLUMN locale SET NOT NULL;
