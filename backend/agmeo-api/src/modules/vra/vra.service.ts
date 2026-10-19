import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BulkVraInput,
  strategyRates,
  VraMapInput,
  vraFileName,
  type BulkVraResult,
  type VraExportFormat,
  type VraMap,
  type VraMapInputView,
  type VraMapListItem,
  type VraMapSummary,
  type VraMapZone,
  type VraRateUnit,
  type VraStrategy,
  type VraUnitSystem,
} from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { sql } from 'kysely';
import { ZodError } from 'zod';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import type { Out } from '../../core/validation.js';
import { dateIn, iso, round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { cropName } from '../crops/crop-name.js';
import { zoneRows } from '../productivity/zone-rows.js';
import { VraBasesService } from './bases.service.js';
import { taskDataXmlMulti } from './export/isoxml.js';
import { prescriptionGeojson, prescriptionShapefile, prescriptionTask, type PrescriptionMeta } from './export/prescription.js';
import { zip, type ZipEntry } from './export/zip.js';

type Input = Out<typeof VraMapInput>;
type BulkInput = Out<typeof BulkVraInput>;

interface MapRow {
  id: string;
  field_id: string;
  zoning_id: string;
  zone_count: number;
  operation_id: string | null;
  geometry_version_id: string;
  type: VraMap['type'];
  title: string;
  unit_system: VraUnitSystem;
  status: VraMap['status'];
  version: number;
  current: boolean;
  batch_id: string | null;
  zoning_source: string;
  zoning_name: string | null;
  field_name: string;
  farm_name: string;
  field_area_ha: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** File name segment: ASCII letters, digits, dot, dash and underscore. */
const safe = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'map';

/** Variable-rate maps on the zones of a field; exported as Shapefile, ISO-XML or GeoJSON. */
@Injectable()
export class VraService {
  constructor(
    private readonly db: Database,
    private readonly bases: VraBasesService,
  ) {}

  /** The maps of the organization (reference application-maps page), optionally of one field or batch. */
  listOrg(ctx: Ctx, query: { fieldId?: string; batchId?: string }): Promise<VraMapListItem[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await this.rows(trx, query.fieldId ?? null, undefined, query.batchId ?? null);
      const inputs = await this.inputs(trx, rows.map((r) => r.id));
      return rows.map((r) => ({ ...this.summary(r, inputs.get(r.id) ?? []), fieldName: r.field_name, farmName: r.farm_name, fieldAreaHa: Number(r.field_area_ha) }));
    });
  }

  list(ctx: Ctx, fieldId: string): Promise<VraMapSummary[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await this.rows(trx, fieldId);
      const inputs = await this.inputs(trx, rows.map((r) => r.id));
      return rows.map((r) => this.summary(r, inputs.get(r.id) ?? []));
    });
  }

  get(ctx: Ctx, fieldId: string, id: string): Promise<VraMap> {
    return this.db.run(ctx, (trx) => this.load(trx, fieldId, id));
  }

  create(ctx: Ctx, fieldId: string, input: Input): Promise<VraMap> {
    return this.db.run(ctx, async (trx) => this.load(trx, fieldId, await this.insert(trx, ctx, fieldId, input, null)));
  }

  private async insert(trx: Trx, ctx: Ctx, fieldId: string, input: Input, batchId: string | null): Promise<string> {
    const zoning = await this.zoning(trx, fieldId, input.zoningId);
    const operationId = await this.operation(trx, fieldId, input.operationId);
    const { rows } = await sql<{ id: string }>`
      INSERT INTO vra_maps (organization_id, field_id, geometry_version_id, zoning_id, operation_id, type, title, unit_system, status, created_by, batch_id)
      VALUES (${ctx.orgId}::uuid, ${fieldId}::uuid, ${zoning.geometry_version_id}::uuid, ${zoning.id}::uuid, ${operationId}::uuid, ${input.type},
              ${input.title}, ${input.unitSystem}, ${input.status}, ${ctx.userId}::uuid, ${batchId}::uuid)
      RETURNING id`.execute(trx);
    const id = rows[0].id;
    await this.writeInputs(trx, ctx, id, input, zoning.zone_count);
    await record(trx, ctx, {
      entityType: 'vra_map',
      entityId: id,
      action: 'vra_map.created',
      changes: { fieldId, zoningId: zoning.id, operationId, type: input.type, title: input.title, inputs: input.inputs.length, batchId },
    });
    return id;
  }

  /**
   * Maps for many fields at once (reference bulk setup): per field the chosen base zoning — the
   * field's default, productivity, yield, soil or uniform — else the fallback, and the zone rates
   * of the strategy around the field's standard rate. Fields left without a map are reported.
   */
  bulk(ctx: Ctx, input: BulkInput): Promise<BulkVraResult> {
    return this.db.run(ctx, async (trx) => {
      const batchId = randomUUID();
      const names = new Map(
        (await trx.selectFrom('fields').select(['id', 'name']).where('id', 'in', input.fields.map((f) => f.fieldId)).execute()).map((f) => [f.id, f.name]),
      );
      const product = input.input.productId
        ? await trx.selectFrom('products').select('name').where('id', '=', input.input.productId).executeTakeFirst()
        : null;
      if (input.input.productId && !product) throw notFound('Product');
      const created: string[] = [];
      const failed: BulkVraResult['failed'] = [];
      for (const f of input.fields) {
        const fieldName = names.get(f.fieldId) ?? null;
        if (!fieldName) {
          failed.push({ fieldId: f.fieldId, fieldName, code: 'not_found' });
          continue;
        }
        const zoningId = await this.bulkBase(trx, ctx, f.fieldId, input.base, input.fallback, f.zoneCount ?? input.zoneCount);
        if (!zoningId) {
          failed.push({ fieldId: f.fieldId, fieldName, code: 'no_zoning' });
          continue;
        }
        const zones = await trx
          .selectFrom('zoning_zones')
          .select(['zone_no', 'area_ha', 'relative_productivity'])
          .where('zoning_id', '=', zoningId)
          .orderBy('zone_no')
          .execute();
        const standardRate = f.standardRate ?? input.input.standardRate;
        const rates = strategyRates(
          zones.map((z) => ({ zoneNo: z.zone_no, areaHa: Number(z.area_ha), relativeProductivity: z.relative_productivity == null ? null : Number(z.relative_productivity) })),
          standardRate,
          input.strategy,
          input.input.unit,
          input.rateStep,
        );
        let payload: Input;
        try {
          payload = VraMapInput.parse({
            zoningId,
            type: input.type,
            title: input.title.replaceAll('{field}', fieldName).slice(0, 120),
            unitSystem: input.unitSystem,
            status: input.status,
            inputs: [
              {
                inputType: input.type,
                productId: input.input.productId ?? null,
                cropId: input.type === 'sowing' ? (input.input.cropId ?? null) : null,
                name: input.input.name || product?.name || '',
                unit: input.input.unit,
                standardRate,
                germinationPct: input.input.germinationPct ?? null,
                strategy: input.strategy,
                rates,
              },
            ],
          });
        } catch (e) {
          if (!(e instanceof ZodError)) throw e;
          failed.push({ fieldId: f.fieldId, fieldName, code: 'invalid' });
          continue;
        }
        created.push(await this.insert(trx, ctx, f.fieldId, payload, batchId));
      }
      await record(trx, ctx, { entityType: 'vra_map', entityId: batchId, action: 'vra_map.bulk_created', changes: { maps: created.length, failed: failed.length, base: input.base } });
      const rows = created.length ? await this.rows(trx, null, undefined, batchId) : [];
      const inputs = await this.inputs(trx, rows.map((r) => r.id));
      return {
        batchId,
        created: rows.map((r) => ({ ...this.summary(r, inputs.get(r.id) ?? []), fieldName: r.field_name, farmName: r.farm_name, fieldAreaHa: Number(r.field_area_ha) })),
        failed,
      };
    });
  }

  /** The zoning a bulk map of a field is made on, or null. */
  private async bulkBase(trx: Trx, ctx: Ctx, fieldId: string, base: BulkInput['base'], fallback: BulkInput['fallback'], zoneCount: number): Promise<string | null> {
    const productivity = async () => {
      const { rows } = await sql<{ id: string }>`
        SELECT z.id FROM zonings z
        WHERE z.analysis_id = (
          SELECT a.id FROM productivity_analyses a JOIN field_current_geometry g ON g.id = a.geometry_version_id
          WHERE g.field_id = ${fieldId}::uuid AND a.status = 'finished' ORDER BY a.finished_at DESC NULLS LAST LIMIT 1)
          AND NOT z.is_custom
        ORDER BY abs(z.zone_count - ${zoneCount}), z.zone_count LIMIT 1`.execute(trx);
      return rows[0]?.id ?? null;
    };
    const pick = async (which: BulkInput['base']): Promise<string | null> => {
      if (which === 'default') {
        const z = await trx.selectFrom('zonings').select('id').where('field_id', '=', fieldId).where('is_default', '=', true).executeTakeFirst();
        return z?.id ?? null;
      }
      if (which === 'productivity') return productivity();
      if (which === 'yield') {
        const { rows } = await sql<{ id: string }>`
          SELECT z.id FROM zonings z JOIN field_current_geometry g ON g.field_id = z.field_id AND g.id = z.geometry_version_id
          WHERE z.field_id = ${fieldId}::uuid AND z.source IN ('yield_map', 'yield_estimate') AND z.listed
          ORDER BY (z.source = 'yield_map') DESC, z.created_at DESC LIMIT 1`.execute(trx);
        return rows[0]?.id ?? null;
      }
      if (which === 'soil') return this.bases.soilZoning(trx, ctx, fieldId, null);
      return this.bases.uniformZoning(trx, ctx, fieldId, null);
    };
    const chosen = await pick(base);
    if (chosen || fallback === 'skip') return chosen;
    return pick(fallback === 'uniform' ? 'uniform' : 'productivity');
  }

  update(ctx: Ctx, fieldId: string, id: string, input: Input): Promise<VraMap> {
    return this.db.run(ctx, async (trx) => {
      const current = await trx
        .selectFrom('vra_maps')
        .select(['id', 'version', 'title', 'status', 'type', 'zoning_id'])
        .where('id', '=', id)
        .where('field_id', '=', fieldId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound('VRA map');
      if (input.version == null) throw badRequest('version_required', 'Send the version the change is based on');
      if (input.version !== current.version) throw conflict('version_conflict', 'This VRA map was changed by someone else. Reload and try again.');
      const zoning = await this.zoning(trx, fieldId, input.zoningId);
      const operationId = input.operationId === undefined ? undefined : await this.operation(trx, fieldId, input.operationId);
      await trx
        .updateTable('vra_maps')
        .set({
          ...(operationId === undefined ? {} : { operation_id: operationId }),
          zoning_id: zoning.id,
          geometry_version_id: zoning.geometry_version_id,
          type: input.type,
          title: input.title,
          unit_system: input.unitSystem,
          status: input.status,
          version: current.version + 1,
        })
        .where('id', '=', id)
        .execute();
      await trx.deleteFrom('vra_map_inputs').where('vra_map_id', '=', id).execute();
      await this.writeInputs(trx, ctx, id, input, zoning.zone_count);
      await record(trx, ctx, {
        entityType: 'vra_map',
        entityId: id,
        action: 'vra_map.updated',
        changes: { title: input.title, status: input.status, type: input.type, zoningId: zoning.id, version: current.version + 1 },
      });
      return this.load(trx, fieldId, id);
    });
  }

  delete(ctx: Ctx, fieldId: string, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const gone = await trx.deleteFrom('vra_maps').where('id', '=', id).where('field_id', '=', fieldId).returning(['title']).executeTakeFirst();
      if (!gone) throw notFound('VRA map');
      await record(trx, ctx, { entityType: 'vra_map', entityId: id, action: 'vra_map.deleted', changes: { fieldId, title: gone.title } });
    });
  }

  export(ctx: Ctx, fieldId: string, id: string, format: VraExportFormat): Promise<ExportFile> {
    return this.db.run(ctx, async (trx) => {
      const map = await this.load(trx, fieldId, id);
      const meta = await this.meta(trx, id);
      const name = vraFileName(meta.field, map.type, dateIn(new Date()));
      await record(trx, ctx, { entityType: 'vra_map', entityId: id, action: 'vra_map.exported', changes: { format } });
      if (format === 'geojson') {
        return { filename: `${name}.geojson`, contentType: 'application/geo+json', body: Buffer.from(JSON.stringify(prescriptionGeojson(map, meta, name))) };
      }
      if (format === 'shp') return { filename: `${name}.zip`, contentType: 'application/zip', body: zip(prescriptionShapefile(map, name)) };
      const xml = taskDataXmlMulti(meta.organization, [prescriptionTask(map, meta)]);
      return { filename: `${name}_ISOXML.zip`, contentType: 'application/zip', body: zip([{ name: 'TASKDATA/TASKDATA.XML', data: Buffer.from(xml, 'utf8') }]) };
    });
  }

  /**
   * Several maps in one ZIP (reference batch export): ISO-XML as one TASKDATA with a task per map,
   * Shapefiles in a folder per map, GeoJSON as one file per map.
   */
  exportBatch(ctx: Ctx, mapIds: string[], format: VraExportFormat): Promise<ExportFile> {
    return this.db.run(ctx, async (trx) => {
      const found = await trx.selectFrom('vra_maps').select(['id', 'field_id']).where('id', 'in', mapIds).execute();
      if (found.length !== new Set(mapIds).size) throw notFound('VRA map');
      const byId = new Map(found.map((m) => [m.id, m.field_id]));
      const used = new Set<string>();
      const entries: ZipEntry[] = [];
      const tasks: ReturnType<typeof prescriptionTask>[] = [];
      let customer = '';
      for (const id of [...new Set(mapIds)]) {
        const map = await this.load(trx, byId.get(id)!, id);
        const meta = await this.meta(trx, id);
        customer = meta.organization;
        let name = vraFileName(meta.field, map.type, dateIn(new Date()));
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${vraFileName(meta.field, map.type, dateIn(new Date()))}_${n}`;
        used.add(name.toLowerCase());
        if (format === 'isoxml') tasks.push(prescriptionTask(map, meta));
        else if (format === 'shp') entries.push(...prescriptionShapefile(map, name, name));
        else entries.push({ name: `${name}.geojson`, data: Buffer.from(JSON.stringify(prescriptionGeojson(map, meta, name))) });
        await record(trx, ctx, { entityType: 'vra_map', entityId: id, action: 'vra_map.exported', changes: { format, batch: true } });
      }
      if (format === 'isoxml') entries.push({ name: 'TASKDATA/TASKDATA.XML', data: Buffer.from(taskDataXmlMulti(customer, tasks), 'utf8') });
      const base = `${safe(customer).slice(0, 40)}_VRA_${dateIn(new Date())}`;
      return { filename: `${base}${format === 'isoxml' ? '_ISOXML' : ''}.zip`, contentType: 'application/zip', body: zip(entries) };
    });
  }

  private async meta(trx: Trx, mapId: string): Promise<PrescriptionMeta> {
    const { rows } = await sql<{ field: string; farm: string; organization: string; boundary: string; area_ha: number }>`
      SELECT f.name AS field, fa.name AS farm, o.name AS organization, ST_AsGeoJSON(g.geometry, 9) AS boundary, g.area_ha::float8 AS area_ha
      FROM vra_maps m
      JOIN fields f ON f.id = m.field_id
      JOIN farms fa ON fa.id = f.farm_id
      JOIN organizations o ON o.id = m.organization_id
      JOIN field_geometry_versions g ON g.id = m.geometry_version_id
      WHERE m.id = ${mapId}::uuid`.execute(trx);
    const r = rows[0];
    return { field: r.field, farm: r.farm, organization: r.organization, boundary: JSON.parse(r.boundary) as Polygon | MultiPolygon, areaHa: Number(r.area_ha) };
  }

  private async zoning(trx: Trx, fieldId: string, zoningId: string) {
    const zoning = await trx
      .selectFrom('zonings')
      .select(['id', 'geometry_version_id', 'zone_count'])
      .where('id', '=', zoningId)
      .where('field_id', '=', fieldId)
      .executeTakeFirst();
    if (!zoning) throw notFound('Zoning');
    return zoning;
  }

  /** The operation a map is linked to; it must treat the map's field (a second map for it fails on the unique index). */
  private async operation(trx: Trx, fieldId: string, operationId: string | null | undefined): Promise<string | null> {
    if (!operationId) return null;
    const treats = await trx
      .selectFrom('operation_fields')
      .select('operation_id')
      .where('operation_id', '=', operationId)
      .where('field_id', '=', fieldId)
      .executeTakeFirst();
    if (!treats) throw notFound('Operation');
    return operationId;
  }

  private async writeInputs(trx: Trx, ctx: Ctx, mapId: string, input: Input, zoneCount: number) {
    const zoneNos = Array.from({ length: zoneCount }, (_, i) => String(i + 1));
    const productIds = input.inputs.map((i) => i.productId).filter((p): p is string => !!p);
    const cropIds = input.inputs.map((i) => i.cropId).filter((c): c is string => !!c);
    const products = new Map(
      productIds.length
        ? (await trx.selectFrom('products').select(['id', 'name']).where('id', 'in', productIds).execute()).map((p) => [p.id, p.name])
        : [],
    );
    const crops = new Map(
      cropIds.length ? (await trx.selectFrom('crops as c').select(['c.id', cropName('c').as('name')]).where('c.id', 'in', cropIds).execute()).map((c) => [c.id, c.name]) : [],
    );
    const rows = input.inputs.map((item, position) => {
      const keys = Object.keys(item.rates).sort();
      if (keys.length !== zoneNos.length || keys.some((k, i) => k !== zoneNos[i]))
        throw badRequest('invalid_rates', `Give a rate for each of the ${zoneCount} zones`, { path: `inputs.${position}.rates` });
      if (item.productId && !products.has(item.productId)) throw notFound('Product');
      if (item.cropId && !crops.has(item.cropId)) throw notFound('Crop');
      const name = item.name || (item.productId ? products.get(item.productId)! : '') || (item.cropId ? crops.get(item.cropId)! : '');
      return {
        organization_id: ctx.orgId,
        vra_map_id: mapId,
        position,
        input_type: item.inputType,
        product_id: item.productId ?? null,
        crop_id: item.cropId ?? null,
        name,
        unit: item.unit,
        standard_rate: item.standardRate ?? null,
        germination_pct: item.unit === 'plants/ha' ? (item.germinationPct ?? null) : null,
        strategy: item.strategy ?? null,
        column_name: input.type === 'several' ? item.columnName! : 'RATE',
        rates: JSON.stringify(Object.fromEntries(zoneNos.map((k) => [k, item.rates[k]]))),
      };
    });
    await trx.insertInto('vra_map_inputs').values(rows).execute();
  }

  private async rows(trx: Trx, fieldId: string | null, id?: string, batchId: string | null = null): Promise<MapRow[]> {
    const { rows } = await sql<MapRow>`
      SELECT m.id, m.field_id, m.zoning_id, z.zone_count, m.operation_id, m.geometry_version_id, m.type, m.title, m.unit_system, m.status,
             m.version, (m.geometry_version_id = g.id) AS current, m.batch_id, z.source AS zoning_source, z.name AS zoning_name,
             f.name AS field_name, fa.name AS farm_name, g.area_ha::float8 AS field_area_ha,
             u.display_name AS created_by, m.created_at, m.updated_at
      FROM vra_maps m
      JOIN zonings z ON z.id = m.zoning_id
      JOIN fields f ON f.id = m.field_id
      JOIN farms fa ON fa.id = f.farm_id
      JOIN field_current_geometry g ON g.field_id = m.field_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE true ${fieldId ? sql`AND m.field_id = ${fieldId}::uuid` : sql``} ${id ? sql`AND m.id = ${id}::uuid` : sql``}
        ${batchId ? sql`AND m.batch_id = ${batchId}::uuid` : sql``}
      ORDER BY m.created_at DESC, f.name`.execute(trx);
    return rows;
  }

  private async inputs(trx: Trx, mapIds: string[]): Promise<Map<string, VraMapInputView[]>> {
    const out = new Map<string, VraMapInputView[]>();
    if (!mapIds.length) return out;
    const rows = await trx
      .selectFrom('vra_map_inputs as i')
      .leftJoin('products as p', 'p.id', 'i.product_id')
      .leftJoin('crops as c', 'c.id', 'i.crop_id')
      .select([
        'i.id', 'i.vra_map_id', 'i.input_type', 'i.product_id', 'p.name as product_name', 'i.crop_id', cropName<string | null>('c').as('crop_name'), 'i.name',
        'i.unit', 'i.standard_rate', 'i.column_name', 'i.rates', 'i.germination_pct', 'i.strategy',
      ])
      .where('i.vra_map_id', 'in', mapIds)
      .orderBy('i.position')
      .execute();
    for (const r of rows) {
      const list = out.get(r.vra_map_id) ?? [];
      list.push({
        id: r.id,
        inputType: r.input_type as VraMapInputView['inputType'],
        productId: r.product_id,
        productName: r.product_name,
        cropId: r.crop_id,
        cropName: r.crop_name,
        name: r.name,
        unit: r.unit as VraRateUnit,
        standardRate: r.standard_rate,
        columnName: r.column_name,
        rates: r.rates as Record<string, number>,
        germinationPct: r.germination_pct == null ? null : Number(r.germination_pct),
        strategy: r.strategy as VraStrategy | null,
      });
      out.set(r.vra_map_id, list);
    }
    return out;
  }

  private summary(r: MapRow, inputs: VraMapInputView[]): VraMapSummary {
    return {
      id: r.id,
      fieldId: r.field_id,
      zoningId: r.zoning_id,
      zoneCount: r.zone_count,
      operationId: r.operation_id,
      type: r.type,
      title: r.title,
      unitSystem: r.unit_system,
      status: r.status,
      version: r.version,
      current: r.current,
      batchId: r.batch_id,
      zoningSource: r.zoning_source,
      zoningName: r.zoning_name,
      createdBy: r.created_by,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      inputs,
    };
  }

  /**
   * The field parts a map is spread on: those its operation treats on the map's field. A map of
   * an operation on a part holds only the part's share of the zones, so the rest of the field
   * (e.g. a flower strip) is outside every zone and gets rate 0 in ISO-XML and nothing in
   * Shapefile/GeoJSON. Null for the whole field.
   */
  private async parts(trx: Trx, row: MapRow): Promise<{ ids: string[]; area_ha: number } | null> {
    if (!row.operation_id) return null;
    const { rows } = await sql<{ whole: boolean | null; ids: string[] | null }>`
      SELECT bool_or(field_part_id IS NULL) AS whole, array_agg(DISTINCT field_part_id) FILTER (WHERE field_part_id IS NOT NULL) AS ids
      FROM operation_fields WHERE operation_id = ${row.operation_id}::uuid AND field_id = ${row.field_id}::uuid`.execute(trx);
    const ids = rows[0]?.whole === false ? rows[0].ids : null;
    if (!ids?.length) return null;
    const area = await trx.selectFrom('field_parts').select((eb) => eb.fn.sum<number>('area_ha').as('area_ha')).where('id', 'in', ids).executeTakeFirstOrThrow();
    return { ids, area_ha: Number(area.area_ha) };
  }

  private async load(trx: Trx, fieldId: string, id: string): Promise<VraMap> {
    const [row] = await this.rows(trx, fieldId, id);
    if (!row) throw notFound('VRA map');
    const inputs = (await this.inputs(trx, [id])).get(id) ?? [];
    const parts = await this.parts(trx, row);
    const zones = await zoneRows(trx, [row.zoning_id], parts?.ids ?? null, 9);
    const area = parts ?? (await trx.selectFrom('field_geometry_versions').select('area_ha').where('id', '=', row.geometry_version_id).executeTakeFirstOrThrow());
    const total = zones.reduce((s, z) => s + z.area_ha, 0);
    return {
      ...this.summary(row, inputs),
      fieldAreaHa: area.area_ha,
      zones: zones.map(
        (z): VraMapZone => ({
          zoneNo: z.zone_no,
          areaHa: z.area_ha,
          sharePct: total ? round((100 * z.area_ha) / total, 1) : 0,
          relativeProductivity: z.relative_productivity,
          geometry: JSON.parse(z.geometry) as MultiPolygon,
        }),
      ),
    };
  }
}
