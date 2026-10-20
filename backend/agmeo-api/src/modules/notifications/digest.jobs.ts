import { Logger } from '@nestjs/common';
import { resolveMeasurementSystem, type MeasurementSetting } from '@agmeo/contracts';
import { sql, type Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import { queueEmail, SEND_EMAIL } from '../../mail/mail.js';
import { unsubscribeLinks } from '../../mail/unsubscribe.js';
import { localDayBoundary } from '../../models/timezone.js';
import { rainWindowFor } from '../../models/weather/hourlyWindow.js';
import { localParts } from '../weather/weather-store.js';
import { buildRainDigest, decideDigest, type DigestInputRow, SEND_FROM_MINUTES } from './rain-digest.js';

export const RAIN_DIGEST = 'notifications.rain-digest';
export const STORAGE_DIGEST = 'notifications.storage-digest';

/** "Refreshed this morning" means at or after 04:00 local time (the weather store's morning slot). */
const FRESH_FROM = '04:00';
/** Hourly rows must cover this share of the window, else the field is left out (reference). */
const MIN_COVERAGE = 0.8;
/** Storage notices go out above this share of the allowance (the files page warns from here). */
const STORAGE_WARN_RATIO = 0.8;

interface DigestOrg {
  organization_id: string;
  name: string;
  country: string;
  measurement_setting: string;
  timezone: string;
}

interface Recipient {
  user_id: string;
  email: string;
  display_name: string;
  farm_ids: string[] | null;
}

const recipients = (db: Kysely<DB>, orgId: string, key: string, roles: string[] | null = null) =>
  sql<Recipient>`SELECT * FROM app.digest_recipients(${orgId}::uuid, ${key}, ${roles}::text[])`.execute(db).then((r) => r.rows);

/**
 * Every quarter hour: organizations with the rain digest on whose local morning has come get the
 * report, once per local day. Each member's mail is its own `email.send` job with a dedupe key per
 * organization, day and member, which is also how a later tick knows the day is done.
 */
export function rainDigestHandler(db: Kysely<DB>, clock: () => Date = () => new Date()) {
  const logger = new Logger('RainDigest');
  return async () => {
    const now = clock();
    const { rows: orgs } = await sql<DigestOrg>`SELECT * FROM app.rain_digest_orgs()`.execute(db);
    for (const org of orgs) {
      try {
        const sent = await sendRainDigest(db, org, now);
        if (sent) logger.log(`Queued ${sent} rain digest mail(s) for ${org.organization_id}`);
      } catch (e) {
        // One organization's failure must not hold up the others; the next tick tries again.
        logger.error(`Rain digest for ${org.organization_id} failed: ${(e as Error).message}`);
      }
    }
  };
}

export async function sendRainDigest(db: Kysely<DB>, org: DigestOrg, now: Date): Promise<number> {
  const tz = org.timezone;
  const { date, minutes } = localParts(now, tz);
  if (minutes < SEND_FROM_MINUTES) return 0;
  const prefix = `rain-digest:${org.organization_id}:${date}:`;
  const done = await db.selectFrom('jobs').select('id').where('kind', '=', SEND_EMAIL).where('dedupe_key', 'like', `${prefix}%`).limit(1).executeTakeFirst();
  if (done) return 0;

  const { rows: fields } = await sql<{
    field_id: string;
    farm_id: string;
    name: string;
    area_ha: number;
    crop_name: string | null;
    crop_name_de: string | null;
    lat: number;
    lng: number;
    refreshed_at: Date | null;
  }>`SELECT * FROM app.rain_digest_fields(${org.organization_id}::uuid, ${date}::date)`.execute(db);
  const freshCutoff = localDayBoundary(date, FRESH_FROM, tz);
  const fresh = fields.filter((f) => f.refreshed_at && new Date(f.refreshed_at) >= freshCutoff).length;
  const decision = decideDigest({ localMinutes: minutes, total: fields.length, fresh });
  if (decision !== 'send' && decision !== 'send-late') return 0;

  const window = rainWindowFor(date, tz);
  const expectedHours = Math.round((window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000);
  const cells = [...new Map(fields.map((f) => [`${f.lat},${f.lng}`, { lat: Number(f.lat), lng: Number(f.lng) }])).values()];
  const sums = new Map<string, number>();
  if (cells.length) {
    const { rows } = await sql<{ lat: number; lng: number; mm: number; hours: number }>`
      SELECT h.lat, h.lng, coalesce(sum(h.precipitation), 0) AS mm, count(*)::int AS hours
      FROM weather_hourly h
      JOIN jsonb_to_recordset(${JSON.stringify(cells)}::jsonb) AS c(lat numeric, lng numeric) ON c.lat = h.lat AND c.lng = h.lng
      WHERE h.time >= ${window.startUtc} AND h.time < ${window.endUtc}
      GROUP BY h.lat, h.lng`.execute(db);
    for (const r of rows) if (r.hours >= expectedHours * MIN_COVERAGE) sums.set(`${Number(r.lat)},${Number(r.lng)}`, Number(r.mm));
  }
  const rows: DigestInputRow[] = fields.map((f) => ({
    fieldId: f.field_id,
    farmId: f.farm_id,
    name: f.name,
    areaHa: Number(f.area_ha),
    crop: f.crop_name_de ?? f.crop_name,
    precipMm: sums.get(`${Number(f.lat)},${Number(f.lng)}`) ?? null,
    refreshedAt: f.refreshed_at ? new Date(f.refreshed_at) : null,
  }));

  const system = resolveMeasurementSystem(org.measurement_setting as MeasurementSetting, org.country);
  const fieldsUrl = `${config.appUrl}/o/${org.organization_id}/fields`;
  let queued = 0;
  for (const r of await recipients(db, org.organization_id, 'rain_digest')) {
    const digest = buildRainDigest(rows, { system, freshCutoff, farmIds: r.farm_ids });
    if (!digest) continue;
    const links = unsubscribeLinks(r.user_id, 'rain_digest');
    const ok = await queueEmail(db, {
      to: r.email,
      template: 'rainDigest',
      organizationId: org.organization_id,
      dedupeKey: `${prefix}${r.user_id}`,
      headers: { 'List-Unsubscribe': `<${links.oneClick}>, <${links.page}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      params: {
        orgName: org.name,
        localDate: date,
        timezone: tz,
        system,
        rainedFields: digest.rainedFields,
        totalFields: digest.totalFields,
        thresholdMm: digest.thresholdMm,
        staleSince: digest.stale && digest.dataAsOf ? digest.dataAsOf.toISOString() : null,
        least: digest.least.map(({ name, areaHa, crop, precipMm }) => ({ name, areaHa, crop, precipMm })),
        most: digest.most.map(({ name, areaHa, crop, precipMm }) => ({ name, areaHa, crop, precipMm })),
        leastUrl: fieldsUrl,
        mostUrl: fieldsUrl,
        unsubscribeUrl: links.page,
      },
    });
    if (ok) queued++;
  }
  return queued;
}

/** ISO week of a date, e.g. "2026-W43". */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Weekly (Mondays): owners and managers of organizations above 80 % of their storage allowance
 * get a notice with the usage and the trash; with STORAGE_DIGEST_RECIPIENTS set, operations get
 * an overview of every organization near or over its allowance (the reference posted that
 * overview into a staff chat channel).
 */
export function storageDigestHandler(db: Kysely<DB>, clock: () => Date = () => new Date()) {
  const logger = new Logger('StorageDigest');
  return async () => {
    const week = isoWeekKey(clock());
    const { rows } = await sql<{ organization_id: string; name: string; used_bytes: number; trash_bytes: number; trash_files: number; limit_bytes: number | null }>`
      SELECT * FROM app.storage_usage_all()`.execute(db);
    const orgs = rows.map((r) => ({ ...r, used: Number(r.used_bytes), trash: Number(r.trash_bytes), limit: r.limit_bytes != null ? Number(r.limit_bytes) : config.storage.defaultLimitBytes }));
    const tight = orgs.filter((o) => o.limit > 0 && o.used >= STORAGE_WARN_RATIO * o.limit);
    let queued = 0;
    for (const o of tight) {
      for (const r of await recipients(db, o.organization_id, 'storage_digest', ['owner', 'manager'])) {
        const links = unsubscribeLinks(r.user_id, 'storage_digest');
        const ok = await queueEmail(db, {
          to: r.email,
          template: 'storageDigest',
          organizationId: o.organization_id,
          dedupeKey: `storage-digest:${week}:${o.organization_id}:${r.user_id}`,
          headers: { 'List-Unsubscribe': `<${links.oneClick}>, <${links.page}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          params: { orgName: o.name, usedBytes: o.used, limitBytes: o.limit, trashBytes: o.trash, trashFiles: Number(o.trash_files), filesUrl: `${config.appUrl}/o/${o.organization_id}/files`, unsubscribeUrl: links.page },
        });
        if (ok) queued++;
      }
    }
    const opsRecipients = config.mail.storageOverviewTo.split(',').map((s) => s.trim()).filter(Boolean);
    for (const to of opsRecipients) {
      await queueEmail(db, {
        to,
        template: 'storageOverview',
        dedupeKey: `storage-overview:${week}:${to}`,
        params: {
          totalBytes: orgs.reduce((s, o) => s + o.used + o.trash, 0),
          trashBytes: orgs.reduce((s, o) => s + o.trash, 0),
          organizationCount: orgs.length,
          organizations: tight.sort((a, b) => b.used / b.limit - a.used / a.limit).slice(0, 20).map((o) => ({ name: o.name, usedBytes: o.used, limitBytes: o.limit })),
        },
      });
    }
    logger.log(`Storage digest ${week}: ${tight.length} organization(s) above ${STORAGE_WARN_RATIO * 100} %, ${queued} notice(s) queued`);
  };
}
