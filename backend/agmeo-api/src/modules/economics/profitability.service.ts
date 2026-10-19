/**
 * Profitability per field after the reference app (lib/economics/farmProfitability.ts and
 * fieldPnl.ts): the season's contribution margins per crop, carried on per hectare through
 * buildings, land, rights and overheads to the farm result with CAP payments, plus diesel, hours,
 * nitrogen and passes, and how complete the season's records are.
 */
import { Injectable } from '@nestjs/common';
import {
  type BaseUnit,
  type CostCategory,
  type FarmProfitability,
  type FieldProfitability,
  type ProfitabilityCoverage,
  nutrientKgPerHa,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { derivedLeasePerHa } from '../cadastral/cadastral.service.js';
import { EconomicsService, capPayments } from './economics.service.js';

interface Physical {
  diesel: number;
  hours: number;
  nKg: number;
  passes: number;
  ops?: Set<string>;
}

@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly db: Database,
    private readonly economics: EconomicsService,
  ) {}

  async farm(ctx: Ctx, seasonId?: string): Promise<FarmProfitability | null> {
    const summary = await this.economics.summary(ctx, seasonId);
    if (!summary) return null;
    const overheads = await this.economics.overheads(ctx, summary.seasonId);
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select('harvest_year').where('id', '=', summary.seasonId).executeTakeFirstOrThrow();
      const cycleIds = summary.cycles.map((c) => c.cropCycleId);
      const [physical, fieldInfo, coverage, parcelLease] = await Promise.all([
        this.physical(trx, summary.seasonId),
        cycleIds.length
          ? trx
              .selectFrom('crop_cycles as cc')
              .innerJoin('fields as f', 'f.id', 'cc.field_id')
              .select(['cc.id', 'f.lease_per_ha', 'cc.template_id'])
              .select(
                sql<{ id: string; name: string; color: string }[]>`coalesce((
                  SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color) ORDER BY g.name)
                  FROM field_group_members m JOIN field_groups g ON g.id = m.group_id WHERE m.field_id = f.id), '[]')`.as('groups'),
              )
              .where('cc.id', 'in', cycleIds)
              .execute()
          : Promise.resolve([]),
        this.coverage(trx, summary.seasonId),
        // Rent per ha from the fields' cadastral parcel leases, where the field has no lease of its own.
        derivedLeasePerHa(trx, [...new Set(summary.cycles.map((c) => c.fieldId))]),
      ]);
      const infoOf = new Map(fieldInfo.map((r) => [r.id, r]));

      const o = overheads;
      const totalHa = summary.cycles.reduce((s, c) => s + c.areaHa, 0);
      const payments = o
        ? capPayments(totalHa, {
            lease_per_ha: o.leasePerHa, land_tax_per_ha: o.landTaxPerHa, insurance_per_ha: o.insurancePerHa, buildings_per_ha: o.buildingsPerHa,
            accounting_per_ha: o.accountingPerHa, other_per_ha: o.otherPerHa, basic_payment_per_ha: o.basicPaymentPerHa,
            redistributive1_per_ha: o.redistributive1PerHa, redistributive2_per_ha: o.redistributive2PerHa, eco_schemes_per_ha: o.ecoSchemesPerHa,
            other_payments_per_ha: o.otherPaymentsPerHa, accident_insurance_per_ha: o.accidentInsurancePerHa, rights_per_ha: o.rightsPerHa,
            salary_per_hour: o.salaryPerHour, agri_env_per_ha: o.agriEnvPerHa, young_farmers_per_ha: o.youngFarmersPerHa,
            total_ha_for_redistribution: o.totalHaForRedistribution ?? null,
          })
        : null;
      const subsidiesPerHa = payments && totalHa ? payments.total / totalHa : 0;

      const fields: FieldProfitability[] = summary.cycles
        .filter((c) => c.areaHa > 0)
        .map((c) => {
          const ha = c.areaHa;
          const per = (v: number) => round(v / ha);
          const cat = (...keys: CostCategory[]) => keys.reduce((s, k) => s + (c.costs[k] ?? 0), 0);
          const info = infoOf.get(c.cropCycleId);
          const p = physical.get(c.cropCycleId) ?? { diesel: 0, hours: 0, nKg: 0, passes: 0 };
          const revenue = per(c.revenue);
          const directCosts = per(c.directCosts);
          const dfl = revenue - directCosts;
          const machineryCosts = per(c.machineryCosts);
          const db1 = dfl - machineryCosts;
          const laborCosts = per(c.laborCosts);
          // Land rent, insurance and other cost entries booked on the crop come off DB II too.
          const db2 = db1 - laborCosts - per(c.otherCosts);
          const buildingCosts = o?.buildingsPerHa ?? 0;
          const leasePerHa = info?.lease_per_ha ?? parcelLease.get(c.fieldId) ?? o?.leasePerHa ?? 0;
          const landCosts = leasePerHa + (o?.landTaxPerHa ?? 0) + (o?.accidentInsurancePerHa ?? 0);
          const rightsCosts = o?.rightsPerHa ?? 0;
          const singleCostFreeMargin = db2 - buildingCosts - landCosts - rightsCosts;
          const overhead = (o?.insurancePerHa ?? 0) + (o?.accountingPerHa ?? 0) + (o?.otherPerHa ?? 0);
          const resultBeforeSubsidies = singleCostFreeMargin - overhead;
          return {
            cropCycleId: c.cropCycleId,
            fieldId: c.fieldId,
            fieldName: c.fieldName,
            cropId: c.cropId,
            cropName: c.cropName,
            cropColor: c.cropColor,
            areaHa: ha,
            groups: info?.groups ?? [],
            revenueBasis: c.revenueBasis,
            revenue,
            seedCost: per(cat('seed')),
            fertilizerCost: per(cat('fertilizer')),
            protectionCost: per(cat('crop_protection')),
            otherDirectCost: per(cat('other_input')),
            directCosts,
            dfl: round(dfl),
            machineryCosts,
            db1: round(db1),
            laborCosts,
            db2: round(db2),
            buildingCosts,
            leasePerHa,
            landCosts: round(landCosts),
            rightsCosts,
            singleCostFreeMargin: round(singleCostFreeMargin),
            overhead: round(overhead),
            resultBeforeSubsidies: round(resultBeforeSubsidies),
            subsidiesPerHa: round(subsidiesPerHa),
            farmResult: round(resultBeforeSubsidies + subsidiesPerHa),
            dieselLHa: round(p.diesel / ha, 1),
            hoursHa: round(p.hours / ha, 2),
            yieldTHa: c.yieldTHa,
            nKgHa: round(p.nKg / ha, 1),
            passes: p.passes,
          };
        });

      return {
        seasonId: summary.seasonId,
        seasonName: summary.seasonName,
        harvestYear: season.harvest_year,
        currency: summary.currency,
        totalHa: round(totalHa, 4),
        fields,
        overheads,
        subsidies: { totalEur: payments?.total ?? 0, perHa: round(subsidiesPerHa) },
        coverage: {
          ...coverage,
          fieldsWithCrop: new Set(summary.cycles.map((c) => c.fieldId)).size,
          templateCycles: fieldInfo.filter((r) => r.template_id).length,
          totalCycles: summary.cycles.length,
        },
      };
    });
  }

  /** Several seasons for the multi-year view, oldest first. */
  async years(ctx: Ctx, fromYear: number, toYear: number): Promise<FarmProfitability[]> {
    const seasons = await this.db.run(ctx, (trx) =>
      trx.selectFrom('growing_seasons').select('id').where('harvest_year', '>=', fromYear).where('harvest_year', '<=', toYear).orderBy('harvest_year').execute(),
    );
    const out: FarmProfitability[] = [];
    for (const s of seasons) {
      const p = await this.farm(ctx, s.id);
      if (p) out.push(p);
    }
    return out;
  }

  /**
   * Diesel, machine/labour hours, nitrogen and passes of the completed operations per crop cycle,
   * split by treated area. Diesel as in the emissions: recorded fuel, else the operation's diesel
   * per hectare, else machine hours × consumption.
   */
  private async physical(trx: Trx, seasonId: string): Promise<Map<string, Physical>> {
    const { rows } = await sql<{ crop_cycle_id: string; operation_id: string; treated_area_ha: number; share: number; fuel: number; diesel_l_per_ha: number | null; machine_fuel: number; hours: number }>`
      WITH lines AS (
        SELECT ofl.operation_id, ofl.crop_cycle_id, ofl.treated_area_ha,
               ofl.treated_area_ha / nullif(sum(ofl.treated_area_ha) OVER (PARTITION BY ofl.operation_id), 0) AS share
        FROM operation_fields ofl
        JOIN operations o ON o.id = ofl.operation_id AND o.status = 'completed'
        JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id AND cc.season_id = ${seasonId}
      )
      SELECT l.crop_cycle_id, l.operation_id, l.treated_area_ha, coalesce(l.share, 0) AS share, o.diesel_l_per_ha,
             (SELECT coalesce(sum(CASE p.base_unit WHEN 'm3' THEN oi.total_quantity * 1000 ELSE oi.total_quantity END), 0)
                FROM operation_inputs oi JOIN products p ON p.id = oi.product_id
               WHERE oi.operation_id = o.id AND p.category = 'fuel' AND p.base_unit IN ('l', 'm3')) AS fuel,
             (SELECT coalesce(sum(q.hours * coalesce(e.fuel_l_per_h, 0)), 0) FROM operation_equipment q JOIN equipment e ON e.id = q.equipment_id WHERE q.operation_id = o.id) AS machine_fuel,
             greatest((SELECT coalesce(sum(q.hours), 0) FROM operation_equipment q WHERE q.operation_id = o.id),
                      (SELECT coalesce(sum(lb.hours), 0) FROM operation_labor lb WHERE lb.operation_id = o.id)) AS hours
      FROM lines l JOIN operations o ON o.id = l.operation_id`.execute(trx);

    const fert = rows.length
      ? await trx
          .selectFrom('operation_inputs as oi')
          .innerJoin('products as p', 'p.id', 'oi.product_id')
          .select(['oi.operation_id', 'oi.total_quantity', 'p.base_unit', 'p.n_pct', 'p.nh4_n_pct', 'p.p2o5_pct', 'p.k2o_pct', 'p.mgo_pct', 'p.s_pct', 'p.cao_pct', 'p.density_t_m3', 'p.fertilizer_type'])
          .where('oi.operation_id', 'in', [...new Set(rows.map((r) => r.operation_id))])
          .where('p.category', '=', 'fertilizer')
          .execute()
      : [];
    const nOfOp = new Map<string, number>();
    for (const f of fert) {
      const n = nutrientKgPerHa(
        { nPct: f.n_pct, nh4NPct: f.nh4_n_pct, p2o5Pct: f.p2o5_pct, k2oPct: f.k2o_pct, mgoPct: f.mgo_pct, sPct: f.s_pct, caoPct: f.cao_pct, densityTM3: f.density_t_m3, fertilizerType: f.fertilizer_type as never },
        f.total_quantity,
        f.base_unit as BaseUnit,
      ).n;
      nOfOp.set(f.operation_id, (nOfOp.get(f.operation_id) ?? 0) + (n ?? 0));
    }

    const out = new Map<string, Physical>();
    for (const r of rows) {
      const share = Number(r.share);
      const diesel = r.fuel > 0 ? r.fuel * share : r.diesel_l_per_ha != null ? r.diesel_l_per_ha * r.treated_area_ha : r.machine_fuel * share;
      const cur = out.get(r.crop_cycle_id) ?? { diesel: 0, hours: 0, nKg: 0, passes: 0 };
      cur.diesel += diesel;
      cur.hours += Number(r.hours) * share;
      cur.nKg += (nOfOp.get(r.operation_id) ?? 0) * share;
      cur.ops = (cur.ops ?? new Set()).add(r.operation_id);
      cur.passes = cur.ops.size;
      out.set(r.crop_cycle_id, cur);
    }
    return out;
  }

  /** How complete the season's records are: documented operations, priced products, fields with a crop. */
  private async coverage(trx: Trx, seasonId: string): Promise<Omit<ProfitabilityCoverage, 'fieldsWithCrop' | 'templateCycles' | 'totalCycles'>> {
    const ops = await sql<{ id: string; title: string; type: string; status: string; field_name: string; crop_name: string }>`
      SELECT DISTINCT ON (o.id) o.id, o.title, o.type, o.status, concat_ws(' · ', f.name, fp.name) AS field_name, coalesce(c.name_de, c.name) AS crop_name
      FROM operations o
      JOIN operation_fields ofl ON ofl.operation_id = o.id
      JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id AND cc.season_id = ${seasonId}
      JOIN fields f ON f.id = ofl.field_id
      LEFT JOIN field_parts fp ON fp.id = ofl.field_part_id
      JOIN crops c ON c.id = cc.crop_id
      WHERE o.status <> 'cancelled'
      ORDER BY o.id`.execute(trx);
    const products = await sql<{ id: string; name: string; priced: boolean }>`
      SELECT DISTINCT p.id, p.name,
             (p.unit_cost IS NOT NULL OR EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)
              OR bool_or(oi.unit_cost IS NOT NULL) OVER (PARTITION BY p.id)) AS priced
      FROM operation_inputs oi
      JOIN products p ON p.id = oi.product_id
      JOIN operation_fields ofl ON ofl.operation_id = oi.operation_id
      JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id AND cc.season_id = ${seasonId}`.execute(trx);
    const totalFields = await trx.selectFrom('fields').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'active').executeTakeFirstOrThrow();
    const byProduct = new Map<string, { id: string; name: string; priced: boolean }>();
    for (const p of products.rows) byProduct.set(p.id, { ...p, priced: (byProduct.get(p.id)?.priced ?? false) || p.priced });
    const undocumented = ops.rows.filter((o) => o.status !== 'completed');
    return {
      documentedOps: ops.rows.length - undocumented.length,
      totalOps: ops.rows.length,
      pricedProducts: [...byProduct.values()].filter((p) => p.priced).length,
      totalProducts: byProduct.size,
      totalFields: totalFields.n,
      undocumentedOps: undocumented.slice(0, 100).map((o) => ({ operationId: o.id, title: o.title, type: o.type, fieldName: o.field_name, cropName: o.crop_name })),
      unpricedProducts: [...byProduct.values()].filter((p) => !p.priced).map((p) => ({ id: p.id, name: p.name })),
    };
  }
}
