import { Injectable } from '@nestjs/common';
import type {
  CostCategory,
  CostEntry,
  CostEntryInput,
  CropCycleEconomics,
  CropEconomics,
  CropPrice,
  CropPricesInput,
  EconomicsSummary,
  FarmOverheads,
  FarmOverheadsInput,
  FarmResult,
  Harvest,
  HarvestInput,
  RevenueBasis,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { CarbonService } from '../carbon/carbon.service.js';
import { CO2E_FACTOR_SET, emissionCategory } from '../carbon/co2e.js';
import { cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';

/**
 * Harvests, manual cost entries and the season's contribution margins. Figures are direct
 * costs recorded in agmeo; they deliberately exclude overhead, financing and taxes and
 * must not be presented as farm profit.
 */
/** Base units a harvested-goods product can be stocked in, per tonne. */
const HARVEST_UNITS_PER_T: Record<string, number> = { t: 1, kg: 1000 };

@Injectable()
export class EconomicsService {
  constructor(
    private readonly db: Database,
    private readonly carbon: CarbonService,
  ) {}

  harvests(ctx: Ctx, q: { seasonId?: string; cropCycleId?: string }): Promise<Harvest[]> {
    return this.db.run(ctx, (trx) => this.queryHarvests(trx, q));
  }

  private async queryHarvests(trx: Trx, q: { seasonId?: string; cropCycleId?: string; id?: string }): Promise<Harvest[]> {
    let query = trx
      .selectFrom('harvests as h')
      .innerJoin('crop_cycles as cc', 'cc.id', 'h.crop_cycle_id')
      .innerJoin('fields as f', 'f.id', 'cc.field_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .selectAll('h')
      .select(['f.name as field_name', cropName('c').as('crop_name'), 'cc.expected_price_per_t'])
      .orderBy('h.harvest_date', 'desc');
    if (q.id) query = query.where('h.id', '=', q.id);
    if (q.seasonId) query = query.where('cc.season_id', '=', q.seasonId);
    if (q.cropCycleId) query = query.where('h.crop_cycle_id', '=', q.cropCycleId);
    const rows = await query.execute();
    return rows.map((r) => {
      const price = r.price_per_t ?? r.expected_price_per_t;
      return {
        id: r.id,
        cropCycleId: r.crop_cycle_id,
        fieldName: r.field_name,
        cropName: r.crop_name,
        harvestDate: r.harvest_date,
        harvestedAreaHa: r.harvested_area_ha,
        quantityT: r.quantity_t,
        yieldTHa: round(r.quantity_t / r.harvested_area_ha, 2),
        moisturePct: r.moisture_pct,
        quality: r.quality,
        pricePerT: r.price_per_t,
        priceBasis: r.price_basis as Harvest['priceBasis'],
        revenue: price != null ? round(price * r.quantity_t) : null,
        productId: r.product_id,
        notes: r.notes,
      };
    });
  }

  createHarvest(ctx: Ctx, input: Out<typeof HarvestInput>): Promise<Harvest> {
    return this.db.run(ctx, async (trx) => {
      const cycle = await trx
        .selectFrom('crop_cycles as cc')
        .leftJoin('field_current_geometry as g', 'g.field_id', 'cc.field_id')
        .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
        .select(['cc.id', 'cc.status', sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha)`.as('area_ha')])
        .where('cc.id', '=', input.cropCycleId)
        .executeTakeFirst();
      if (!cycle) throw notFound('Crop cycle');
      if (cycle.status === 'closed') throw badRequest('crop_cycle_closed', 'This crop cycle is closed');
      if (input.priceBasis === 'actual' && input.pricePerT == null) {
        throw badRequest('price_required', 'Enter the sale price for an actual price');
      }
      const product = input.productId
        ? await trx.selectFrom('products').select(['id', 'category', 'base_unit']).where('id', '=', input.productId).executeTakeFirst()
        : null;
      if (input.productId && !product) throw notFound('Product');
      const perT = product ? HARVEST_UNITS_PER_T[product.base_unit] : undefined;
      if (product && (product.category !== 'harvest' || perT == null)) {
        throw badRequest('invalid_harvest_product', 'Book harvests into a harvested-goods product measured in t or kg');
      }
      const { id } = await trx
        .insertInto('harvests')
        .values({
          organization_id: ctx.orgId,
          crop_cycle_id: input.cropCycleId,
          harvest_date: input.harvestDate,
          harvested_area_ha: input.harvestedAreaHa ?? cycle.area_ha,
          quantity_t: input.quantityT,
          moisture_pct: input.moisturePct ?? null,
          quality: input.quality ?? null,
          price_per_t: input.pricePerT ?? null,
          price_basis: input.priceBasis,
          product_id: product?.id ?? null,
          notes: input.notes ?? null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (product && perT != null) {
        await trx
          .insertInto('stock_movements')
          .values({
            organization_id: ctx.orgId,
            product_id: product.id,
            storage_location_id: input.storageLocationId ?? null,
            kind: 'receipt',
            quantity_delta: input.quantityT * perT,
            unit_cost: null,
            harvest_id: id,
            occurred_at: new Date(`${input.harvestDate}T12:00:00Z`),
            note: null,
            created_by: ctx.userId,
          })
          .execute();
      }
      if (cycle.status === 'planned' || cycle.status === 'active') {
        await trx.updateTable('crop_cycles').set({ status: 'harvested' }).where('id', '=', input.cropCycleId).execute();
      }
      await record(trx, ctx, {
        entityType: 'harvest',
        entityId: id,
        action: 'created',
        changes: { cropCycleId: input.cropCycleId, quantityT: input.quantityT },
        event: { type: 'harvest.recorded', payload: { harvestId: id, cropCycleId: input.cropCycleId, quantityT: input.quantityT } },
      });
      return (await this.queryHarvests(trx, { id }))[0];
    });
  }

  deleteHarvest(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const h = await trx.selectFrom('harvests').select(['crop_cycle_id', 'quantity_t']).where('id', '=', id).executeTakeFirst();
      if (!h) throw notFound('Harvest');
      // A harvest booked into stock leaves the store again with its record.
      const receipt = await trx
        .selectFrom('stock_movements as m')
        .selectAll('m')
        .where('m.harvest_id', '=', id)
        .where('m.kind', '=', 'receipt')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('stock_movements as v').select('v.id').whereRef('v.voids_movement_id', '=', 'm.id'))))
        .executeTakeFirst();
      if (receipt) {
        await trx
          .insertInto('stock_movements')
          .values({
            organization_id: ctx.orgId,
            product_id: receipt.product_id,
            storage_location_id: receipt.storage_location_id,
            kind: 'void',
            quantity_delta: -receipt.quantity_delta,
            voids_movement_id: receipt.id,
            harvest_id: id,
            occurred_at: new Date(),
            note: 'Harvest deleted',
            created_by: ctx.userId,
          })
          .execute();
      }
      await trx.deleteFrom('harvests').where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'harvest', entityId: id, action: 'deleted', changes: { cropCycleId: h.crop_cycle_id, quantityT: h.quantity_t } });
    });
  }

  costEntries(ctx: Ctx, q: { seasonId?: string; cropCycleId?: string; fieldId?: string }): Promise<CostEntry[]> {
    return this.db.run(ctx, async (trx) => {
      let query = trx
        .selectFrom('cost_entries as ce')
        .leftJoin('fields as f', 'f.id', 'ce.field_id')
        .leftJoin('operations as o', 'o.id', 'ce.operation_id')
        .selectAll('ce')
        .select(['f.name as field_name', 'o.title as operation_title'])
        .orderBy('ce.incurred_on', 'desc')
        .orderBy('ce.created_at', 'desc')
        .limit(2000);
      if (q.seasonId) query = query.where('ce.season_id', '=', q.seasonId);
      if (q.cropCycleId) query = query.where('ce.crop_cycle_id', '=', q.cropCycleId);
      if (q.fieldId) query = query.where('ce.field_id', '=', q.fieldId);
      const rows = await query.execute();
      return rows.map((r) => ({
        id: r.id,
        seasonId: r.season_id,
        cropCycleId: r.crop_cycle_id,
        fieldId: r.field_id,
        fieldName: r.field_name,
        operationId: r.operation_id,
        operationTitle: r.operation_title,
        category: r.category as CostCategory,
        amount: r.amount,
        currency: r.currency,
        basis: r.basis as CostEntry['basis'],
        source: r.source as CostEntry['source'],
        description: r.description,
        incurredOn: r.incurred_on,
      }));
    });
  }

  createCostEntry(ctx: Ctx, input: Out<typeof CostEntryInput>): Promise<CostEntry[]> {
    return this.db
      .run(ctx, async (trx) => {
        let seasonId = input.seasonId ?? null;
        let fieldId = input.fieldId ?? null;
        if (input.cropCycleId) {
          const cycle = await trx.selectFrom('crop_cycles').select(['season_id', 'field_id']).where('id', '=', input.cropCycleId).executeTakeFirst();
          if (!cycle) throw notFound('Crop cycle');
          seasonId = cycle.season_id;
          fieldId = cycle.field_id;
        }
        if (!seasonId) seasonId = (await resolveSeason(trx, null, input.incurredOn))?.id ?? null;
        const org = await trx.selectFrom('organizations').select('currency').where('id', '=', ctx.orgId).executeTakeFirstOrThrow();
        const { id } = await trx
          .insertInto('cost_entries')
          .values({
            organization_id: ctx.orgId,
            season_id: seasonId,
            crop_cycle_id: input.cropCycleId ?? null,
            field_id: fieldId,
            category: input.category,
            amount: input.amount,
            currency: org.currency,
            basis: input.basis,
            source: 'manual',
            description: input.description ?? null,
            incurred_on: input.incurredOn,
            created_by: ctx.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await record(trx, ctx, { entityType: 'cost_entry', entityId: id, action: 'created', changes: { category: input.category, amount: input.amount } });
      })
      .then(() => this.costEntries(ctx, { seasonId: input.seasonId ?? undefined, cropCycleId: input.cropCycleId ?? undefined }));
  }

  deleteCostEntry(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const entry = await trx.selectFrom('cost_entries').select(['source', 'amount', 'category']).where('id', '=', id).executeTakeFirst();
      if (!entry) throw notFound('Cost entry');
      if (entry.source !== 'manual') throw badRequest('operation_cost', 'Costs from operations change when the operation is reopened');
      await trx.deleteFrom('cost_entries').where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'cost_entry', entityId: id, action: 'deleted', changes: entry });
    });
  }

  summary(ctx: Ctx, seasonId?: string): Promise<EconomicsSummary | null> {
    return this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx, seasonId);
      if (!season) return null;
      const org = await trx.selectFrom('organizations').select('currency').where('id', '=', ctx.orgId).executeTakeFirstOrThrow();

      const { rows: cycles } = await sql<{
        id: string; field_id: string; field_name: string; crop_id: string; crop_name: string; color: string; status: string;
        area_ha: number; expected_yield_t_ha: number | null; expected_price_per_t: number | null;
        qty: number | null; harvested_area: number | null; revenue: number | null; all_actual: boolean | null; harvests: number;
      }>`
        SELECT cc.id, cc.field_id, concat_ws(' · ', f.name, fp.name) AS field_name, cc.crop_id, coalesce(c.name_de, c.name) AS crop_name, coalesce((SELECT occ.color FROM org_crop_colors occ WHERE occ.crop_id = c.id), c.color) AS color, cc.status,
               coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0) AS area_ha, cc.expected_yield_t_ha,
               coalesce(cc.expected_price_per_t, cp.price_per_t) AS expected_price_per_t,
               h.qty, h.harvested_area, h.revenue, h.all_actual, coalesce(h.n, 0) AS harvests
        FROM crop_cycles cc
        JOIN fields f ON f.id = cc.field_id
        JOIN crops c ON c.id = cc.crop_id
        LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
        LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
        JOIN growing_seasons s ON s.id = cc.season_id
        -- The crop's own expected price, else the farm's price for the crop and harvest year.
        LEFT JOIN crop_prices cp ON cp.crop_id = cc.crop_id AND cp.harvest_year = s.harvest_year
        LEFT JOIN LATERAL (
          SELECT sum(quantity_t) AS qty, sum(harvested_area_ha) AS harvested_area,
                 sum(quantity_t * coalesce(price_per_t, cc.expected_price_per_t, cp.price_per_t)) AS revenue,
                 bool_and(price_basis = 'actual' AND price_per_t IS NOT NULL) AS all_actual, count(*) AS n
          FROM harvests WHERE crop_cycle_id = cc.id
        ) h ON true
        WHERE cc.season_id = ${season.id}
        ORDER BY crop_name, f.name`.execute(trx);

      // Plan: planned and running operations of the crops, valued like a completion would be.
      const { rows: plannedRows } = await sql<{ crop_cycle_id: string; category: string; amount: number }>`
        WITH lines AS (
          SELECT ofl.operation_id, ofl.crop_cycle_id,
                 ofl.treated_area_ha / sum(ofl.treated_area_ha) OVER (PARTITION BY ofl.operation_id) AS share
          FROM operation_fields ofl
          JOIN operations o ON o.id = ofl.operation_id
          JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id
          WHERE cc.season_id = ${season.id} AND o.status IN ('planned', 'in_progress')
        ), costs AS (
          SELECT oi.operation_id, CASE p.category WHEN 'fuel' THEN 'machinery' WHEN 'seed' THEN 'direct' WHEN 'fertilizer' THEN 'direct'
                   WHEN 'crop_protection' THEN 'direct' ELSE 'direct' END AS category,
                 sum(oi.total_quantity * coalesce(oi.unit_cost, app.product_price(oi.product_id, extract(year FROM coalesce(o.planned_on, current_date))::int), 0)) AS amount
          FROM operation_inputs oi JOIN products p ON p.id = oi.product_id JOIN operations o ON o.id = oi.operation_id GROUP BY 1, 2
          UNION ALL
          SELECT l.operation_id, 'labor', sum(l.hours * coalesce(l.hourly_rate, e.hourly_rate, 0))
          FROM operation_labor l JOIN employees e ON e.id = l.employee_id GROUP BY 1
          UNION ALL
          SELECT q.operation_id, 'machinery', sum(q.hours * coalesce(q.hourly_cost, eq.hourly_cost, 0))
          FROM operation_equipment q JOIN equipment eq ON eq.id = q.equipment_id GROUP BY 1
          UNION ALL
          SELECT id, 'machinery', contractor_cost FROM operations WHERE contractor_cost IS NOT NULL
        )
        SELECT lines.crop_cycle_id, costs.category, sum(costs.amount * lines.share) AS amount
        FROM lines JOIN costs ON costs.operation_id = lines.operation_id
        GROUP BY 1, 2`.execute(trx);
      const plannedOf = new Map<string, Record<string, number>>();
      for (const r of plannedRows) plannedOf.set(r.crop_cycle_id, { ...plannedOf.get(r.crop_cycle_id), [r.category]: Number(r.amount) });

      const emissionRows = await trx
        .selectFrom('emission_entries')
        .select(['crop_cycle_id', 'source', sql<number>`sum(kg_co2e)`.as('kg')])
        .where('season_id', '=', season.id)
        .groupBy(['crop_cycle_id', 'source'])
        .execute();
      // Emissions by category: the operations' ledger plus what is booked on the crop cycles
      // themselves (humus effect, residues, last year's organic N; see CarbonService.cycleCarbon).
      const co2Of = new Map<string, number>();
      const bySource: Record<string, number> = {};
      const book = (cycleId: string | null, source: string, kg: number) => {
        const category = emissionCategory(source) ?? source;
        if (cycleId) co2Of.set(cycleId, (co2Of.get(cycleId) ?? 0) + kg);
        bySource[category] = round((bySource[category] ?? 0) + kg, 1);
      };
      for (const e of emissionRows) book(e.crop_cycle_id, e.source, Number(e.kg));
      for (const [cycleId, terms] of await this.carbon.cycleCarbon(trx, [season.id])) {
        for (const [source, kg] of Object.entries(terms.byId)) book(cycleId, source, kg ?? 0);
      }
      const overheads = await trx.selectFrom('farm_overheads').selectAll().where('season_id', '=', season.id).executeTakeFirst();

      const costRows = await trx
        .selectFrom('cost_entries')
        .select(['crop_cycle_id', 'category', 'basis', sql<number>`sum(amount)`.as('amount')])
        .where('season_id', '=', season.id)
        .groupBy(['crop_cycle_id', 'category', 'basis'])
        .execute();

      const costsByCycle = new Map<string, { actual: number; estimated: number; byCategory: Partial<Record<CostCategory, number>> }>();
      const totalsByCategory: Partial<Record<CostCategory, number>> = {};
      let unallocated = 0;
      for (const c of costRows) {
        const category = c.category as CostCategory;
        totalsByCategory[category] = round((totalsByCategory[category] ?? 0) + c.amount);
        if (!c.crop_cycle_id) {
          unallocated += c.amount;
          continue;
        }
        const entry = costsByCycle.get(c.crop_cycle_id) ?? { actual: 0, estimated: 0, byCategory: {} };
        entry[c.basis === 'estimated' ? 'estimated' : 'actual'] += c.amount;
        entry.byCategory[category] = round((entry.byCategory[category] ?? 0) + c.amount);
        costsByCycle.set(c.crop_cycle_id, entry);
      }

      const result: CropCycleEconomics[] = cycles.map((r) => {
        let revenue = 0;
        let basis: RevenueBasis = 'none';
        if (r.harvests > 0 && r.revenue != null) {
          revenue = r.revenue;
          basis = r.all_actual ? 'actual' : 'expected';
        } else if (r.harvests === 0 && r.expected_yield_t_ha != null && r.expected_price_per_t != null) {
          revenue = r.area_ha * r.expected_yield_t_ha * r.expected_price_per_t;
          basis = 'planned';
        }
        const costs = costsByCycle.get(r.id) ?? { actual: 0, estimated: 0, byCategory: {} };
        const totalCosts = costs.actual + costs.estimated;
        const margin = revenue - totalCosts;
        const cat = (...keys: CostCategory[]) => keys.reduce((sum, k) => sum + (costs.byCategory[k] ?? 0), 0);
        const directCosts = cat('seed', 'fertilizer', 'crop_protection', 'other_input');
        const machineryCosts = cat('fuel', 'machinery', 'contractor');
        const laborCosts = cat('labor');
        const db2 = revenue - directCosts - machineryCosts - laborCosts;
        const plan = plannedOf.get(r.id);
        const plannedRevenue = r.expected_yield_t_ha != null && r.expected_price_per_t != null ? r.area_ha * r.expected_yield_t_ha * r.expected_price_per_t : null;
        // The plan adds what is still planned to what was already spent.
        const planned = plan || plannedRevenue != null
          ? {
              revenue: round(plannedRevenue ?? revenue),
              directCosts: round(directCosts + (plan?.direct ?? 0)),
              machineryCosts: round(machineryCosts + (plan?.machinery ?? 0)),
              laborCosts: round(laborCosts + (plan?.labor ?? 0)),
              db2: round((plannedRevenue ?? revenue) - directCosts - machineryCosts - laborCosts - (plan?.direct ?? 0) - (plan?.machinery ?? 0) - (plan?.labor ?? 0)),
            }
          : null;
        const co2 = co2Of.get(r.id) ?? 0;
        const tonnes = r.qty ?? (r.expected_yield_t_ha != null ? r.expected_yield_t_ha * r.area_ha : null);
        return {
          cropCycleId: r.id,
          fieldId: r.field_id,
          fieldName: r.field_name,
          cropId: r.crop_id,
          cropName: r.crop_name,
          cropColor: r.color,
          status: r.status,
          areaHa: r.area_ha,
          harvestedQuantityT: r.qty,
          yieldTHa: r.qty != null && r.harvested_area ? round(r.qty / r.harvested_area, 2) : null,
          expectedYieldTHa: r.expected_yield_t_ha,
          revenue: round(revenue),
          revenueBasis: basis,
          costs: costs.byCategory,
          actualCosts: round(costs.actual),
          estimatedCosts: round(costs.estimated),
          totalCosts: round(totalCosts),
          costPerHa: r.area_ha ? round(totalCosts / r.area_ha) : 0,
          margin: round(margin),
          marginPerHa: r.area_ha ? round(margin / r.area_ha) : 0,
          directCosts: round(directCosts),
          dfl: round(revenue - directCosts),
          machineryCosts: round(machineryCosts),
          db1: round(revenue - directCosts - machineryCosts),
          laborCosts: round(laborCosts),
          db2: round(db2),
          db2PerHa: r.area_ha ? round(db2 / r.area_ha) : 0,
          otherCosts: round(totalCosts - directCosts - machineryCosts - laborCosts),
          planned,
          co2eKg: round(co2, 1),
          co2ePerHa: r.area_ha ? round(co2 / r.area_ha, 1) : 0,
          co2ePerT: tonnes ? round(co2 / tonnes, 1) : null,
        };
      });

      const byCropMap = new Map<string, CropEconomics & { harvestedQty: number; harvestedArea: number; tonnes: number }>();
      for (const c of result) {
        const cur = byCropMap.get(c.cropId) ?? {
          cropId: c.cropId, cropName: c.cropName, cropColor: c.cropColor, areaHa: 0, yieldTHa: null,
          revenue: 0, totalCosts: 0, margin: 0, marginPerHa: 0, costPerHa: 0, harvestedQty: 0, harvestedArea: 0,
          dfl: 0, db1: 0, db2: 0, db2PerHa: 0, co2eKg: 0, co2ePerHa: 0, co2ePerT: null, tonnes: 0,
        };
        cur.areaHa += c.areaHa;
        cur.revenue += c.revenue;
        cur.totalCosts += c.totalCosts;
        cur.margin += c.margin;
        cur.dfl += c.dfl;
        cur.db1 += c.db1;
        cur.db2 += c.db2;
        cur.co2eKg += c.co2eKg;
        cur.tonnes += c.harvestedQuantityT ?? (c.expectedYieldTHa != null ? c.expectedYieldTHa * c.areaHa : 0);
        if (c.harvestedQuantityT != null && c.yieldTHa) {
          cur.harvestedQty += c.harvestedQuantityT;
          cur.harvestedArea += c.harvestedQuantityT / c.yieldTHa;
        }
        byCropMap.set(c.cropId, cur);
      }
      const byCrop: CropEconomics[] = [...byCropMap.values()].map(({ harvestedQty, harvestedArea, tonnes, ...c }) => ({
        ...c,
        dfl: round(c.dfl),
        db1: round(c.db1),
        db2: round(c.db2),
        db2PerHa: c.areaHa ? round(c.db2 / c.areaHa) : 0,
        co2eKg: round(c.co2eKg, 1),
        co2ePerHa: c.areaHa ? round(c.co2eKg / c.areaHa, 1) : 0,
        co2ePerT: tonnes ? round(c.co2eKg / tonnes, 1) : null,
        areaHa: round(c.areaHa, 4),
        revenue: round(c.revenue),
        totalCosts: round(c.totalCosts),
        margin: round(c.margin),
        yieldTHa: harvestedArea ? round(harvestedQty / harvestedArea, 2) : null,
        marginPerHa: c.areaHa ? round(c.margin / c.areaHa) : 0,
        costPerHa: c.areaHa ? round(c.totalCosts / c.areaHa) : 0,
      }));

      const areaHa = result.reduce((s, c) => s + c.areaHa, 0);
      const revenue = result.reduce((s, c) => s + c.revenue, 0);
      const totalCosts = result.reduce((s, c) => s + c.totalCosts, 0) + unallocated;
      return {
        seasonId: season.id,
        seasonName: season.name,
        currency: org.currency,
        cycles: result,
        byCrop,
        totals: {
          areaHa: round(areaHa, 4),
          revenue: round(revenue),
          totalCosts: round(totalCosts),
          margin: round(revenue - totalCosts),
          marginPerHa: areaHa ? round((revenue - totalCosts) / areaHa) : 0,
          costsByCategory: totalsByCategory,
        },
        unallocatedCosts: round(unallocated),
        farmResult: overheads ? farmResult(result.reduce((sum, c) => sum + c.db2, 0) - result.reduce((sum, c) => sum + c.otherCosts, 0), areaHa, unallocated, overheads) : null,
        carbon: {
          totalKg: round(Object.values(bySource).reduce((a, b) => a + b, 0), 1),
          perHa: areaHa ? round(Object.values(bySource).reduce((a, b) => a + b, 0) / areaHa, 1) : 0,
          bySource,
          factorSet: CO2E_FACTOR_SET,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Overheads, area payments and crop prices
  // ---------------------------------------------------------------------------

  overheads(ctx: Ctx, seasonId: string): Promise<FarmOverheads | null> {
    return this.db.run(ctx, async (trx) => {
      const r = await trx.selectFrom('farm_overheads').selectAll().where('season_id', '=', seasonId).executeTakeFirst();
      return r ? overheadsOut(r) : null;
    });
  }

  saveOverheads(ctx: Ctx, input: Out<typeof FarmOverheadsInput>): Promise<FarmOverheads> {
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', input.seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const values = {
        lease_per_ha: input.leasePerHa,
        land_tax_per_ha: input.landTaxPerHa,
        insurance_per_ha: input.insurancePerHa,
        buildings_per_ha: input.buildingsPerHa,
        accounting_per_ha: input.accountingPerHa,
        other_per_ha: input.otherPerHa,
        basic_payment_per_ha: input.basicPaymentPerHa,
        redistributive1_per_ha: input.redistributive1PerHa,
        redistributive2_per_ha: input.redistributive2PerHa,
        eco_schemes_per_ha: input.ecoSchemesPerHa,
        other_payments_per_ha: input.otherPaymentsPerHa,
      };
      const row = await trx
        .insertInto('farm_overheads')
        .values({ organization_id: ctx.orgId, season_id: input.seasonId, ...values })
        .onConflict((oc) => oc.columns(['organization_id', 'season_id']).doUpdateSet(values))
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'season', entityId: input.seasonId, action: 'overheads_updated', changes: values });
      return overheadsOut(row);
    });
  }

  cropPrices(ctx: Ctx, harvestYear: number): Promise<CropPrice[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('crop_prices as p')
        .innerJoin('crops as c', 'c.id', 'p.crop_id')
        .select(['p.crop_id', cropName('c').as('crop_name'), 'p.harvest_year', 'p.price_per_t', 'p.notes'])
        .where('p.harvest_year', '=', harvestYear)
        .orderBy('crop_name')
        .execute();
      return rows.map((r) => ({ cropId: r.crop_id, cropName: r.crop_name, harvestYear: r.harvest_year, pricePerT: r.price_per_t, notes: r.notes }));
    });
  }

  /** Sets the farm's sale prices of a harvest year; a null price removes the crop's price. */
  saveCropPrices(ctx: Ctx, input: Out<typeof CropPricesInput>): Promise<CropPrice[]> {
    return this.db
      .run(ctx, async (trx) => {
        for (const p of input.prices) {
          if (p.pricePerT == null) {
            await trx.deleteFrom('crop_prices').where('crop_id', '=', p.cropId).where('harvest_year', '=', input.harvestYear).execute();
            continue;
          }
          await trx
            .insertInto('crop_prices')
            .values({ organization_id: ctx.orgId, crop_id: p.cropId, harvest_year: input.harvestYear, price_per_t: p.pricePerT, notes: p.notes ?? null })
            .onConflict((oc) => oc.columns(['organization_id', 'crop_id', 'harvest_year']).doUpdateSet({ price_per_t: p.pricePerT!, notes: p.notes ?? null }))
            .execute();
        }
        await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'crop_prices_updated', changes: { harvestYear: input.harvestYear, prices: input.prices.length } });
      })
      .then(() => this.cropPrices(ctx, input.harvestYear));
  }
}

type OverheadRow = {
  lease_per_ha: number; land_tax_per_ha: number; insurance_per_ha: number; buildings_per_ha: number; accounting_per_ha: number; other_per_ha: number;
  basic_payment_per_ha: number; redistributive1_per_ha: number; redistributive2_per_ha: number; eco_schemes_per_ha: number; other_payments_per_ha: number;
};

/**
 * Contribution margins to an indicative farm result, after AGVOLUTION/agmeo
 * (src/lib/economics/farmProfitability.ts, capSubsidies.ts). The redistributive payment covers the
 * first 40 ha at the first rate and the next 20 ha at the second. CAP amounts are not validated
 * against the rules of the paying agency.
 */
export function farmResult(db2AfterOther: number, areaHa: number, unallocated: number, o: OverheadRow): FarmResult {
  const per = (v: number) => round(v * areaHa);
  const overheads = {
    lease: per(o.lease_per_ha),
    landTax: per(o.land_tax_per_ha),
    insurance: per(o.insurance_per_ha),
    buildings: per(o.buildings_per_ha),
    accounting: per(o.accounting_per_ha),
    other: per(o.other_per_ha),
    total: 0,
  };
  overheads.total = round(overheads.lease + overheads.landTax + overheads.insurance + overheads.buildings + overheads.accounting + overheads.other);
  const redistributive = round(Math.min(areaHa, 40) * o.redistributive1_per_ha + Math.min(Math.max(areaHa - 40, 0), 20) * o.redistributive2_per_ha);
  const payments = { basic: per(o.basic_payment_per_ha), redistributive, ecoSchemes: per(o.eco_schemes_per_ha), other: per(o.other_payments_per_ha), total: 0 };
  payments.total = round(payments.basic + payments.redistributive + payments.ecoSchemes + payments.other);
  const resultBeforePayments = round(db2AfterOther - overheads.total - unallocated);
  const result = round(resultBeforePayments + payments.total);
  return { db2: round(db2AfterOther), overheads, unallocatedCosts: round(unallocated), resultBeforePayments, payments, result, resultPerHa: areaHa ? round(result / areaHa) : 0 };
}

function overheadsOut(r: OverheadRow & { season_id: string }): FarmOverheads {
  return {
    seasonId: r.season_id,
    leasePerHa: r.lease_per_ha,
    landTaxPerHa: r.land_tax_per_ha,
    insurancePerHa: r.insurance_per_ha,
    buildingsPerHa: r.buildings_per_ha,
    accountingPerHa: r.accounting_per_ha,
    otherPerHa: r.other_per_ha,
    basicPaymentPerHa: r.basic_payment_per_ha,
    redistributive1PerHa: r.redistributive1_per_ha,
    redistributive2PerHa: r.redistributive2_per_ha,
    ecoSchemesPerHa: r.eco_schemes_per_ha,
    otherPaymentsPerHa: r.other_payments_per_ha,
  };
}
