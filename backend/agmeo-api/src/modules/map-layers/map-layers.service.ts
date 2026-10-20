import { Injectable } from '@nestjs/common';
import {
  can,
  isSoilParameter,
  type MapFieldKpi,
  type MapKpis,
  type MapSoil,
  type MapTrafficability,
  SOIL_PARAMETERS,
  type SoilParameter,
  type SoilTexture,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, DomainError, notFound } from '../../core/errors.js';
import { round } from '../../core/mappers.js';
import { Database } from '../../db/database.js';
import { CarbonService } from '../carbon/carbon.service.js';
import { ProfitabilityService } from '../economics/profitability.service.js';
import { zoneClasses, zoneStrings, zoneValues } from '../soil/soil-rows.js';
import { FieldConditionsService } from '../weather/field-conditions.service.js';

/** Most fields one trafficability map evaluates (each runs its own soil water balance). */
const MAX_TRAFFICABILITY_FIELDS = 400;

const CLASS_KEY: Partial<Record<SoilParameter, 'ph' | 'p' | 'k' | 'mg'>> = { ph: 'ph', p2o5: 'p', k2o: 'k', mgo: 'mg' };

interface Acc {
  area: number;
  crops: Map<string, number>;
  db1: [number, number];
  yield: [number, number];
  co2e: [number, number];
  n: [number, number];
}

const weighted = ([sum, area]: [number, number], digits: number) => (area > 0 ? round(sum / area, digits) : null);

/**
 * Data of the organization map's thematic layers (agmeo `_components/mapLayers`): key figures per
 * field (margin, yield, CO2e, N), soil zones with a parameter, and trafficability for a machine.
 */
@Injectable()
export class MapLayersService {
  constructor(
    private readonly db: Database,
    private readonly profitability: ProfitabilityService,
    private readonly carbon: CarbonService,
    private readonly conditions: FieldConditionsService,
  ) {}

  async kpis(ctx: Ctx, seasonId?: string): Promise<MapKpis> {
    const finance = can(ctx.role, 'finance.read');
    const p = await this.profitability.farm(ctx, seasonId);
    if (!p) return { seasonId: null, harvestYear: null, currency: 'EUR', finance, fields: [] };
    const analysis = await this.db.run(ctx, (trx) => this.carbon.analysisIn(trx, ctx.orgId, 'field', [p.harvestYear]));
    const co2eByCycle = new Map(analysis.rows.map((r) => [r.entityId, r.areaHa ? r.total / r.areaHa : null]));
    const acc = new Map<string, Acc>();
    for (const f of p.fields) {
      const a = acc.get(f.fieldId) ?? { area: 0, crops: new Map(), db1: [0, 0], yield: [0, 0], co2e: [0, 0], n: [0, 0] };
      acc.set(f.fieldId, a);
      const area = f.areaHa;
      a.area += area;
      a.crops.set(f.cropName, (a.crops.get(f.cropName) ?? 0) + area);
      const add = (t: [number, number], v: number | null | undefined) => {
        if (v == null || !Number.isFinite(v)) return;
        t[0] += v * area;
        t[1] += area;
      };
      add(a.db1, f.db1);
      add(a.yield, f.yieldTHa);
      add(a.n, f.nKgHa);
      add(a.co2e, co2eByCycle.get(f.cropCycleId));
    }
    const fields: MapFieldKpi[] = [...acc].map(([fieldId, a]) => {
      const crops = [...a.crops].sort((x, y) => y[1] - x[1]);
      return {
        fieldId,
        cropNames: crops.map(([name]) => name),
        cropName: crops[0]?.[0] ?? null,
        areaHa: round(a.area, 4),
        db1PerHa: finance ? weighted(a.db1, 0) : null,
        yieldTHa: weighted(a.yield, 2),
        co2eKgPerHa: weighted(a.co2e, 0),
        nKgPerHa: weighted(a.n, 0),
      };
    });
    return { seasonId: p.seasonId, harvestYear: p.harvestYear, currency: p.currency, finance, fields };
  }

  /** Zones of every field's active zonation with the parameter's value and content class. */
  soil(ctx: Ctx, parameter: SoilParameter): Promise<MapSoil> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{
        id: string;
        field_id: string;
        field_name: string;
        soil_texture: string | null;
        label: string;
        area_ha: number;
        properties: Record<string, unknown>;
        property_methods: Record<string, unknown>;
        property_dates: Record<string, unknown>;
        geojson: MultiPolygon;
      }>`
        SELECT s.id, f.id AS field_id, f.name AS field_name, f.soil_texture, s.label, s.area_ha::float8 AS area_ha,
               s.properties, s.property_methods, s.property_dates, ST_AsGeoJSON(s.geometry, 7)::json AS geojson
        FROM soil_zonations z
        JOIN fields f ON f.id = z.field_id AND f.status = 'active'
        JOIN soil_zones s ON s.zonation_id = z.id
        WHERE z.status = 'ready' AND z.superseded_at IS NULL
        ORDER BY f.name, s.zone_no`.execute(trx);
      const available = new Set<SoilParameter>();
      const zones = rows.map((r) => {
        const values = zoneValues(r.properties);
        for (const k of Object.keys(values)) if (isSoilParameter(k)) available.add(k);
        const classKey = CLASS_KEY[parameter];
        const dates = zoneStrings(r.property_dates);
        return {
          id: r.id,
          fieldId: r.field_id,
          fieldName: r.field_name,
          label: r.label,
          areaHa: round(Number(r.area_ha), 4),
          value: values[parameter] ?? null,
          contentClass: classKey ? zoneClasses(values, zoneStrings(r.property_methods), r.soil_texture as SoilTexture | null)[classKey] : null,
          sampledOn: dates[parameter] ?? null,
          geometry: r.geojson,
        };
      });
      return { parameter, zones, available: SOIL_PARAMETERS.filter((p) => available.has(p)) };
    });
  }

  /** Soil compaction index of a machine on every field with a soil class, for one day (0 = today … 7). */
  async trafficability(ctx: Ctx, equipmentId: string, day: number): Promise<MapTrafficability> {
    const fields = await this.db.run(ctx, async (trx) => {
      const machine = await trx.selectFrom('equipment').select(['id', 'class']).where('id', '=', equipmentId).executeTakeFirst();
      if (!machine) throw notFound('Machine');
      if (machine.class !== 'machine') throw badRequest('not_a_machine', 'Choose a machine, not an implement');
      return trx.selectFrom('fields').select(['id', 'soil_texture']).where('status', '=', 'active').orderBy('name').limit(MAX_TRAFFICABILITY_FIELDS).execute();
    });
    const out: MapTrafficability = { equipmentId, date: null, fields: [], skipped: [] };
    for (const f of fields) {
      if (!f.soil_texture) {
        out.skipped.push({ fieldId: f.id, reason: 'no_soil_texture' });
        continue;
      }
      try {
        const r = await this.conditions.trafficability(ctx, f.id, { equipmentId });
        const d = r.days[Math.min(day, r.days.length - 1)];
        if (!d) continue;
        out.date ??= d.date;
        out.fields.push({ fieldId: f.id, band: d.band, sci: d.sci, pf: d.pf });
      } catch (e) {
        const code = e instanceof DomainError ? e.code : null;
        out.skipped.push({ fieldId: f.id, reason: code === 'no_water_balance' || code === 'no_soil_texture' ? code : 'error' });
      }
    }
    return out;
  }
}
