import { Injectable } from '@nestjs/common';
import {
  ALL_RESULT_PARAMS,
  type CreateSoilShareInput,
  type SoilShare,
  type SoilShareData,
  type SoilShareField,
  type SoilShareInfo,
  type SoilTexture,
  type UpdateSoilShareInput,
  type ZoneLabExtras,
} from '@agmeo/contracts';
import type { MultiPolygon, Point } from 'geojson';
import type { Readable } from 'node:stream';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, DomainError, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database } from '../../db/database.js';
import { ObjectStorage } from '../../storage/object-storage.js';
import { AttemptLimiter, hashSharePassword, newShareToken, signAccess, verifyAccess, verifySharePassword } from './share-access.js';
import { zoneOut } from './soil-rows.js';

interface LookupRow {
  id: string;
  kind: 'results' | 'history';
  title: string;
  password_hash: string | null;
  locale: 'de' | 'en' | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  org_name: string;
  has_file: boolean;
}

interface SharedZone {
  id: string;
  zoneNo: number;
  label: string;
  color: string;
  probeNr: number | null;
  areaHa: number;
  geometry: MultiPolygon;
  point: Point | null;
  properties: Record<string, unknown>;
  methods: Record<string, unknown>;
  dates: Record<string, unknown>;
  lab: ZoneLabExtras | null;
}

interface SharedField {
  fieldId: string;
  fieldName: string;
  soilTexture: string | null;
  areaHa: number;
  geometry: MultiPolygon;
  zonations: { zonationId: string; createdAt: string; active: boolean; zones: SharedZone[] }[];
}

/** No user is signed in on a share page; the share functions run as their owner. */
const ANONYMOUS = { userId: '' };

/**
 * Password-protected public share links of soil results (ported from the reference's
 * ShareResultsDialog and app/share/soil/[token]): created, changed and revoked by members; read
 * by anyone with the link (and the password) through SECURITY DEFINER functions.
 */
