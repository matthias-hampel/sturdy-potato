/**
 * Cadastral parcels and leases (ported from the reference's actions/cadastralParcels.ts,
 * LeaseManagementTable, LeaseAnalytics and parcelGrouping).
 *
 * - `lookup` proxies the states' cadastre services for a map extent, so parcels can be picked on
 *   the map; the extent is split into fixed grid cells, which the client caches across users.
 * - `createField` makes a field of picked parcels: the boundary is their union, the parcels are
 *   stored with it.
 * - `sync` fetches the parcels under existing fields. Like the reference it never overwrites:
 *   parcels already stored are left as they are, so lease data entered by hand survives.
 * - Leases are kept per parcel; a field's rent follows from the parcels by intersection area and
 *   feeds economics where the field has no lease of its own (see `derivedLeasePerHa`).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  type CadastralLookup,
  CadastralLookupQuery,
  type CadastralParcel,
  type CadastralParcelCandidate,
  type CadastralStatus,
  CreateFieldFromParcelsInput,
  type ExpiringLease,
  type Field,
  type FieldGeometry,
  type LeaseAnalytics,
  type LeaseBucket,
  leaseBucket,
  type LeaseFieldSummary,
  type LeaseType,
  ParcelLeaseInput,
  type ParcelSyncFieldResult,
  type ParcelSyncResult,
  type RentBasis,
  SyncParcelsInput,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { round, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { FieldsService } from '../fields/fields.service.js';
import { type BBox, CadastralClient } from './wfs/client.js';
import { WfsError } from './wfs/gml.js';
import type { NormalizedParcel } from './wfs/normalize.js';
import { resolveFederalStates } from './wfs/router.js';
import { type FederalStateConfig } from './wfs/states.js';

/** Grid the lookup extent is split into, so neighbouring map views share cached cells. */
const CELL_LON = 0.01;
const CELL_LAT = 0.00625;
/** Fields synced at the same time. */
const SYNC_CONCURRENCY = 4;
/** A parcel belongs to a field when at least this share of it lies inside (drawn boundaries are rough). */
const MIN_FIELD_SHARE = 0.01;

/** GeoJSON → valid 2D MultiPolygon in EPSG:4326 (cadastre outlines are repaired, not rejected). */
const validGeom = (g: FieldGeometry | MultiPolygon) =>
  sql<string>`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326))), 3))`;

const stateRef = (s: FederalStateConfig | null) => (s ? { code: s.code, name: s.name, attribution: s.attribution } : null);

/** Rent per year of a whole parcel, whatever basis it was entered in. */
export const rentPerYear = (amount: number | null, basis: RentBasis, areaM2: number) =>
  amount == null ? null : basis === 'per_ha' ? (amount * areaM2) / 10_000 : amount;

interface ParcelRow {
  id: string;
  field_id: string;
  field_name: string;
  official_id: string | null;
  label: string | null;
  district: string | null;
  sector: string | null;
  numerator: string | null;
  denominator: string | null;
  area_m2: number;
  source: string;
  source_state: string | null;
  synced_at: Date | null;
  geojson: MultiPolygon;
  share: number | null;
  lease_type: string | null;
  owner_name: string | null;
  owner_address: string | null;
  leaseholder_name: string | null;
  rent_amount: number | null;
  rent_basis: string | null;
  starts_on: string | null;
  ends_on: string | null;
  land_register_volume: string | null;
  land_register_sheet: string | null;
  land_register_number: string | null;
  notes: string | null;
}

