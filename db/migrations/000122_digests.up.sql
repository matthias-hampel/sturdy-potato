-- E-mail digests of the worker (reference: cron/rain-digest, cron/storage-digest). The jobs role
-- reads tenant data only through these functions, which return what a digest needs and no more.

-- Organizations with the rain digest switched on, in the time zone of their first farm.
CREATE OR REPLACE FUNCTION app.rain_digest_orgs()
RETURNS TABLE (organization_id uuid, name text, country text, measurement_setting text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.name, o.country::text, o.measurement_setting,
         coalesce((SELECT fa.timezone FROM farms fa
                   WHERE fa.organization_id = o.id AND fa.archived_at IS NULL
                   ORDER BY fa.created_at, fa.id LIMIT 1), 'Europe/Berlin')
  FROM organizations o
  WHERE o.rain_digest_enabled AND o.status = 'active'
$$;

-- Active fields of an organization with their weather cell, when it was last refreshed, and the
-- main crop of the season that contains p_date (the latest harvest year when seasons overlap).
CREATE OR REPLACE FUNCTION app.rain_digest_fields(p_org uuid, p_date date)
RETURNS TABLE (field_id uuid, farm_id uuid, name text, area_ha numeric, harvest_year integer,
               crop_name text, crop_name_de text, lat numeric, lng numeric, refreshed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH season AS (
    SELECT s.id, s.harvest_year FROM growing_seasons s
    WHERE s.organization_id = p_org AND s.start_date <= p_date AND s.end_date >= p_date
    ORDER BY s.harvest_year DESC LIMIT 1
  )
  SELECT f.id, f.farm_id, f.name, g.area_ha, (SELECT harvest_year FROM season),
         cr.name, cr.name_de, c.lat, c.lng, wc.refreshed_at
  FROM fields f
  JOIN farms fa ON fa.id = f.farm_id AND fa.archived_at IS NULL
  JOIN field_current_geometry g ON g.field_id = f.id
  CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
  LEFT JOIN weather_cells wc ON wc.lat = c.lat AND wc.lng = c.lng
  LEFT JOIN LATERAL (
    SELECT k.name, k.name_de FROM crop_cycles cc JOIN crops k ON k.id = cc.crop_id
    WHERE cc.field_id = f.id AND cc.season_id = (SELECT id FROM season) AND cc.role = 'main'
    ORDER BY cc.field_part_id NULLS FIRST, cc.created_at LIMIT 1
  ) cr ON true
  WHERE f.organization_id = p_org AND f.status = 'active'
$$;

-- Active members who have not switched the notification off, with the farms they are limited
-- to (NULL = every farm). p_roles limits the roles (NULL = every role).
CREATE OR REPLACE FUNCTION app.digest_recipients(p_org uuid, p_key text, p_roles text[] DEFAULT NULL)
RETURNS TABLE (user_id uuid, email text, display_name text, locale text, farm_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text, u.display_name, u.locale,
         CASE WHEN m.restricted_to_farms THEN
           coalesce((SELECT array_agg(mf.farm_id) FROM membership_farms mf
                     WHERE mf.organization_id = m.organization_id AND mf.user_id = m.user_id), '{}')
         END
  FROM memberships m
  JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = p_org AND m.status = 'active'
    AND (p_roles IS NULL OR m.role = ANY (p_roles))
    AND NOT EXISTS (SELECT 1 FROM user_notification_settings s WHERE s.user_id = u.id AND s.key = p_key AND NOT s.enabled)
  ORDER BY u.email
$$;

-- Stored bytes per active organization (live files and trash) and its allowance (NULL = default).
CREATE OR REPLACE FUNCTION app.storage_usage_all()
RETURNS TABLE (organization_id uuid, name text, used_bytes bigint, trash_bytes bigint, trash_files bigint, limit_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.name,
         coalesce(sum(f.size_bytes) FILTER (WHERE f.deleted_at IS NULL), 0)::bigint,
         coalesce(sum(f.size_bytes) FILTER (WHERE f.deleted_at IS NOT NULL), 0)::bigint,
         count(f.id) FILTER (WHERE f.deleted_at IS NOT NULL),
         o.storage_limit_bytes
  FROM organizations o
  LEFT JOIN files f ON f.organization_id = o.id
  WHERE o.status = 'active'
  GROUP BY o.id
$$;

REVOKE ALL ON FUNCTION app.rain_digest_orgs(), app.rain_digest_fields(uuid, date),
  app.digest_recipients(uuid, text, text[]), app.storage_usage_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rain_digest_orgs(), app.rain_digest_fields(uuid, date),
  app.digest_recipients(uuid, text, text[]), app.storage_usage_all() TO agmeo_jobs;