@Injectable()
export class SoilShareService {
  private readonly limiter = new AttemptLimiter();

  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
  ) {}

  list(ctx: Ctx): Promise<SoilShare[]> {
    return this.db.run(ctx, (trx) => this.query(trx));
  }

  private async query(trx: Parameters<Parameters<Database['run']>[1]>[0], id?: string): Promise<SoilShare[]> {
    const { rows } = await sql<{
      id: string;
      token: string;
      kind: SoilShare['kind'];
      title: string;
      field_ids: string[];
      field_names: string[] | null;
      password_hash: string | null;
      file_id: string | null;
      locale: SoilShare['locale'];
      expires_at: Date | null;
      created_at: Date;
      created_by_name: string | null;
      revoked_at: Date | null;
    }>`
      SELECT s.id, s.token, s.kind, s.title, s.field_ids, s.password_hash, s.file_id, s.locale, s.expires_at, s.created_at, s.revoked_at,
             u.display_name AS created_by_name,
             (SELECT array_agg(f.name ORDER BY f.name) FROM fields f WHERE f.id = ANY(s.field_ids)) AS field_names
      FROM soil_shares s LEFT JOIN users u ON u.id = s.created_by
      WHERE ${id ? sql`s.id = ${id}::uuid` : sql`true`}
      ORDER BY s.created_at DESC`.execute(trx);
    return rows.map((r) => ({
      id: r.id,
      token: r.token,
      kind: r.kind,
      title: r.title,
      fieldIds: r.field_ids,
      fieldNames: r.field_names ?? [],
      hasPassword: !!r.password_hash,
      hasFile: !!r.file_id,
      locale: r.locale,
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
      createdByName: r.created_by_name,
      revokedAt: iso(r.revoked_at),
    }));
  }

  async create(ctx: Ctx, input: Out<typeof CreateSoilShareInput>): Promise<SoilShare> {
    const passwordHash = input.password ? await hashSharePassword(input.password) : null;
    return this.db.run(ctx, async (trx) => {
      if (input.kind === 'results' && !input.fieldIds.length) throw badRequest('no_fields', 'Choose the fields to share');
      if (input.fieldIds.length) {
        const found = await trx.selectFrom('fields').select('id').where('id', 'in', input.fieldIds).execute();
        if (found.length !== new Set(input.fieldIds).size) throw notFound('Field');
      }
      let fileId: string | null = null;
      if (input.labImportId) {
        const imp = await trx.selectFrom('soil_lab_imports').select('file_ids').where('id', '=', input.labImportId).executeTakeFirst();
        if (!imp) throw notFound('Lab import');
        fileId = imp.file_ids[0] ?? null;
      }
      const { id } = await trx
        .insertInto('soil_shares')
        .values({
          organization_id: ctx.orgId,
          token: newShareToken(),
          kind: input.kind,
          title: input.title,
          field_ids: input.fieldIds,
          lab_import_id: input.labImportId ?? null,
          file_id: fileId,
          password_hash: passwordHash,
          locale: input.locale ?? null,
          expires_at: input.expiresAt ?? null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'soil_share', entityId: id, action: 'created', changes: { kind: input.kind, fields: input.fieldIds.length, password: !!passwordHash, expiresAt: input.expiresAt ?? null } });
      return (await this.query(trx, id))[0];
    });
  }

  async update(ctx: Ctx, id: string, input: Out<typeof UpdateSoilShareInput>): Promise<SoilShare> {
    const passwordHash = input.password === undefined ? undefined : input.password ? await hashSharePassword(input.password) : null;
    return this.db.run(ctx, async (trx) => {
      const row = await trx
        .updateTable('soil_shares')
        .set({ title: input.title, password_hash: passwordHash, expires_at: input.expiresAt === undefined ? undefined : (input.expiresAt ?? null) })
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw notFound('Share');
      await record(trx, ctx, { entityType: 'soil_share', entityId: id, action: 'updated', changes: { title: input.title, password: input.password === undefined ? undefined : !!input.password, expiresAt: input.expiresAt } });
      return (await this.query(trx, id))[0];
    });
  }

  revoke(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.updateTable('soil_shares').set({ revoked_at: new Date() }).where('id', '=', id).where('revoked_at', 'is', null).returning('id').executeTakeFirst();
      if (!row) throw notFound('Share');
      await record(trx, ctx, { entityType: 'soil_share', entityId: id, action: 'revoked', changes: {} });
    });
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  private async lookup(token: string): Promise<LookupRow> {
    const row = await this.db.run(ANONYMOUS, async (trx) => (await sql<LookupRow>`SELECT * FROM app.soil_share_lookup(${token})`.execute(trx)).rows[0]);
    if (!row) throw notFound('Share');
    return row;
  }

  private status(row: LookupRow): SoilShareInfo['status'] {
    return row.revoked_at ? 'revoked' : row.expires_at && row.expires_at <= new Date() ? 'expired' : 'ok';
  }

  private info(row: LookupRow): SoilShareInfo {
    return {
      title: row.title,
      kind: row.kind,
      orgName: row.org_name,
      status: this.status(row),
      requiresPassword: !!row.password_hash,
      hasFile: row.has_file,
      locale: row.locale,
      createdAt: iso(row.created_at),
    };
  }

  async publicInfo(token: string): Promise<SoilShareInfo> {
    return this.info(await this.lookup(token));
  }

  /** The share's data, with the password (first visit) or an access token from an earlier one. */
  async open(token: string, password: string | null | undefined, accessToken: string | null | undefined): Promise<SoilShareData> {
    const row = await this.lookup(token);
    const status = this.status(row);
    if (status !== 'ok') throw new DomainError(410, `share_${status}`, `This link has been ${status === 'revoked' ? 'revoked' : 'expired'}`);
    if (row.password_hash && !verifyAccess(accessToken, row.id, row.password_hash)) {
      if (this.limiter.blocked(row.id)) throw new DomainError(429, 'too_many_attempts', 'Too many wrong passwords; try again later');
      if (!password || !(await verifySharePassword(row.password_hash, password))) {
        this.limiter.fail(row.id);
        throw new DomainError(401, 'share_password', 'Wrong password');
      }
    }
    const raw = await this.db.run(ANONYMOUS, async (trx) => (await sql<{ data: SharedField[] | null }>`SELECT app.soil_share_data(${token}) AS data`.execute(trx)).rows[0]?.data);
    if (!raw) throw notFound('Share');
    const fields: SoilShareField[] = raw.map((f) => ({
      fieldId: f.fieldId,
      fieldName: f.fieldName,
      areaHa: Number(f.areaHa),
      soilTexture: f.soilTexture,
      geometry: f.geometry,
      campaigns: f.zonations.map((n) => {
        const zones = n.zones.map((z) =>
          zoneOut(
            {
              id: z.id,
              zonation_id: n.zonationId,
              zone_no: z.zoneNo,
              label: z.label,
              color: z.color,
              area_ha: Number(z.areaHa),
              probe_nr: z.probeNr,
              mean_value: null,
              geojson: z.geometry,
              point: z.point,
              properties: z.properties,
              property_methods: z.methods,
              property_dates: z.dates,
              lab_extras: z.lab,
            },
            f.soilTexture as SoilTexture | null,
          ),
        );
        const dates = zones.flatMap((z) => Object.values(z.dates)).sort();
        return { zonationId: n.zonationId, createdAt: iso(n.createdAt), active: n.active, sampledOn: dates.at(-1) ?? null, zones };
      }),
    }));
    const measured = new Set(fields.flatMap((f) => f.campaigns.flatMap((c) => c.zones.flatMap((z) => Object.keys(z.values)))));
    return {
      ...this.info(row),
      accessToken: signAccess(row.id, row.password_hash),
      fields,
      params: ALL_RESULT_PARAMS.filter((p) => measured.has(p)),
    };
  }

  /** The archived lab file of the share, with a valid access token. */
  async file(token: string, accessToken: string | null | undefined): Promise<{ name: string; mimeType: string; size: number; stream: Readable }> {
    const row = await this.lookup(token);
    if (this.status(row) !== 'ok') throw notFound('Share');
    if (!verifyAccess(accessToken, row.id, row.password_hash)) throw new DomainError(401, 'share_password', 'Open the share first');
    const file = await this.db.run(ANONYMOUS, async (trx) => (await sql<{ name: string; mime_type: string; size_bytes: number; storage_key: string }>`SELECT * FROM app.soil_share_file(${token})`.execute(trx)).rows[0]);
    if (!file) throw notFound('File');
    return { name: file.name, mimeType: file.mime_type, size: Number(file.size_bytes), stream: await this.storage.get(file.storage_key) };
  }
}
