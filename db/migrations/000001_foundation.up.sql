-- Foundation: extensions, service roles, tenant-context helpers, identity and tenancy.
--
-- Tenant isolation model (ADR-002):
--   * Every tenant-owned table carries organization_id and has row-level security.
--   * The API connects with a login role that is a member of agmeo_app and, per request,
--     runs inside a transaction with `app.user_id` and `app.organization_id` set locally.
--   * app.org_id() only returns the requested organization when the current user is an
--     active member, so a forged organization id yields no rows instead of foreign data.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_app') THEN
    CREATE ROLE agmeo_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agmeo_outbox_relay') THEN
    CREATE ROLE agmeo_outbox_relay NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO agmeo_app, agmeo_outbox_relay;
GRANT USAGE ON SCHEMA public TO agmeo_app, agmeo_outbox_relay;

CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Subject claim from the identity provider ("sub"). NULL for invited users who
  -- have not signed in yet; they are matched by email on first sign-in.
  auth_subject  text UNIQUE,
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  locale        text NOT NULL DEFAULT 'en',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE organizations (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  name                  text NOT NULL CHECK (length(trim(name)) > 0),
  country               char(2) NOT NULL DEFAULT 'DE',
  currency              char(3) NOT NULL DEFAULT 'EUR',
  -- First month of the crop/marketing year (7 = July, common for German arable farms).
  crop_year_start_month smallint NOT NULL DEFAULT 7 CHECK (crop_year_start_month BETWEEN 1 AND 12),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner', 'manager', 'agronomist', 'worker', 'accountant', 'viewer')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  invited_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Organization of the current request, but only if the current user may access it.
-- SECURITY DEFINER so the lookup is not itself subject to the memberships policy.
CREATE FUNCTION app.org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.organization_id
  FROM memberships m
  WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    AND m.user_id = app.current_user_id()
    AND m.status IN ('active', 'invited')
$$;

CREATE FUNCTION app.user_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT organization_id FROM memberships
  WHERE user_id = app.current_user_id() AND status IN ('active', 'invited')
$$;

-- Sign-in: resolve (or create) the user for an identity-provider subject. Invited users
-- that have no subject yet are claimed by email. Runs before any tenant context exists.
CREATE FUNCTION app.sign_in(p_subject text, p_email text, p_display_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM users WHERE auth_subject = p_subject;
  IF v_id IS NULL THEN
    UPDATE users SET auth_subject = p_subject
      WHERE email = p_email::citext AND auth_subject IS NULL
      RETURNING id INTO v_id;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO users (auth_subject, email, display_name)
      VALUES (p_subject, p_email, p_display_name)
      RETURNING id INTO v_id;
  END IF;
  UPDATE users SET last_login_at = now() WHERE id = v_id;
  -- Pending invitations become active once the invitee signs in.
  UPDATE memberships SET status = 'active' WHERE user_id = v_id AND status = 'invited';
  RETURN v_id;
END
$$;

-- Organizations are created together with their owner membership; the new row would
-- otherwise be invisible to its creator under the organizations policy.
CREATE FUNCTION app.create_organization(p_name text, p_country text, p_currency text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'app.user_id is not set' USING ERRCODE = '42501';
  END IF;
  INSERT INTO organizations (name, country, currency)
    VALUES (p_name, coalesce(p_country, 'DE'), coalesce(p_currency, 'EUR'))
    RETURNING id INTO v_id;
  INSERT INTO memberships (organization_id, user_id, role, status)
    VALUES (v_id, v_user, 'owner', 'active');
  RETURN v_id;
END
$$;

-- Invitations reference users by email before they have ever signed in.
CREATE FUNCTION app.ensure_user(p_email text, p_display_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL THEN
    RAISE EXCEPTION 'organization context required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO users (email, display_name) VALUES (p_email, p_display_name)
    ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_id FROM users WHERE email = p_email::citext;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION app.org_id(), app.user_org_ids(), app.sign_in(text, text, text),
  app.create_organization(text, text, text), app.ensure_user(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_id(), app.user_org_ids(), app.current_user_id(),
  app.sign_in(text, text, text), app.create_organization(text, text, text),
  app.ensure_user(text, text) TO agmeo_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- Users see themselves and the members of the organization they are working in.
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app.current_user_id()
  OR id IN (SELECT user_id FROM memberships WHERE organization_id = (SELECT app.org_id()))
);
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());

CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (id IN (SELECT app.user_org_ids()));
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = (SELECT app.org_id())) WITH CHECK (id = (SELECT app.org_id()));

CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  user_id = app.current_user_id() OR organization_id = (SELECT app.org_id())
);
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (organization_id = (SELECT app.org_id()))
  WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, UPDATE ON users TO agmeo_app;
GRANT SELECT, UPDATE ON organizations TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO agmeo_app;

-- ---------------------------------------------------------------------------
-- Audit log and transactional outbox
-- ---------------------------------------------------------------------------

-- Append-only: the application role may insert and read, never update or delete.
CREATE TABLE audit_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  action          text NOT NULL,
  actor_user_id   uuid REFERENCES users(id),
  changes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON audit_events (organization_id, entity_type, entity_id, created_at DESC);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant ON audit_events FOR ALL
  USING (organization_id = (SELECT app.org_id()))
  WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT ON audit_events TO agmeo_app;

-- Domain events written in the same transaction as the business change and relayed to
-- NATS JetStream by the worker. The API may only append; the relay role reads and marks
-- rows as published. No RLS: the API cannot read it, and the relay is cross-tenant.
CREATE TABLE outbox_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        uuid NOT NULL DEFAULT uuidv7() UNIQUE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;

GRANT INSERT ON outbox_events TO agmeo_app;
GRANT SELECT, UPDATE ON outbox_events TO agmeo_outbox_relay;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO agmeo_app;
