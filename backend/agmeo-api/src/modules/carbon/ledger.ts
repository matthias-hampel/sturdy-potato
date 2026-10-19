/**
 * The emission ledger: kg CO2e by BEK source, written for every treated field when an operation
 * is completed and reversed when it is reopened (like stock movements and cost entries).
 */
import type {
  BaseUnit,
  BekEmissions,
  BekSource,
  FertilizerType,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { round } from '../../core/mappers.js';
import type { Trx } from '../../db/database.js';
import { CO2E_FACTOR_SET } from './co2e.js';
import { carbonCrop } from './crops.js';
import {
  type CarbonInputLine,
  operationEmissionsPerHa,
  type OperationCarbonInput,
} from './emissions.js';

/** Products with what the calculator needs, keyed like `products` columns. */
export const productCarbonColumns = [
  'p.name',
  'p.category',
  'p.base_unit',
  'p.n_pct',
  'p.nh4_n_pct',
  'p.p2o5_pct',
  'p.k2o_pct',
  'p.cao_pct',
  'p.density_t_m3',
  'p.humus_c_kg_per_t',
  'p.n_effectiveness_pct',
  'p.fertilizer_type',
  'p.dry_matter_pct',
] as const;

export interface ProductCarbonRow {
  name: string;
  category: string;
  base_unit: string;
  n_pct: number | null;
  nh4_n_pct: number | null;
  p2o5_pct: number | null;
  k2o_pct: number | null;
  cao_pct: number | null;
  density_t_m3: number | null;
  humus_c_kg_per_t: number | null;
  n_effectiveness_pct: number | null;
  fertilizer_type: string | null;
  dry_matter_pct: number | null;
}

export function carbonLine(
  p: ProductCarbonRow,
  ratePerHa: number,
): CarbonInputLine {
  return {
    ratePerHa,
    product: {
      name: p.name,
      category: p.category,
      baseUnit: p.base_unit as BaseUnit,
      fertilizerType: p.fertilizer_type as FertilizerType | null,
      nPct: p.n_pct,
      nh4NPct: p.nh4_n_pct,
      p2o5Pct: p.p2o5_pct,
      k2oPct: p.k2o_pct,
      caoPct: p.cao_pct,
      densityTM3: p.density_t_m3,
      humusCKgPerT: p.humus_c_kg_per_t,
      nEffectivenessPct: p.n_effectiveness_pct,
      dryMatterPct: p.dry_matter_pct,
    },
  };
}

export interface OperationLine {
  field_id: string;
  field_part_id: string | null;
  crop_cycle_id: string | null;
  treated_area_ha: number;
  season_id: string | null;
  crop_code: string | null;
}

/** An operation as the calculator sees it (rates per hectare of the treated area) and its field lines. */
export async function loadOperationCarbon(
  trx: Trx,
  operationId: string,
): Promise<{
  op: OperationCarbonInput;
  lines: OperationLine[];
  areaHa: number;
}> {
  const meta = await trx
    .selectFrom('operations')
    .select(['type', 'diesel_l_per_ha', 'details'])
    .where('id', '=', operationId)
    .executeTakeFirstOrThrow();
  const lines = await trx
    .selectFrom('operation_fields as ofl')
    .leftJoin('crop_cycles as cc', 'cc.id', 'ofl.crop_cycle_id')
    .leftJoin('crops as c', 'c.id', 'cc.crop_id')
    .select([
      'ofl.field_id',
      'ofl.field_part_id',
      'ofl.crop_cycle_id',
      'ofl.treated_area_ha',
      'cc.season_id',
      'c.code as crop_code',
    ])
    .where('ofl.operation_id', '=', operationId)
    .execute();
  const areaHa = lines.reduce((s, l) => s + l.treated_area_ha, 0);
  const inputs = await trx
    .selectFrom('operation_inputs as oi')
    .innerJoin('products as p', 'p.id', 'oi.product_id')
    .select(['oi.total_quantity', ...productCarbonColumns])
    .where('oi.operation_id', '=', operationId)
    .execute();
  const details = (meta.details ?? {}) as Record<string, unknown>;
  const hasFuel = inputs.some((i) => i.category === 'fuel');
  // Diesel: recorded fuel products, else the operation's diesel per hectare, else machine hours × consumption.
  let dieselLPerHa = 0;
  if (!hasFuel && areaHa > 0) {
    if (meta.diesel_l_per_ha != null && meta.diesel_l_per_ha > 0) {
      dieselLPerHa = meta.diesel_l_per_ha;
    } else {
      const machine = await trx
        .selectFrom('operation_equipment as q')
        .innerJoin('equipment as e', 'e.id', 'q.equipment_id')
        .select(sql<number>`coalesce(sum(q.hours * e.fuel_l_per_h), 0)`.as('l'))
        .where('q.operation_id', '=', operationId)
        .executeTakeFirst();
      dieselLPerHa = Number(machine?.l ?? 0) / areaHa;
    }
  }
  return {
    areaHa,
    lines,
    op: {
      type: meta.type,
      dieselLPerHa,
      incorporationHours:
        typeof details.incorporationHours === 'number'
          ? details.incorporationHours
          : null,
      inputs:
        areaHa > 0
          ? inputs.map((i) => carbonLine(i, i.total_quantity / areaHa))
          : [],
    },
  };
}

/** kg CO2e by source of each field line of an operation, with the crop of the line. */
export function lineEmissions(
  op: OperationCarbonInput,
  lines: OperationLine[],
  year?: number,
): { line: OperationLine; kg: BekEmissions }[] {
  const perCrop = new Map<string, BekEmissions>();
  return lines.map((line) => {
    const key = line.crop_code ?? '';
    let perHa = perCrop.get(key);
    if (!perHa) {
      perHa = operationEmissionsPerHa(
        op,
        carbonCrop(line.crop_code),
        year,
      ).byId;
      perCrop.set(key, perHa);
    }
    const kg: BekEmissions = {};
    for (const [source, v] of Object.entries(perHa) as [BekSource, number][])
      kg[source] = v * line.treated_area_ha;
    return { line, kg };
  });
}

/** Writes the emissions of a completion. */
export async function writeOperationEmissions(
  trx: Trx,
  ctx: Ctx,
  operationId: string,
  seq: number,
  seasonId: string | null,
): Promise<void> {
  const { op, lines, areaHa } = await loadOperationCarbon(trx, operationId);
  if (!areaHa) return;
  const year = seasonId
    ? (
        await trx
          .selectFrom('growing_seasons')
          .select('harvest_year')
          .where('id', '=', seasonId)
          .executeTakeFirst()
      )?.harvest_year
    : undefined;
  const rows = lineEmissions(op, lines, year).flatMap(({ line, kg }) =>
    (Object.entries(kg) as [BekSource, number][])
      .map(([source, v]) => ({ source, kg: round(v, 3) }))
      .filter((e) => e.kg !== 0)
      .map((e) => ({
        organization_id: ctx.orgId,
        operation_id: operationId,
        completion_seq: seq,
        kind: 'operation',
        season_id: line.season_id ?? seasonId,
        crop_cycle_id: line.crop_cycle_id,
        field_id: line.field_id,
        field_part_id: line.field_part_id,
        source: e.source,
        kg_co2e: e.kg,
        factor_set: CO2E_FACTOR_SET,
      })),
  );
  if (rows.length)
    await trx.insertInto('emission_entries').values(rows).execute();
}
