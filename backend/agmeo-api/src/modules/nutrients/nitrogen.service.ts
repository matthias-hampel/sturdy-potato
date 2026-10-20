/**
 * The agmeo N balance per crop and fertilization strategies (reference nitrogen page):
 * demand from the yield-N curve, soil supply from the farmer's values, the ESM model or the
 * soil-class estimates plus the DüV deductions for previous management, losses, and the N need
 * that strategies split into planned fertilizer doses.
 */
import { Injectable } from '@nestjs/common';
import {
  massKg,
  type ApplyStrategyInput,
  type ApplyStrategyResult,
  type BaseUnit,
  type CycleNitrogen,
  type FertilizationStrategy,
  type FertilizationStrategyInput,
  type FertilizerType,
  type NBalanceValue,
  type NPlanningInput,
  type Operation,
  OperationInput,
} from '@agmeo/contracts';
import type { Out } from '../../core/validation.js';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { Database, type Trx } from '../../db/database.js';
import { modelCrop } from '../../models/crops.js';
import { fieldNEstimates, nDifference } from '../../models/nitrogen/estimates.js';
import { nCropInKgNpHa } from '../../models/nitrogen/nitrogen.js';
import { OperationsService } from '../operations/operations.service.js';
import { nextDoseDate, planDoses } from './lib/n-strategy.js';
import { NutrientsService } from './nutrients.service.js';

const round1 = (v: number) => Math.round(v * 10) / 10;
const today = () => new Date().toISOString().slice(0, 10);

interface Planning {
  n_min: number | null;
  n_mineralization: number | null;
  n_leaching: number | null;
  n_residual: number | null;
  strategy_id: string | null;
}

@Injectable()
export class NitrogenService {
  constructor(
    private readonly db: Database,
    private readonly nutrients: NutrientsService,
    private readonly operations: OperationsService,
  ) {}

