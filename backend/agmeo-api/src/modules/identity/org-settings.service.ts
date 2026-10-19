import { Injectable } from '@nestjs/common';
import { type DataProcessor, NOTIFICATION_KEYS, type NotificationSettings, type UnsubscribeResult, type UpdateNotificationSettingsInput } from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { toCsv as csvDocument } from '../../core/csv.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { decodePng, imageInfo } from '../../core/images.js';
import { config } from '../../config.js';
import { Database, type Trx } from '../../db/database.js';
import { verifyUnsubscribeToken } from '../../mail/unsubscribe.js';
import { polygonShapefile } from '../vra/export/shapefile.js';
import { zip, type ZipEntry } from '../vra/export/zip.js';

export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Tables left out of the organization export: system bookkeeping, the logo's bytes, and stored
 * raster tiles that only the app can read.
 */
const EXPORT_SKIP = new Set(['audit_events', 'outbox_events', 'jobs', 'organization_logos', 'membership_farms']);

export type ExportFormat = 'csv' | 'json';

@Injectable()
export class OrgSettingsService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Logo
  // ---------------------------------------------------------------------------

  logo(ctx: Ctx): Promise<{ content: Buffer; mimeType: string; updatedAt: Date }> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.selectFrom('organization_logos').select(['content', 'mime_type', 'updated_at']).where('organization_id', '=', ctx.orgId).executeTakeFirst();
      if (!row) throw notFound('Logo');
      return { content: row.content, mimeType: row.mime_type, updatedAt: new Date(row.updated_at) };
    });
  }

  /** Stores a PNG (8-bit, not interlaced, as browsers write them) or JPEG of at most 1 MB. */
  setLogo(ctx: Ctx, data: Buffer | undefined): Promise<void> {
    if (!data?.length) throw badRequest('logo_missing', 'No image was uploaded');
    if (data.length > MAX_LOGO_BYTES) throw badRequest('logo_too_large', 'The logo may be at most 1 MB');
    const info = imageInfo(data);
    if (!info || (info.mimeType === 'image/png' && !decodePng(data))) throw badRequest('logo_unsupported', 'The logo must be a PNG or JPEG image');
    return this.db.run(ctx, async (trx) => {
      await trx
        .insertInto('organization_logos')
        .values({ organization_id: ctx.orgId, mime_type: info.mimeType, content: data, width: info.width, height: info.height, updated_by: ctx.userId })
        .onConflict((oc) =>
          oc.column('organization_id').doUpdateSet({ mime_type: info.mimeType, content: data, width: info.width, height: info.height, updated_by: ctx.userId, updated_at: sql`now()` }),
        )
        .execute();
      await trx.updateTable('organizations').set({ logo_updated_at: sql`now()` }).where('id', '=', ctx.orgId).execute();
      await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'logo_changed', changes: { width: info.width, height: info.height } });
    });
  }

  deleteLogo(ctx: Ctx): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      await trx.deleteFrom('organization_logos').where('organization_id', '=', ctx.orgId).execute();
      await trx.updateTable('organizations').set({ logo_updated_at: null }).where('id', '=', ctx.orgId).execute();
      await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'logo_removed' });
    });
  }

  // ---------------------------------------------------------------------------
  // Notification e-mails
  // ---------------------------------------------------------------------------

  notifications(userId: string): Promise<NotificationSettings> {
    return this.db.run({ userId }, (trx) => this.notificationsIn(trx, userId));
  }

  updateNotifications(userId: string, input: UpdateNotificationSettingsInput): Promise<NotificationSettings> {
    return this.db.run({ userId }, async (trx) => {
      for (const key of NOTIFICATION_KEYS) {
        const enabled = input[key];
        if (enabled === undefined) continue;
        await trx
          .insertInto('user_notification_settings')
          .values({ user_id: userId, key, enabled })
          .onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet({ enabled, updated_at: sql`now()` }))
          .execute();
      }
      return this.notificationsIn(trx, userId);
    });
  }

  /** The unsubscribe link of a notification e-mail: switches that notification off for that user. */
  async unsubscribe(token: string): Promise<UnsubscribeResult> {
    const claim = verifyUnsubscribeToken(token);
    if (!claim) throw badRequest('invalid_token', 'This unsubscribe link is not valid');
    return this.db.run({ userId: claim.userId }, async (trx) => {
      const user = await trx.selectFrom('users').select('email').where('id', '=', claim.userId).executeTakeFirst();
      if (!user) throw notFound('User');
      await trx
        .insertInto('user_notification_settings')
        .values({ user_id: claim.userId, key: claim.key, enabled: false })
        .onConflict((oc) => oc.columns(['user_id', 'key']).doUpdateSet({ enabled: false, updated_at: sql`now()` }))
        .execute();
      return { key: claim.key, email: user.email };
    });
  }

  private async notificationsIn(trx: Trx, userId: string): Promise<NotificationSettings> {
    const rows = await trx.selectFrom('user_notification_settings').select(['key', 'enabled']).where('user_id', '=', userId).execute();
    const settings = Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k, true])) as NotificationSettings;
    for (const r of rows) if ((NOTIFICATION_KEYS as readonly string[]).includes(r.key)) settings[r.key as keyof NotificationSettings] = r.enabled;
    return settings;
  }

  // ---------------------------------------------------------------------------
  // Data processing
  // ---------------------------------------------------------------------------

  /**
   * Services that process data for this deployment, built from the running configuration: the
   * operator's own rows, then every external service the API is set up to call.
   */
  dataProcessors(): DataProcessor[] {
    const operator = (id: string, value: string, categories: DataProcessor['categories']): DataProcessor => {
      const [name, location, url] = value.split('|').map((x) => x.trim());
      return { id, name: name || '', categories, location: location || null, url: url || null };
    };
    const host = (u: string) => {
      try {
        return new URL(u).hostname;
      } catch {
        return null;
      }
    };
    const rows: DataProcessor[] = [
      operator('hosting', config.dataProcessing.hosting, ['account', 'farm_records', 'documents', 'field_locations']),
      operator('database', config.dataProcessing.database, ['account', 'farm_records', 'field_locations']),
      operator('email', config.dataProcessing.email, ['account', 'emails']),
    ];
    if (config.storage.driver === 's3') rows.push({ id: 'storage', name: host(config.storage.s3.endpoint) ?? 'S3', categories: ['documents'], location: config.storage.s3.region || null, url: null });
    rows.push({ id: 'weather', name: 'Open-Meteo (APIs) GmbH', categories: ['field_locations'], location: 'EU', url: 'https://open-meteo.com/en/terms' });
    rows.push({ id: 'geocoding', name: host(config.geocoding.photonUrl) === 'photon.komoot.io' ? 'komoot GmbH (Photon)' : (host(config.geocoding.photonUrl) ?? 'Photon'), categories: ['field_locations'], location: 'DE', url: config.geocoding.photonUrl });
    if (config.openai.apiKey) rows.push({ id: 'openai', name: 'OpenAI Ireland Ltd.', categories: ['farm_records'], location: 'EU/US', url: 'https://openai.com/policies/data-processing-addendum' });
    if (config.thuenen.apiKey) rows.push({ id: 'thuenen', name: 'Johann Heinrich von Thünen-Institut', categories: ['farm_records'], location: 'DE', url: config.thuenen.baseUrl });
    if (config.models.isip.username) rows.push({ id: 'isip', name: 'ISIP e.V.', categories: ['farm_records', 'field_locations'], location: 'DE', url: 'https://www.isip.de' });
    if (config.models.esm.url || config.maizeDmc.apiUrl || config.models.grassland.url)
      rows.push({ id: 'agvolution', name: 'AGVOLUTION GmbH', categories: ['farm_records', 'field_locations'], location: 'DE', url: 'https://agvolution.com' });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Organization export
  // ---------------------------------------------------------------------------

  /**
   * Everything the organization stored, as a ZIP: one CSV or JSON file per table (geometries as
   * GeoJSON, binary columns left out) plus the current field boundaries as GeoJSON and Shapefile.
   * Read through the row policies, so a member limited to some farms exports only those.
   */
  exportOrganization(ctx: Ctx, format: ExportFormat): Promise<{ data: Buffer; filename: string }> {
    return this.db.run(ctx, async (trx) => {
      const org = await trx.selectFrom('organizations').select(['name']).where('id', '=', ctx.orgId).executeTakeFirstOrThrow();
      const { rows: columns } = await sql<{ table_name: string; column_name: string; udt_name: string }>`
        SELECT c.table_name, c.column_name, c.udt_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public'
          AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id')
        ORDER BY c.table_name, c.ordinal_position`.execute(trx);
      const tables = new Map<string, { name: string; type: string }[]>();
      for (const c of columns) {
        if (EXPORT_SKIP.has(c.table_name) || c.udt_name === 'bytea' || c.udt_name === 'raster') continue;
        // Only tables the API role may read; the rest belong to workers.
        tables.set(c.table_name, [...(tables.get(c.table_name) ?? []), { name: c.column_name, type: c.udt_name }]);
      }
      const entries: ZipEntry[] = [];
      for (const [table, cols] of tables) {
        const { rows: allowed } = await sql<{ ok: boolean }>`SELECT has_table_privilege(current_user, ${`public.${table}`}, 'SELECT') AS ok`.execute(trx);
        if (!allowed[0]?.ok) continue;
        // Column grants: a table the role reads only in part keeps the readable columns.
        const readable: typeof cols = [];
        for (const c of cols) {
          const { rows: r } = await sql<{ ok: boolean }>`SELECT has_column_privilege(current_user, ${`public.${table}`}, ${c.name}, 'SELECT') AS ok`.execute(trx);
          if (r[0]?.ok) readable.push(c);
        }
        if (!readable.length) continue;
        const select = sql.join(
          readable.map((c) => (c.type === 'geometry' ? sql`ST_AsGeoJSON(${sql.ref(c.name)})::json AS ${sql.ref(c.name)}` : sql.ref(c.name))),
        );
        const { rows } = await sql<Record<string, unknown>>`SELECT ${select} FROM ${sql.table(table)} WHERE organization_id = ${ctx.orgId}`.execute(trx);
        if (!rows.length) continue;
        entries.push(format === 'json' ? { name: `${table}.json`, data: Buffer.from(JSON.stringify(rows, null, 1)) } : { name: `${table}.csv`, data: Buffer.from(toCsv(readable.map((c) => c.name), rows)) });
      }
      entries.push(...(await this.fieldBoundaries(trx, ctx)));
      const date = new Date().toISOString().slice(0, 10);
      const slug = org.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'agmeo';
      return { data: zip(entries), filename: `${slug}_export_${date}.zip` };
    });
  }

  private async fieldBoundaries(trx: Trx, ctx: Ctx): Promise<ZipEntry[]> {
    const { rows } = await sql<{ id: string; name: string; farm: string; identifier: string | null; area_ha: number; status: string; geometry: MultiPolygon | Polygon }>`
      SELECT f.id, f.name, fa.name AS farm, f.identifier, g.area_ha, f.status, ST_AsGeoJSON(g.geometry)::json AS geometry
      FROM fields f JOIN farms fa ON fa.id = f.farm_id JOIN field_current_geometry g ON g.field_id = f.id
      WHERE f.organization_id = ${ctx.orgId}
      ORDER BY fa.name, f.name`.execute(trx);
    if (!rows.length) return [];
    const multi = (g: MultiPolygon | Polygon): MultiPolygon => (g.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g);
    const geojson = {
      type: 'FeatureCollection',
      features: rows.map((r) => ({ type: 'Feature', properties: { id: r.id, name: r.name, farm: r.farm, identifier: r.identifier, areaHa: Number(r.area_ha), status: r.status }, geometry: r.geometry })),
    };
    const shp = polygonShapefile(
      [
        { name: 'NAME', length: 80, decimals: 0, type: 'C' },
        { name: 'FARM', length: 80, decimals: 0, type: 'C' },
        { name: 'IDENT', length: 40, decimals: 0, type: 'C' },
        { name: 'AREA_HA', length: 12, decimals: 4 },
        { name: 'FIELD_ID', length: 36, decimals: 0, type: 'C' },
      ],
      rows.map((r) => ({ geometry: multi(r.geometry), values: { NAME: r.name, FARM: r.farm, IDENT: r.identifier, AREA_HA: Number(r.area_ha), FIELD_ID: r.id } })),
    );
    return [
      { name: 'fields.geojson', data: Buffer.from(JSON.stringify(geojson)) },
      { name: 'fields_shapefile.zip', data: zip(Object.entries(shp).map(([ext, data]) => ({ name: `fields.${ext}`, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)) }))) },
    ];
  }
}

function toCsv(header: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown): string | number | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'number') return v;
    return String(v);
  };
  return csvDocument(header, rows.map((r) => header.map((h) => cell(r[h]))));
}