/** Parcels with lease and the share of each inside its field's current boundary. */
async function parcelRows(trx: Trx, opts: { fieldIds?: string[]; parcelId?: string; geometry?: boolean } = {}): Promise<ParcelRow[]> {
  const { rows } = await sql<ParcelRow>`
    SELECT p.id, p.field_id, f.name AS field_name, p.official_id, p.label, p.district, p.sector, p.numerator, p.denominator,
           p.area_m2, p.source, p.source_state, p.synced_at,
           ${opts.geometry === false ? sql`NULL` : sql`ST_AsGeoJSON(p.geometry, 7)::json`} AS geojson,
           CASE WHEN ST_Area(p.geometry::geography) > 0
                THEN least(1, ST_Area(ST_Intersection(p.geometry, cg.geometry)::geography) / ST_Area(p.geometry::geography)) END AS share,
           l.lease_type, l.owner_name, l.owner_address, l.leaseholder_name, l.rent_amount, l.rent_basis, l.starts_on, l.ends_on,
           l.land_register_volume, l.land_register_sheet, l.land_register_number, l.notes
    FROM cadastral_parcels p
    JOIN fields f ON f.id = p.field_id
    LEFT JOIN field_current_geometry cg ON cg.field_id = p.field_id
    LEFT JOIN parcel_leases l ON l.parcel_id = p.id
    WHERE (${opts.fieldIds ?? null}::uuid[] IS NULL OR p.field_id = ANY(${opts.fieldIds ?? null}::uuid[]))
      AND (${opts.parcelId ?? null}::uuid IS NULL OR p.id = ${opts.parcelId ?? null}::uuid)
    ORDER BY f.name, p.label, p.official_id`.execute(trx);
  return rows;
}

function toParcel(r: ParcelRow): CadastralParcel {
  const lease = r.lease_type
    ? {
        leaseType: r.lease_type as LeaseType,
        ownerName: r.owner_name,
        ownerAddress: r.owner_address,
        leaseholderName: r.leaseholder_name,
        rentAmount: r.rent_amount,
        rentBasis: (r.rent_basis ?? 'per_year') as RentBasis,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        landRegisterVolume: r.land_register_volume,
        landRegisterSheet: r.land_register_sheet,
        landRegisterNumber: r.land_register_number,
        notes: r.notes,
      }
    : null;
  const rent = lease ? rentPerYear(lease.rentAmount, lease.rentBasis, r.area_m2) : null;
  return {
    id: r.id,
    fieldId: r.field_id,
    fieldName: r.field_name,
    officialId: r.official_id,
    label: r.label,
    district: r.district,
    sector: r.sector,
    numerator: r.numerator,
    denominator: r.denominator,
    areaM2: r.area_m2,
    geometry: r.geojson,
    source: r.source as 'wfs' | 'manual',
    sourceState: r.source_state,
    syncedAt: r.synced_at ? r.synced_at.toISOString() : null,
    lease,
    fieldShare: r.share == null ? null : round(r.share, 4),
    fieldAreaM2: r.share == null ? null : round(r.share * r.area_m2, 1),
    rentPerYear: rent == null ? null : round(rent),
    fieldRentPerYear: rent == null || r.share == null ? null : round(rent * r.share),
  };
}

/**
 * Rent per hectare of each field as it follows from its parcels: the rent of the parts of leased
 * parcels inside the field over the field's area. Only for fields with lease records whose every
 * lease has a rent — otherwise the figure would be too low, and economics keeps the farm's.
 */
export async function derivedLeasePerHa(trx: Trx, fieldIds?: string[]): Promise<Map<string, number>> {
  const rows = await parcelRows(trx, { fieldIds, geometry: false });
  const { rows: areas } = await sql<{ field_id: string; area_ha: number }>`
    SELECT field_id, area_ha FROM field_current_geometry
    WHERE field_id IN (SELECT DISTINCT field_id FROM cadastral_parcels)
      AND (${fieldIds ?? null}::uuid[] IS NULL OR field_id = ANY(${fieldIds ?? null}::uuid[]))`.execute(trx);
  const perField = new Map<string, { rent: number; complete: boolean; withLease: boolean }>();
  for (const r of rows) {
    const p = toParcel(r);
    const acc = perField.get(p.fieldId) ?? { rent: 0, complete: true, withLease: false };
    if (p.lease) acc.withLease = true;
    if (leaseBucket(p.lease?.leaseType) === 'leased') {
      if (p.fieldRentPerYear == null) acc.complete = false;
      else acc.rent += p.fieldRentPerYear;
    }
    perField.set(p.fieldId, acc);
  }
  const out = new Map<string, number>();
  for (const { field_id, area_ha } of areas) {
    const acc = perField.get(field_id);
    if (acc?.withLease && acc.complete && area_ha > 0) out.set(field_id, round(acc.rent / area_ha));
  }
  return out;
}

