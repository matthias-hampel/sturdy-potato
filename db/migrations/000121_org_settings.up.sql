-- Organization settings of the reference app's settings tabs and onboarding: the open
-- onboarding step, the rain digest switch, the soil zonation lock and the logo; and the
-- per-user e-mail notification switches.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step text;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_onboarding_step_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_onboarding_step_check
  CHECK (onboarding_step IN ('crops', 'fields', 'invite'));
-- Daily rainfall report for the members (Settings → Notifications); opt-in as in the reference.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rain_digest_enabled boolean NOT NULL DEFAULT false;
-- Fields with a soil zonation cannot be re-zoned or have their zones edited while set.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS lock_zoned_fields boolean NOT NULL DEFAULT false;
-- Bumped with every logo change, so clients can cache the image per version.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz;

-- The logo, shown in the app and on generated PDFs and print views. Small (≤ 1 MB, PNG or JPEG).
CREATE TABLE IF NOT EXISTS organization_logos (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  mime_type       text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  content         bytea NOT NULL CHECK (octet_length(content) <= 1048576),
  width           integer NOT NULL CHECK (width > 0),
  height          integer NOT NULL CHECK (height > 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users (id) ON DELETE SET NULL
);
ALTER TABLE organization_logos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_logos_tenant ON organization_logos;
CREATE POLICY organization_logos_tenant ON organization_logos FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_logos TO agmeo_app;

-- Per-user switches for notification e-mails. No row means the default (on); a mail's
-- unsubscribe link writes enabled = false.
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key IN ('rain_digest', 'storage_digest')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_notification_settings_self ON user_notification_settings;
CREATE POLICY user_notification_settings_self ON user_notification_settings FOR ALL
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notification_settings TO agmeo_app;
