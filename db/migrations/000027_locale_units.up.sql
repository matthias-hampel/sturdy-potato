-- UI language per user and measurement system per organization.
--
-- users.locale was a fixed default that nobody could change; it becomes the user's explicit
-- choice, NULL meaning "follow the browser".
ALTER TABLE users ALTER COLUMN locale DROP NOT NULL;
ALTER TABLE users ALTER COLUMN locale DROP DEFAULT;
UPDATE users SET locale = NULL WHERE locale = 'en';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('de', 'en'));

-- 'auto' derives the system from the organization's country (imperial for US farms).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS measurement_setting text NOT NULL DEFAULT 'auto';
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_measurement_setting_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_measurement_setting_check
  CHECK (measurement_setting IN ('auto', 'metric', 'imperial'));