@Injectable()
export class CadastralService {
  private readonly logger = new Logger(CadastralService.name);

  constructor(
    private readonly db: Database,
    private readonly client: CadastralClient,
    private readonly fields: FieldsService,
  ) {}

  /** Parcels in a map extent, straight from the state's cadastre service. */
  async lookup(q: Out<typeof CadastralLookupQuery>): Promise<CadastralLookup> {
    const centre = resolveFederalStates((q.west + q.east) / 2, (q.south + q.north) / 2);
    if (!centre.length) return { status: 'unsupported', state: null, message: null, parcels: [] };
    const cells: { bbox: BBox; states: FederalStateConfig[] }[] = [];
    for (let x = Math.floor(q.west / CELL_LON); x * CELL_LON < q.east; x++) {
      for (let y = Math.floor(q.south / CELL_LAT); y * CELL_LAT < q.north; y++) {
        const bbox = { west: round(x * CELL_LON, 6), south: round(y * CELL_LAT, 6), east: round((x + 1) * CELL_LON, 6), north: round((y + 1) * CELL_LAT, 6) };
        // Each cell asks the states it may lie in, so views across a state border show both sides.
        const states = resolveFederalStates((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2);
        cells.push({ bbox, states: states.length ? states : centre });
      }
    }
    const results = await Promise.allSettled(cells.map((c) => this.fromStates(c.states, (state) => this.client.parcels(state, c.bbox))));
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    const found = results.flatMap((r) => (r.status === 'fulfilled' && r.value.parcels.length ? [r.value.state] : []));
    const state = found[0] ?? centre[0];
    const seen = new Set<string>();
    const parcels: CadastralParcelCandidate[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const p of r.value.parcels) {
        const key = p.officialId ?? JSON.stringify(p.geometry.coordinates[0][0][0]);
        if (seen.has(key) || !touches(p, q)) continue;
        seen.add(key);
        parcels.push(p);
      }
    }
    if (failure && !parcels.length) {
      const e = failure.reason as Error & { state?: FederalStateConfig };
      const kind = e instanceof WfsError ? e.kind : 'error';
      return { status: kind === 'no_access' ? 'no_access' : kind === 'unavailable' ? 'unavailable' : 'error', state: stateRef(e.state ?? state), message: e.message, parcels: [] };
    }
    return { status: parcels.length ? 'ok' : 'no_coverage', state: stateRef(state), message: null, parcels };
  }

  /**
   * Asks the candidate states in order until one has parcels there (state extents overlap). When
   * none has any, the most likely state's failure is passed on (e.g. Bayern's missing access), else
   * an empty result of that state.
   */
  private async fromStates(states: FederalStateConfig[], fetch: (s: FederalStateConfig) => Promise<NormalizedParcel[]>, keep: (p: NormalizedParcel[]) => boolean = (p) => p.length > 0) {
    let firstError: (Error & { state?: FederalStateConfig }) | null = null;
    for (const [i, state] of states.entries()) {
      try {
        const parcels = await fetch(state);
        if (keep(parcels)) return { state, parcels };
      } catch (e) {
        if (i === 0) firstError = Object.assign(e as Error, { state });
      }
    }
    if (firstError) throw firstError;
    return { state: states[0], parcels: [] as NormalizedParcel[] };
  }

