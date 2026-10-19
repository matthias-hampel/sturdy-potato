DROP TABLE IF EXISTS user_notification_settings;
DROP TABLE IF EXISTS organization_logos;
ALTER TABLE organizations DROP COLUMN IF EXISTS logo_updated_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS lock_zoned_fields;
ALTER TABLE organizations DROP COLUMN IF EXISTS rain_digest_enabled;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_onboarding_step_check;
ALTER TABLE organizations DROP COLUMN IF EXISTS onboarding_step;
