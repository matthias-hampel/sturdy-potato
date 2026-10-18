import { Injectable } from '@nestjs/common';
import {
  VRA_IMPERIAL,
  VraMapInput,
  vraFileName,
  type VraExportFormat,
  type VraMap,
  type VraMapInputView,
  type VraMapSummary,
  type VraMapZone,
  type VraRateUnit,
  type VraUnitSystem,
} from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import type { Out } from '../../core/validation.js';
import { dateIn, iso, round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { cropName } from '../crops/crop-name.js';
import { taskDataXml } from './export/isoxml.js';
import { polygonShapefile, type DbfField } from './export/shapefile.js';
import { zip } from './export/zip.js';

type Input = Out<typeof VraMapInput>;

interface MapRow {
  id: string;
  field_id: string;
  zoning_id: string;
  zone_count: number;
  geometry_version_id: string;
  type: VraMap['type'];
  title: string;
  unit_system: VraUnitSystem;
  status: VraMap['status'];
  version: number;
  current: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** A rate in the map's unit system: per hectare, or per acre for imperial maps. */
function displayRate(value: number, unit: VraRateUnit, system: VraUnitSystem): number {
  return system === 'imperial' ? round(value * VRA_IMPERIAL[unit].factor, 2) : value;
}
const displayUnit = (unit: VraRateUnit, system: VraUnitSystem) => (system === 'imperial' ? VRA_IMPERIAL[unit].unit : unit);

/** Variable-rate maps on the zones of a field; exported as Shapefile, ISO-XML or GeoJSON. */
@Injectable()
export class VraService {
  constructor(private readonly db: Database) {}

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
    return this.db.run(ctx, async (trx) => {
      const zoning = await this.zoning(trx, fieldId, input.zoningId);
      const { rows } = await sql<{ id: string }>`
        INSERT INTO vra_maps (organization_id, field_id, geometry_version_id, zoning_id, type, title, unit_system, status, created_by)
        VALUES (${ctx.orgId}::uuid, ${fieldId}::uuid, ${zoning.geometry_version_id}::uuid, ${zoning.id}::uuid, ${input.type},
                ${input.title}, ${input.unitSystem}, ${input.status}, ${ctx.userId}::uuid)
        RETURNING id`.execute(trx);
      const id = rows[0].id;
      await this.writeInputs(trx, ctx, id, input, zoning.zone_count);
      await record(trx, ctx, {
        entityType: 'vra_map',
        entityId: id,
        action: 'vra_map.created',
        changes: { fieldId, zoningId: zoning.id, type: input.type, title: input.title, inputs: input.inputs.length },
      });
      return this.load(trx, fieldId, id);
    });
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
      await trx
        .updateTable('vra_maps')
        .set({
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
      const meta = await sql<{ field: string; farm: string; organization: string; boundary: string; area_ha: number }>`
        SELECT f.name AS field, fa.name AS farm, o.name AS organization, ST_AsGeoJSON(g.geometry, 9) AS boundary, g.area_ha
        FROM vra_maps m
        JOIN fields f ON f.id = m.field_id
        JOIN farms fa ON fa.id = f.farm_id
        JOIN organizations o ON o.id = m.organization_id
        JOIN field_geometry_versions g ON g.id = m.geometry_version_id
        WHERE m.id = ${id}::uuid`.execute(trx);
      const info = meta.rows[0];
      const name = vraFileName(info.field, map.type, dateIn(new Date()));
      await record(trx, ctx, { entityType: 'vra_map', entityId: id, action: 'vra_map.exported', changes: { format } });

      // A single-input map has one RATE column; several inputs keep their own column names.
      const columns = map.inputs.map((i) => (map.type === 'several' ? i.columnName : 'RATE'));
      const rate = (input: VraMapInputView, zoneNo: number) => displayRate(input.rates[String(zoneNo)] ?? 0, input.unit, map.unitSystem);

      if (format === 'geojson') {
        const collection = {
          type: 'FeatureCollection',
          name,
          properties: {
            title: map.title,
            type: map.type,
            field: info.field,
            units: Object.fromEntries(map.inputs.map((i, k) => [columns[k], displayUnit(i.unit, map.unitSystem)])),
            inputs: map.inputs.map((i, k) => ({ column: columns[k], name: i.name || i.cropName, unit: displayUnit(i.unit, map.unitSystem) })),
          },
          features: map.zones.map((z) => ({
            type: 'Feature',
            geometry: z.geometry,
            properties: {
              ZONE: z.zoneNo,
              AREA_HA: z.areaHa,
              ...Object.fromEntries(map.inputs.map((i, k) => [columns[k], rate(i, z.zoneNo)])),
            },
          })),
        };
        return { filename: `${name}.geojson`, contentType: 'application/geo+json', body: Buffer.from(JSON.stringify(collection)) };
      }

      if (format === 'shp') {
        const fields: DbfField[] = [
          ...map.inputs.map((i, k) => ({ name: columns[k], length: 14, decimals: i.unit === 'seeds/ha' && map.unitSystem === 'metric' ? 0 : 2 })),
          { name: 'ZONE', length: 2, decimals: 0 },
          { name: 'AREA_HA', length: 12, decimals: 4 },
        ];
        const shape = polygonShapefile(
          fields,
          map.zones.map((z) => ({
            geometry: z.geometry,
            values: { ZONE: z.zoneNo, AREA_HA: z.areaHa, ...Object.fromEntries(map.inputs.map((i, k) => [columns[k], rate(i, z.zoneNo)])) },
          })),
        );
        const body = zip([
          { name: `${name}.shp`, data: shape.shp },
          { name: `${name}.shx`, data: shape.shx },
          { name: `${name}.dbf`, data: shape.dbf },
          { name: `${name}.prj`, data: shape.prj },
        ]);
        return { filename: `${name}.zip`, contentType: 'application/zip', body };
      }

      // ISO-XML always uses SI process data, whatever the map's display units.
      const xml = taskDataXml({
        customer: info.organization,
        farm: info.farm,
        field: { name: info.field, areaM2: info.area_ha * 10_000, boundary: JSON.parse(info.boundary) as Polygon | MultiPolygon },
        task: map.title,
        inputs: map.inputs.map((i) => ({ productName: i.productName ?? (i.name || i.cropName || i.inputType), unit: i.unit, standardRate: i.standardRate })),
        zones: map.zones.map((z) => ({ zoneNo: z.zoneNo, geometry: z.geometry, rates: map.inputs.map((i) => i.rates[String(z.zoneNo)] ?? 0) })),
      });
      return {
        filename: `${name}_ISOXML.zip`,
        contentType: 'application/zip',
        body: zip([{ name: 'TASKDATA/TASKDATA.XML', data: Buffer.from(xml, 'utf8') }]),
      };
    });
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
        column_name: input.type === 'several' ? item.columnName! : 'RATE',
        rates: JSON.stringify(Object.fromEntries(zoneNos.map((k) => [k, item.rates[k]]))),
      };
    });
    await trx.insertInto('vra_map_inputs').values(rows).execute();
  }

  private async rows(trx: Trx, fieldId: string, id?: string): Promise<MapRow[]> {
    const { rows } = await sql<MapRow>`
      SELECT m.id, m.field_id, m.zoning_id, z.zone_count, m.geometry_version_id, m.type, m.title, m.unit_system, m.status,
             m.version, (m.geometry_version_id = g.id) AS current, u.display_name AS created_by, m.created_at, m.updated_at
      FROM vra_maps m
      JOIN zonings z ON z.id = m.zoning_id
      JOIN field_current_geometry g ON g.field_id = m.field_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.field_id = ${fieldId}::uuid ${id ? sql`AND m.id = ${id}::uuid` : sql``}
      ORDER BY m.created_at DESC`.execute(trx);
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
        'i.unit', 'i.standard_rate', 'i.column_name', 'i.rates',
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
      type: r.type,
      title: r.title,
      unitSystem: r.unit_system,
      status: r.status,
      version: r.version,
      current: r.current,
      createdBy: r.created_by,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      inputs,
    };
  }

  private async load(trx: Trx, fieldId: string, id: string): Promise<VraMap> {
    const [row] = await this.rows(trx, fieldId, id);
    if (!row) throw notFound('VRA map');
    const inputs = (await this.inputs(trx, [id])).get(id) ?? [];
    const { rows: zones } = await sql<{ zone_no: number; area_ha: number; relative_productivity: number | null; geometry: string }>`
      SELECT zone_no, area_ha, relative_productivity, ST_AsGeoJSON(geometry, 9) AS geometry
      FROM zoning_zones WHERE zoning_id = ${row.zoning_id}::uuid ORDER BY zone_no`.execute(trx);
    const area = await trx.selectFrom('field_geometry_versions').select('area_ha').where('id', '=', row.geometry_version_id).executeTakeFirstOrThrow();
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