  /** A new field made of parcels picked on the map. */
  createField(ctx: Ctx, input: Out<typeof CreateFieldFromParcelsInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ geojson: FieldGeometry | null }>`
        SELECT ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(g)), 3)), 9)::json AS geojson
        FROM (VALUES ${sql.join(input.parcels.map((p) => sql`(${validGeom(p.geometry)})`))}) AS v(g)`.execute(trx);
      const geometry = rows[0]?.geojson;
      if (!geometry) throw badRequest('invalid_geometry', 'The parcels have no area');
      const fieldId = await this.fields.insert(
        trx,
        ctx,
        { farmId: input.farmId, name: input.name, identifier: input.identifier ?? null, tenure: input.tenure, soilType: null, notes: null, geometry },
        'import',
      );
      for (const p of input.parcels) await this.insertParcel(trx, ctx, fieldId, { ...p, areaM2: p.areaM2 ?? null }, input.state ?? null, 'wfs');
      return this.fields.getIn(trx, fieldId);
    });
  }

  /** Stores a parcel unless the field has it already; its id when inserted. */
  private async insertParcel(
    trx: Trx,
    ctx: Ctx,
    fieldId: string,
    p: { [K in keyof Omit<CadastralParcelCandidate, 'areaM2' | 'geometry'>]?: string | null } & { areaM2: number | null; geometry: FieldGeometry | MultiPolygon },
    state: string | null,
    source: 'wfs' | 'manual',
  ): Promise<string | null> {
    const g = validGeom(p.geometry);
    const { rows } = await sql<{ id: string }>`
      INSERT INTO cadastral_parcels (organization_id, field_id, official_id, label, district, sector, numerator, denominator,
                                     geometry, area_m2, source, source_state, synced_at)
      SELECT ${ctx.orgId}, ${fieldId}, ${p.officialId ?? null}, ${p.label ?? null}, ${p.district ?? null}, ${p.sector ?? null},
             ${p.numerator ?? null}, ${p.denominator ?? null}, g, coalesce(${p.areaM2 ?? null}::numeric, round(ST_Area(g::geography)::numeric, 1)),
             ${source}, ${state}, ${source === 'wfs' ? sql`now()` : null}
      FROM (SELECT ${g} AS g) s
      WHERE NOT ST_IsEmpty(g)
        AND NOT EXISTS (SELECT 1 FROM cadastral_parcels x WHERE x.field_id = ${fieldId}
                        AND ((${p.officialId ?? null}::text IS NOT NULL AND x.official_id = ${p.officialId ?? null})
                             OR (${p.officialId ?? null}::text IS NULL AND x.official_id IS NULL AND ST_Equals(x.geometry, g))))
      ON CONFLICT DO NOTHING
      RETURNING id`.execute(trx);
    return rows[0]?.id ?? null;
  }

  /** A parcel drawn or entered by hand. */
  addManual(ctx: Ctx, input: { fieldId: string; label: string; officialId?: string | null; geometry: FieldGeometry }): Promise<CadastralParcel> {
    return this.db.run(ctx, async (trx) => {
      const field = await trx.selectFrom('fields').select('id').where('id', '=', input.fieldId).executeTakeFirst();
      if (!field) throw notFound('Field');
      const id = await this.insertParcel(trx, ctx, input.fieldId, { officialId: input.officialId ?? null, label: input.label, district: null, sector: null, numerator: null, denominator: null, areaM2: null, geometry: input.geometry }, null, 'manual');
      if (!id) throw badRequest('duplicate_parcel', 'The field has this parcel already');
      return toParcel((await parcelRows(trx, { parcelId: id }))[0]);
    });
  }

  /** Fetches the parcels under the given fields (all active ones by default) from the cadastre. */
  async sync(ctx: Ctx, input: Out<typeof SyncParcelsInput>): Promise<ParcelSyncResult> {
    const fields = await this.db.run(ctx, async (trx) => {
      let q = trx
        .selectFrom('fields as f')
        .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select([
          'f.id',
          'f.name',
          'f.identifier',
          sql<number>`ST_XMin(g.geometry)`.as('west'),
          sql<number>`ST_YMin(g.geometry)`.as('south'),
          sql<number>`ST_XMax(g.geometry)`.as('east'),
          sql<number>`ST_YMax(g.geometry)`.as('north'),
          sql<number>`ST_X(ST_PointOnSurface(g.geometry))`.as('lng'),
          sql<number>`ST_Y(ST_PointOnSurface(g.geometry))`.as('lat'),
        ]);
      q = input.fieldIds ? q.where('f.id', 'in', input.fieldIds) : q.where('f.status', '=', 'active');
      return q.orderBy('f.name').execute();
    });
    if (input.fieldIds && fields.length !== new Set(input.fieldIds).size) throw notFound('Field');

    const results: ParcelSyncFieldResult[] = [];
    const queue = [...fields];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) results.push(await this.syncField(ctx, f));
    };
    await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, worker));
    results.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
    const counts: Partial<Record<CadastralStatus, number>> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      fields: results,
      inserted: results.reduce((s, r) => s + r.inserted, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0),
      counts,
    };
  }

  private async syncField(
    ctx: Ctx,
    f: { id: string; name: string; identifier: string | null; west: number; south: number; east: number; north: number; lng: number; lat: number },
  ): Promise<ParcelSyncFieldResult> {
    const base = { fieldId: f.id, fieldName: f.name, inserted: 0, skipped: 0 };
    const states = resolveFederalStates(f.lng, f.lat, f.identifier);
    if (!states.length) return { ...base, status: 'unsupported', state: null, message: null };
    const started = Date.now();
    const bbox = { west: f.west, south: f.south, east: f.east, north: f.north };
    let found: { state: FederalStateConfig; parcels: NormalizedParcel[] };
    try {
      // A neighbouring state's service may answer with its own parcels across the border; the field's
      // state is the one whose parcels actually cover the field.
      const inside = { west: f.lng, east: f.lng, south: f.lat, north: f.lat };
      found = await this.fromStates(states, (state) => this.client.parcels(state, bbox), (parcels) => parcels.some((p) => touches(p, inside)));
    } catch (e) {
      const err = e as Error & { state?: FederalStateConfig };
      const kind = e instanceof WfsError ? e.kind : 'error';
      return { ...base, status: kind === 'no_access' ? 'no_access' : kind === 'unavailable' ? 'unavailable' : 'error', state: err.state?.code ?? states[0].code, message: err.message };
    }
    const { state, parcels } = found;
    try {
      return await this.db.run(ctx, async (trx) => {
        let inserted = 0;
        let matching = 0;
        for (const p of parcels) {
          const { rows } = await sql<{ share: number }>`
            SELECT CASE WHEN ST_Area(g::geography) > 0 THEN ST_Area(ST_Intersection(g, cg.geometry)::geography) / ST_Area(g::geography) ELSE 0 END AS share
            FROM (SELECT ${validGeom(p.geometry)} AS g) s, field_current_geometry cg
            WHERE cg.field_id = ${f.id} AND ST_Intersects(g, cg.geometry)`.execute(trx);
          if (!rows.length || rows[0].share < MIN_FIELD_SHARE) continue;
          matching++;
          if (await this.insertParcel(trx, ctx, f.id, p, state.code, 'wfs')) inserted++;
        }
        if (inserted) {
          await record(trx, ctx, { entityType: 'field', entityId: f.id, action: 'parcels_synced', changes: { state: state.code, inserted } });
        }
        const slow = Date.now() - started > state.expectedLatencyMs * 2.5;
        const status: CadastralStatus = matching === 0 ? 'no_coverage' : slow ? 'ok_slow' : 'ok';
        return { ...base, status, state: state.code, inserted, skipped: matching - inserted, message: null };
      });
    } catch (e) {
      this.logger.error(`Parcel sync of field ${f.id} failed: ${(e as Error).message}`);
      return { ...base, status: 'error', state: state.code, message: (e as Error).message };
    }
  }

  list(ctx: Ctx, fieldId?: string): Promise<CadastralParcel[]> {
    return this.db.run(ctx, async (trx) => (await parcelRows(trx, { fieldIds: fieldId ? [fieldId] : undefined })).map(toParcel));
  }

  setLease(ctx: Ctx, parcelId: string, input: Out<typeof ParcelLeaseInput>): Promise<CadastralParcel> {
    return this.db.run(ctx, async (trx) => {
      const parcel = await trx.selectFrom('cadastral_parcels').select(['id', 'field_id', 'label']).where('id', '=', parcelId).executeTakeFirst();
      if (!parcel) throw notFound('Parcel');
      const values = {
        lease_type: input.leaseType,
        owner_name: input.ownerName,
        owner_address: input.ownerAddress,
        leaseholder_name: input.leaseholderName,
        rent_amount: input.rentAmount ?? null,
        rent_basis: input.rentBasis,
        starts_on: input.startsOn ?? null,
        ends_on: input.endsOn ?? null,
        land_register_volume: input.landRegisterVolume,
        land_register_sheet: input.landRegisterSheet,
        land_register_number: input.landRegisterNumber,
        notes: input.notes,
      };
      await trx
        .insertInto('parcel_leases')
        .values({ parcel_id: parcelId, organization_id: ctx.orgId, ...values })
        .onConflict((oc) => oc.column('parcel_id').doUpdateSet(values))
        .execute();
      await record(trx, ctx, { entityType: 'field', entityId: parcel.field_id, action: 'parcel_lease_updated', changes: { parcelId, label: parcel.label, ...values } });
      return toParcel((await parcelRows(trx, { parcelId }))[0]);
    });
  }

  clearLease(ctx: Ctx, parcelId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('parcel_leases').where('parcel_id', '=', parcelId).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Lease');
    });
  }

  delete(ctx: Ctx, parcelId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const parcel = await trx.deleteFrom('cadastral_parcels').where('id', '=', parcelId).returning(['field_id', 'label', 'official_id']).executeTakeFirst();
      if (!parcel) throw notFound('Parcel');
      await record(trx, ctx, { entityType: 'field', entityId: parcel.field_id, action: 'parcel_removed', changes: { parcelId, label: parcel.label, officialId: parcel.official_id } });
    });
  }

  analytics(ctx: Ctx, months: number): Promise<LeaseAnalytics> {
    return this.db.run(ctx, async (trx) => {
      const parcels = (await parcelRows(trx, { geometry: false })).map(toParcel);
      const { rows: fieldRows } = await sql<{ id: string; name: string; area_ha: number; lease_per_ha: number | null; covered_ha: number | null }>`
        SELECT f.id, f.name, g.area_ha, f.lease_per_ha,
               ST_Area(ST_Intersection(g.geometry, (SELECT ST_Union(p.geometry) FROM cadastral_parcels p WHERE p.field_id = f.id))::geography) / 10000 AS covered_ha
        FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
        WHERE f.id IN (SELECT field_id FROM cadastral_parcels)
        ORDER BY f.name`.execute(trx);
      const derived = await derivedLeasePerHa(trx);

      const asOf = today();
      const horizon = new Date(`${asOf}T00:00:00Z`);
      horizon.setUTCMonth(horizon.getUTCMonth() + months);
      const pastLimit = new Date(`${asOf}T00:00:00Z`);
      pastLimit.setUTCFullYear(pastLimit.getUTCFullYear() - 1);
      const dayMs = 86_400_000;

      const buckets = new Map<LeaseBucket, { areaHa: number; parcelCount: number; rentPerYear: number }>();
      const perField = new Map<string, { owned: number; leased: number; other: number; rent: number; rentedHa: number }>();
      const expiring: ExpiringLease[] = [];
      let leasedParcels = 0;
      let leasedParcelsWithRent = 0;
      let rentedHa = 0;
      for (const p of parcels) {
        const ha = (p.fieldAreaM2 ?? 0) / 10_000;
        const bucket = leaseBucket(p.lease?.leaseType);
        const b = buckets.get(bucket) ?? { areaHa: 0, parcelCount: 0, rentPerYear: 0 };
        b.areaHa += ha;
        b.parcelCount += 1;
        const f = perField.get(p.fieldId) ?? { owned: 0, leased: 0, other: 0, rent: 0, rentedHa: 0 };
        if (bucket === 'ownership') f.owned += ha;
        else if (bucket === 'leased') {
          f.leased += ha;
          leasedParcels += 1;
          if (p.fieldRentPerYear != null) {
            leasedParcelsWithRent += 1;
            b.rentPerYear += p.fieldRentPerYear;
            f.rent += p.fieldRentPerYear;
            f.rentedHa += ha;
            rentedHa += ha;
          }
        } else f.other += ha;
        buckets.set(bucket, b);
        perField.set(p.fieldId, f);
        const end = p.lease?.endsOn;
        if (end && bucket !== 'ownership') {
          const endDate = new Date(`${end}T00:00:00Z`);
          if (endDate <= horizon && endDate >= pastLimit) {
            expiring.push({
              parcelId: p.id,
              fieldId: p.fieldId,
              fieldName: p.fieldName,
              label: p.label ?? p.officialId,
              ownerName: p.lease?.ownerName ?? null,
              endsOn: end,
              daysLeft: Math.round((endDate.getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / dayMs),
              rentPerYear: p.rentPerYear,
            });
          }
        }
      }
      expiring.sort((a, b) => a.endsOn.localeCompare(b.endsOn));

      const fields: LeaseFieldSummary[] = fieldRows.map((r) => {
        const f = perField.get(r.id) ?? { owned: 0, leased: 0, other: 0, rent: 0, rentedHa: 0 };
        const d = derived.get(r.id) ?? null;
        return {
          fieldId: r.id,
          fieldName: r.name,
          fieldAreaHa: round(r.area_ha, 4),
          ownedHa: round(f.owned, 4),
          leasedHa: round(f.leased, 4),
          otherHa: round(f.other, 4),
          uncoveredHa: round(Math.max(0, r.area_ha - (r.covered_ha ?? 0)), 4),
          rentPerYear: round(f.rent),
          rentPerLeasedHa: f.rentedHa > 0 ? round(f.rent / f.rentedHa) : null,
          derivedLeasePerHa: d,
          leasePerHa: r.lease_per_ha,
          effectiveLeasePerHa: r.lease_per_ha ?? d,
        };
      });
      const totalRent = [...perField.values()].reduce((s, f) => s + f.rent, 0);
      const order: LeaseBucket[] = ['ownership', 'leased', 'land_exchange', 'abandoned', 'unknown'];
      return {
        asOf,
        parcelCount: parcels.length,
        areaHa: round([...buckets.values()].reduce((s, b) => s + b.areaHa, 0), 4),
        ownedHa: round(buckets.get('ownership')?.areaHa ?? 0, 4),
        leasedHa: round(buckets.get('leased')?.areaHa ?? 0, 4),
        rentPerYear: round(totalRent),
        rentPerLeasedHa: rentedHa > 0 ? round(totalRent / rentedHa) : null,
        leasedParcels,
        leasedParcelsWithRent,
        byBucket: order.filter((k) => buckets.has(k)).map((k) => {
          const b = buckets.get(k)!;
          return { bucket: k, areaHa: round(b.areaHa, 4), parcelCount: b.parcelCount, rentPerYear: round(b.rentPerYear) };
        }),
        fields,
        expiring,
      };
    });
  }
}

/** Whether a parcel's extent overlaps the requested map extent. */
function touches(p: NormalizedParcel, b: BBox): boolean {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of p.geometry.coordinates)
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  return w <= b.east && e >= b.west && s <= b.north && n >= b.south;
}