  /** The agmeo N balance of every main crop of a season. */
  season(ctx: Ctx, seasonId: string): Promise<CycleNitrogen[]> {
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const cycles = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('fields as f', 'f.id', 'cc.field_id')
        .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
        .select('cc.id')
        .where('cc.season_id', '=', seasonId)
        .where('cc.role', '=', 'main')
        .where('f.status', '=', 'active')
        .orderBy('f.name')
        .orderBy(sql`fp.sort_order nulls first`)
        .execute();
      return this.rows(
        trx,
        cycles.map((c) => c.id),
      );
    });
  }

  /** Sets the farmer's values of a crop's N balance (null: back to model or estimate). */
  setPlanning(ctx: Ctx, cropCycleId: string, input: NPlanningInput): Promise<CycleNitrogen> {
    return this.db.run(ctx, async (trx) => {
      const cc = await trx.selectFrom('crop_cycles').select('id').where('id', '=', cropCycleId).executeTakeFirst();
      if (!cc) throw notFound('Crop cycle');
      const values = {
        ...(input.nMin !== undefined ? { n_min: input.nMin } : {}),
        ...(input.nMinSpring !== undefined ? { n_mineralization: input.nMinSpring } : {}),
        ...(input.nLeaching !== undefined ? { n_leaching: input.nLeaching } : {}),
        ...(input.nResidual !== undefined ? { n_residual: input.nResidual } : {}),
        updated_by: ctx.userId || null,
        updated_at: new Date(),
      };
      await trx
        .insertInto('crop_cycle_n_planning')
        .values({ crop_cycle_id: cropCycleId, organization_id: ctx.orgId, ...values })
        .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet(values))
        .execute();
      await record(trx, ctx, { entityType: 'crop_cycle', entityId: cropCycleId, action: 'n_planning_updated', changes: input as Record<string, unknown> });
      const [row] = await this.rows(trx, [cropCycleId]);
      return row;
    });
  }

  strategies(ctx: Ctx): Promise<FertilizationStrategy[]> {
    return this.db.run(ctx, (trx) => this.loadStrategies(trx));
  }

  createStrategy(ctx: Ctx, input: FertilizationStrategyInput): Promise<FertilizationStrategy> {
    return this.db.run(ctx, async (trx) => {
      const products = await trx.selectFrom('products').select(['id', 'category', 'n_pct']).where('id', 'in', input.productIds).execute();
      if (products.length !== new Set(input.productIds).size || products.some((p) => p.category !== 'fertilizer')) throw badRequest('invalid_product', 'Every dose needs a fertilizer of this organization');
      const exists = await trx
        .selectFrom('fertilization_strategies')
        .select('id')
        .where(sql<boolean>`lower(name) = lower(${input.name})`)
        .executeTakeFirst();
      if (exists) throw conflict('strategy_exists', 'A strategy with this name already exists');
      const { id } = await trx
        .insertInto('fertilization_strategies')
        .values({ organization_id: ctx.orgId, name: input.name, split_percentages: input.splitPercentages, product_ids: input.productIds, created_by: ctx.userId || null })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (await this.loadStrategies(trx)).find((s) => s.id === id)!;
    });
  }

  deleteStrategy(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('fertilization_strategies').where('id', '=', id).where('organization_id', '=', ctx.orgId).executeTakeFirst();
      if (!Number(res.numDeletedRows)) throw notFound('Strategy');
    });
  }

  /**
   * Applies a strategy to crops (reference applyStrategyToSelection, saved as operations): the
   * agmeo N need is split into the strategy's doses; the crop's planned N fertilizations are
   * reused in date order with the strategy's fertilizer and rate, missing doses are planned a
   * month apart, surplus planned ones are canceled. Done and running ones stay untouched.
   */
  async applyStrategy(ctx: Ctx, strategyId: string, input: ApplyStrategyInput): Promise<ApplyStrategyResult> {
    const prep = await this.db.run(ctx, async (trx) => {
      const strategy = (await this.loadStrategies(trx)).find((s) => s.id === strategyId);
      if (!strategy) throw notFound('Strategy');
      const productIds = input.productIds ?? strategy.products.map((p) => p?.id ?? null);
      if (productIds.length < strategy.splitPercentages.length || productIds.some((p) => !p)) throw badRequest('product_required', 'Choose a fertilizer for every dose');
      const products = await trx
        .selectFrom('products')
        .select(['id', 'name', 'category', 'base_unit', 'n_pct', 'density_t_m3', 'fertilizer_type'])
        .where('id', 'in', productIds as string[])
        .execute();
      const productOf = (i: number) => products.find((p) => p.id === productIds[i]);
      if (strategy.splitPercentages.some((_, i) => productOf(i)?.category !== 'fertilizer')) throw badRequest('invalid_product', 'Every dose needs a fertilizer of this organization');
      const nPerUnit = (i: number) => {
        const p = productOf(i)!;
        const { kg } = massKg(1, p.base_unit as BaseUnit, { densityTM3: p.density_t_m3, fertilizerType: p.fertilizer_type as FertilizerType | null });
        return kg == null || p.n_pct == null ? null : (kg * p.n_pct) / 100;
      };
      const rows = await this.rows(trx, input.cropCycleIds);
      if (rows.length !== new Set(input.cropCycleIds).size) throw notFound('Crop cycle');
      const cycles = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('fields as f', 'f.id', 'cc.field_id')
        .select(['cc.id', 'cc.field_id', 'cc.field_part_id', 'f.farm_id'])
        .where('cc.id', 'in', input.cropCycleIds)
        .execute();
      // The crops' fertilizations that carry N, planned or done, by date.
      const { rows: opRows } = await sql<{ crop_cycle_id: string; id: string }>`
        SELECT DISTINCT ofl.crop_cycle_id, o.id, coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on) AS day
        FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
        WHERE o.type = 'fertilization' AND o.status <> 'canceled' AND ofl.crop_cycle_id = ANY(${input.cropCycleIds}::uuid[])
        ORDER BY day NULLS LAST`.execute(trx);
      const ops = await this.operations.load(trx, [...new Set(opRows.map((r) => r.id))]);
      return { strategy, productIds: productIds as string[], nPerUnit, rows, cycles, opRows, ops };
    });

    const result: ApplyStrategyResult = { created: 0, updated: 0, canceled: 0, skipped: [] };
    const opById = new Map(prep.ops.map((o) => [o.id, o]));
    for (const row of prep.rows) {
      const cycle = prep.cycles.find((c) => c.id === row.cropCycleId)!;
      if (row.nDifference == null) {
        result.skipped.push({ cropCycleId: row.cropCycleId, reason: 'no_need' });
        continue;
      }
      const doses = planDoses(row.nDifference, prep.strategy.splitPercentages, prep.nPerUnit);
      const mine = prep.opRows.filter((r) => r.crop_cycle_id === row.cropCycleId).map((r) => opById.get(r.id)!).filter(Boolean);
      const withN = mine.filter((o) => (o.nutrientTotals?.n ?? 0) > 0);
      // Only planned doses on this crop alone are rewritten; others are left as they are.
      const reusable = withN.filter((o) => o.status === 'planned' && o.fields.every((f) => f.cropCycleId === row.cropCycleId));
      let last = mine.map((o) => o.performedAt?.slice(0, 10) ?? o.plannedOn).filter((d): d is string => !!d).sort().at(-1) ?? today();
      if (last < today()) last = today();
      for (const dose of doses) {
        const productId = prep.productIds[dose.index];
        const existing = reusable[dose.index];
        if (existing) {
          const fertilizerLines = existing.inputs.filter((i) => i.category === 'fertilizer' && (i.nutrients?.n ?? 0) > 0);
          const others = existing.inputs.filter((i) => !fertilizerLines.includes(i));
          await this.operations.update(ctx, existing.id, {
            ...toInput(existing),
            inputs: [...others.map((i) => ({ productId: i.productId, storageLocationId: i.storageLocationId, ratePerHa: i.ratePerHa ?? undefined, totalQuantity: i.ratePerHa == null ? i.totalQuantity : undefined })), ...(dose.rate ? [{ productId, ratePerHa: dose.rate }] : [])],
            version: existing.version,
          });
          result.updated++;
        } else {
          last = nextDoseDate(last);
          await this.operations.create(ctx, {
            farmId: cycle.farm_id,
            type: 'fertilization',
            title: `${prep.strategy.name} · ${dose.index + 1}`,
            status: 'planned',
            plannedOn: last,
            details: {},
            fields: [{ fieldId: cycle.field_id, fieldPartId: cycle.field_part_id, cropCycleId: cycle.id }],
            inputs: dose.rate ? [{ productId, ratePerHa: dose.rate }] : [],
            labor: [],
            equipment: [],
          });
          result.created++;
        }
      }
      for (const surplus of reusable.slice(doses.length)) {
        await this.operations.cancel(ctx, surplus.id, { version: surplus.version });
        result.canceled++;
      }
      await this.db.run(ctx, (trx) =>
        trx
          .insertInto('crop_cycle_n_planning')
          .values({ crop_cycle_id: cycle.id, organization_id: ctx.orgId, strategy_id: strategyId, updated_by: ctx.userId || null })
          .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet({ strategy_id: strategyId, updated_at: new Date() }))
          .execute(),
      );
    }
    return result;
  }

  // ---------------------------------------------------------------------------

  private async loadStrategies(trx: Trx): Promise<FertilizationStrategy[]> {
    const rows = await trx.selectFrom('fertilization_strategies').selectAll().orderBy(sql`organization_id IS NULL`, 'desc').orderBy('name').execute();
    const ids = [...new Set(rows.flatMap((r) => r.product_ids))];
    const products = ids.length ? await trx.selectFrom('products').select(['id', 'name']).where('id', 'in', ids).execute() : [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      public: r.organization_id == null,
      splitPercentages: r.split_percentages.map(Number),
      products: r.split_percentages.map((_, i) => products.find((p) => p.id === r.product_ids[i]) ?? null),
    }));
  }

  private async rows(trx: Trx, cropCycleIds: string[]): Promise<CycleNitrogen[]> {
    if (!cropCycleIds.length) return [];
    const [planning, esm, applied, codes] = await Promise.all([
      trx.selectFrom('crop_cycle_n_planning').selectAll().where('crop_cycle_id', 'in', cropCycleIds).execute(),
      // Area-weighted values of each crop's latest successful ESM run.
      sql<{ crop_cycle_id: string; n_min: number; n_min_spring: number; n_loss: number }>`
        SELECT r.crop_cycle_id, sum(z.area_fraction * z.n_min_kg_ha)::float8 AS n_min,
               sum(z.area_fraction * z.n_min_spring_kg_ha)::float8 AS n_min_spring, sum(z.area_fraction * z.n_loss_kg_ha)::float8 AS n_loss
        FROM (SELECT DISTINCT ON (crop_cycle_id) id, crop_cycle_id FROM esm_runs
              WHERE status = 'succeeded' AND crop_cycle_id = ANY(${cropCycleIds}::uuid[]) ORDER BY crop_cycle_id, requested_at DESC) r
        JOIN esm_run_zones z ON z.run_id = r.id
        GROUP BY r.crop_cycle_id`.execute(trx).then((r) => r.rows),
      sql<{ crop_cycle_id: string; id: string }>`
        SELECT DISTINCT ofl.crop_cycle_id, o.id FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
        WHERE o.type = 'fertilization' AND o.status <> 'canceled' AND ofl.crop_cycle_id = ANY(${cropCycleIds}::uuid[])`.execute(trx).then((r) => r.rows),
      trx.selectFrom('crop_cycles as cc').innerJoin('crops as c', 'c.id', 'cc.crop_id').select(['cc.id', 'c.code']).where('cc.id', 'in', cropCycleIds).execute(),
    ]);
    const ops = new Map((await this.operations.load(trx, [...new Set(applied.map((a) => a.id))])).map((o) => [o.id, o]));
    const out: CycleNitrogen[] = [];
    for (const id of cropCycleIds) {
      const need = await this.nutrients.computeNeed(trx, id, {});
      const p: Planning | undefined = planning.find((x) => x.crop_cycle_id === id);
      const m = esm.find((x) => x.crop_cycle_id === id);
      const crop = modelCrop(codes.find((c) => c.id === id)?.code);
      const inp = need.inputs;
      const est = fieldNEstimates(inp.soilTexture.value, inp.humusPct.value, crop);
      const value = (user: number | null | undefined, model: number | undefined, estimate: number): NBalanceValue =>
        user != null ? { value: user, source: 'user', estimate } : model != null ? { value: round1(model), source: 'model', estimate } : { value: estimate, source: 'estimate', estimate };
      // The ESM loss is leaching and gaseous losses; residual Nmin is never modelled.
      const nMin = value(p?.n_min, m?.n_min, est.nMin);
      const nMinSpring = value(p?.n_mineralization, m?.n_min_spring, est.nMinSpring);
      const nLeaching = value(p?.n_leaching, m?.n_loss, est.nLeaching);
      const nResidual = value(p?.n_residual, undefined, est.nResidual);
      const n = need.n;
      const deductions = {
        previousCrop: n?.previousCropDeduction ?? 0,
        organicPreviousYear: n?.organicPreviousYearDeduction ?? 0,
        humus: n?.humusDeduction ?? 0,
        catchCrop: n?.catchCropDeduction ?? 0,
        total: 0,
      };
      deductions.total = deductions.previousCrop + deductions.organicPreviousYear + deductions.humus + deductions.catchCrop;
      const yieldTHa = inp.expectedYieldTHa.value;
      const demand = crop && yieldTHa ? nCropInKgNpHa(yieldTHa, crop) : null;
      const nDemand = demand == null ? null : Math.round(demand);
      const totalN = round1(applied.filter((a) => a.crop_cycle_id === id).reduce((s, a) => s + (ops.get(a.id)?.nutrientTotals?.n ?? 0), 0));
      out.push({
        cropCycleId: id,
        fieldId: need.fieldId,
        yieldTHa,
        soilTexture: inp.soilTexture.value,
        humusPct: inp.humusPct.value,
        nDemand,
        nMin,
        nMinSpring,
        nLeaching,
        nResidual,
        deductions,
        previousCropName: inp.previousCrop.name,
        catchCropName: inp.catchCrop.name,
        organicNPreviousYear: inp.organicNPreviousYear.value,
        nSupply: round1(nMin.value + nMinSpring.value + deductions.total),
        nLoss: round1(nLeaching.value + nResidual.value),
        nDifference:
          nDemand == null
            ? null
            : nDifference({ nDemand, nMin: nMin.value, nMinSpring: nMinSpring.value, deductions: deductions.total, nLeaching: nLeaching.value, nResidual: nResidual.value }),
        duevNeed: n?.need ?? null,
        totalN,
        strategyId: p?.strategy_id ?? null,
      });
    }
    return out;
  }
}

