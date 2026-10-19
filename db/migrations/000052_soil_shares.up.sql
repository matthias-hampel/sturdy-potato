-- Public share links for soil results (ported from AGVOLUTION/agmeo: SoilResultShares).
--
-- The token in the URL is the capability (24 random bytes, base64url). An optional password is
-- stored as an scrypt hash ("salt.hash"); links can expire and be revoked. Viewers are not
-- signed in: the API reads a share only through the SECURITY DEFINER functions below, which
-- return nothing for unknown, revoked or expired tokens and only the shared fields' soil data.

CREATE TABLE IF NOT EXISTS soil_shares (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  token            text NOT NULL UNIQUE CHECK (length(token) >= 24),
  -- "results": the current lab results of the fields; "history": every sampling campaign.
  kind             text NOT NULL DEFAULT 'results' CHECK (kind IN ('results', 'history')),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  field_ids        uuid[] NOT NULL,
  -- The lab import behind a results share and its archived original, offered for download.
  lab_import_id    uuid,
  file_id          uuid,
  password_hash    text,
  locale           text CHECK (locale IN ('de', 'en')),
  expires_at       timestamptz,
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lab_import_id) REFERENCES soil_lab_imports (organization_id, id) ON DELETE SET NULL (lab_import_id)
);
CREATE INDEX IF NOT EXISTS soil_shares_org_idx ON soil_shares (organization_id, created_at DESC);

ALTER TABLE soil_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS soil_shares_tenant ON soil_shares;
CREATE POLICY soil_shares_tenant ON soil_shares FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON soil_shares TO agmeo_app;

-- The share behind a token, whatever its state (the API tells revoked and expired links apart).
CREATE OR REPLACE FUNCTION app.soil_share_lookup(p_token text)
RETURNS TABLE (id uuid, kind text, title text, password_hash text, locale text, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz, org_name text, has_file boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.kind, s.title, s.password_hash, s.locale, s.expires_at, s.revoked_at, s.created_at, o.name,
         EXISTS (SELECT 1 FROM files f WHERE f.id = s.file_id AND f.organization_id = s.organization_id AND f.deleted_at IS NULL)
  FROM soil_shares s JOIN organizations o ON o.id = s.organization_id
  WHERE s.token = p_token
$$;

-- The soil data of a valid share: its fields with outline and the zones of their zone maps (the
-- active one, or every one for a history share) with the measured values.
CREATE OR REPLACE FUNCTION app.soil_share_data(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH s AS (
    SELECT * FROM soil_shares
    WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
  ),
  f AS (
    SELECT fl.id, fl.name, fl.soil_texture, g.area_ha, g.geometry, s.kind
    FROM s JOIN fields fl ON fl.organization_id = s.organization_id
    JOIN field_current_geometry g ON g.field_id = fl.id
    WHERE fl.status = 'active' AND (cardinality(s.field_ids) = 0 OR fl.id = ANY(s.field_ids))
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM s) THEN NULL ELSE coalesce(jsonb_agg(jsonb_build_object(
    'fieldId', f.id,
    'fieldName', f.name,
    'soilTexture', f.soil_texture,
    'areaHa', f.area_ha,
    'geometry', ST_AsGeoJSON(f.geometry, 7)::jsonb,
    'zonations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'zonationId', n.id,
        'createdAt', n.created_at,
        'active', n.superseded_at IS NULL,
        'zones', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', z.id, 'zoneNo', z.zone_no, 'label', z.label, 'color', z.color, 'probeNr', z.probe_nr,
            'areaHa', z.area_ha, 'geometry', ST_AsGeoJSON(z.geometry, 7)::jsonb, 'point', ST_AsGeoJSON(z.sample_point, 7)::jsonb,
            'properties', z.properties, 'methods', z.property_methods, 'dates', z.property_dates, 'lab', z.lab_extras
          ) ORDER BY z.zone_no), '[]'::jsonb)
          FROM soil_zones z WHERE z.zonation_id = n.id
        )
      ) ORDER BY n.created_at DESC), '[]'::jsonb)
      FROM soil_zonations n
      WHERE n.field_id = f.id AND n.status = 'ready' AND (f.kind = 'history' OR n.superseded_at IS NULL)
    )
  ) ORDER BY f.name), '[]'::jsonb) END
  FROM f
$$;

-- The archived lab file of a valid share.
CREATE OR REPLACE FUNCTION app.soil_share_file(p_token text)
RETURNS TABLE (name text, mime_type text, size_bytes bigint, storage_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.name, f.mime_type, f.size_bytes, f.storage_key
  FROM soil_shares s JOIN files f ON f.id = s.file_id AND f.organization_id = s.organization_id AND f.deleted_at IS NULL
  WHERE s.token = p_token AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
$$;

REVOKE ALL ON FUNCTION app.soil_share_lookup(text), app.soil_share_data(text), app.soil_share_file(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.soil_share_lookup(text), app.soil_share_data(text), app.soil_share_file(text) TO agmeo_app;