/** An operation as it would be saved again, unchanged. */
function toInput(o: Operation): Out<typeof OperationInput> {
  return {
    farmId: o.farmId,
    type: o.type,
    title: o.title,
    status: o.status === 'in_progress' ? 'in_progress' : 'planned',
    plannedOn: o.plannedOn,
    performedAt: o.performedAt,
    responsibleEmployeeId: o.responsibleEmployee?.id ?? null,
    contractorName: o.contractorName,
    contractorCost: o.contractorCost,
    actionId: o.actionId,
    dieselLPerHa: o.dieselLPerHa,
    electricityKWhPerHa: o.electricityKWhPerHa,
    bbchStage: o.bbchStage,
    targetOrganism: o.targetOrganism,
    weatherConditions: o.weatherConditions,
    details: o.details,
    notes: o.notes,
    fields: o.fields.map((f) => ({ fieldId: f.fieldId, fieldPartId: f.fieldPartId, cropCycleId: f.cropCycleId, treatedAreaHa: f.treatedAreaHa })),
    inputs: o.inputs.map((i) => ({ productId: i.productId, storageLocationId: i.storageLocationId, ratePerHa: i.ratePerHa ?? undefined, totalQuantity: i.ratePerHa == null ? i.totalQuantity : undefined })),
    labor: o.labor.map((l) => ({ employeeId: l.employeeId, hours: l.hours, hourlyRate: l.hourlyRate })),
    equipment: o.equipment.map((e) => ({ equipmentId: e.equipmentId, hours: e.hours, hourlyCost: e.hourlyCost })),
  };
}
