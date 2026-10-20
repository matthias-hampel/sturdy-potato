/**
 * Base fertilization per crop (reference base-fertilization page): soil values, P2O5, K2O and
 * MgO need by removal and content class, what was delivered and is planned, the balance, the
 * lime requirement (computed or entered) and the DüV §6 six-year P2O5 balance of the field.
 */
import { Injectable } from '@nestjs/common';
import type { BaseFertilizationSettingsInput, BaseNutrientRow, CycleBaseFertilization, P2o5Balance, SoilClass } from '@agmeo/contracts';
import { soilClassOf } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { Database, type Trx } from '../../db/database.js';
import { baseFertilizationNeed, hasByProduct, limeRequirement, p2o5Balance } from './lib/base-fertilization.js';
import { NutrientsService } from './nutrients.service.js';

const r1 = (v: number) => Math.round(v * 10) / 10;
const BALANCE_YEARS = 6;

@Injectable()
export class BaseFertilizationService {
  constructor(
    private readonly db: Database,
    private readonly nutrients: NutrientsService,
  ) {}

  season(ctx: Ctx, seasonId: string): Promise<CycleBaseFertilization[]> {
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year']).where('id', '=', seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const cycles = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('fields as f', 'f.id', 'cc.field_id')
        .innerJoin('crops as c', 'c.id', 'cc.crop_id')
        .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
        .select(['cc.id', 'cc.field_id', 'c.code', 'cc.straw_removed', 'cc.lime_requirement_dt_cao'])
        .where('cc.season_id', '=', seasonId)
        .where('cc.role', '=', 'main')
        .where('f.status', '=', 'active')
        .orderBy('f.name')
        .orderBy(sql`fp.sort_order nulls first`)
        .execute();
      const ids = cycles.map((c) => c.id);
      const [yields, lines] = await Promise.all([this.harvestYields(trx, ids), this.nutrients.fertilizationLines(trx, { cropCycleIds: ids, statuses: ['completed', 'in_progress', 'planned'] })]);
      const balances = await this.p2o5Balances(trx, [...new Set(cycles.map((c) => c.field_id))], season.harvest_year);
      const out: CycleBaseFertilization[] = [];
      for (const c of cycles) {
        const harvested = yields.get(c.id);
        const need = await this.nutrients.computeNeed(trx, c.id, harvested != null ? { expectedYieldTHa: harvested } : {});
        const inp = need.inputs;
        const soil: SoilClass = soilClassOf(inp.soilTexture.value);
        const sample = inp.soilSample;
        const own = lines.filter((l) => l.crop_cycle_id === c.id);
        const sum = (status: 'done' | 'planned', k: 'p2o5' | 'k2o' | 'mgo' | 'cao') =>
          r1(own.filter((l) => (status === 'planned' ? l.status === 'planned' : l.status !== 'planned')).reduce((s, l) => s + (l.nutrients[k] ?? 0), 0));
        const soilValue = { p2o5: sample?.p2o5Mg100g ?? null, k2o: sample?.k2oMg100g ?? null, mgo: sample?.mgoMg100g ?? null };
        const nutrients: BaseNutrientRow[] = need.pk.map((p) => {
          const delivered = sum('done', p.nutrient);
          return {
            nutrient: p.nutrient,
            soilMg100g: soilValue[p.nutrient],
            contentClass: p.contentClass,
            factor: p.factor,
            removal: p.removal,
            need: p.need,
            delivered,
            planned: sum('planned', p.nutrient),
            balance: p.need == null ? null : r1(p.need - delivered),
          };
        });
        out.push({
          cropCycleId: c.id,
          fieldId: c.field_id,
          soil: { sampledOn: sample?.sampledOn ?? null, ph: sample?.ph ?? null, phMethod: sample?.phMethod ?? null, humusPct: inp.humusPct.value, texture: inp.soilTexture.value },
          yieldTHa: inp.expectedYieldTHa.value,
          yieldSource: harvested != null ? 'harvest' : inp.expectedYieldTHa.value != null ? 'expected' : null,
          strawRemoved: c.straw_removed,
          hasStraw: hasByProduct(c.code),
          limeComputedDtCaO: limeRequirement(sample?.ph ?? null, sample?.phMethod ?? null, soil, inp.humusPct.value),
          limeOverrideDtCaO: c.lime_requirement_dt_cao,
          nutrients,
          caoDelivered: sum('done', 'cao'),
          caoPlanned: sum('planned', 'cao'),
          p2o5Balance: balances.get(c.field_id)!,
        });
      }
      return out;
    });
  }

  /** Straw removal and the entered lime requirement of a crop. */
  setSettings(ctx: Ctx, cropCycleId: string, input: BaseFertilizationSettingsInput): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const set = {
        ...(input.strawRemoved !== undefined ? { straw_removed: input.strawRemoved } : {}),
        ...(input.limeRequirementDtCaO !== undefined ? { lime_requirement_dt_cao: input.limeRequirementDtCaO } : {}),
      };
      if (!Object.keys(set).length) return;
      const res = await trx.updateTable('crop_cycles').set(set).where('id', '=', cropCycleId).executeTakeFirst();
      if (!Number(res.numUpdatedRows)) throw notFound('Crop cycle');
      await record(trx, ctx, { entityType: 'crop_cycle', entityId: cropCycleId, action: 'updated', changes: input as Record<string, unknown> });
    });
  }

  /** Documented yield per crop: harvested tonnes over harvested hectares. */
  private async harvestYields(trx: Trx, cropCycleIds: string[]): Promise<Map<string, number>> {
    if (!cropCycleIds.length) return new Map();
    const rows = await trx
      .selectFrom('harvests')
      .select(['crop_cycle_id', sql<number>`sum(quantity_t)::float8`.as('t'), sql<number>`sum(harvested_area_ha)::float8`.as('ha')])
      .where('crop_cycle_id', 'in', cropCycleIds)
      .groupBy('crop_cycle_id')
      .execute();
    return new Map(rows.filter((r) => r.ha > 0).map((r) => [r.crop_cycle_id, r.t / r.ha]));
  }

  /**
   * The six harvest years up to `toYear` per field: supply = P2O5 of documented fertilizations of
   * the field's crops in each year's season, per hectare of the field; removal = the main crops'
   * P2O5 removal at their documented (else expected) yield, area-weighted.
   */
  private async p2o5Balances(trx: Trx, fieldIds: string[], toYear: number): Promise<Map<string, P2o5Balance>> {
    const out = new Map<string, P2o5Balance>();
    const fromYear = toYear - BALANCE_YEARS + 1;
    if (!fieldIds.length) return out;
    const cycles = await trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'cc.field_id')
      .select(['cc.id', 'cc.field_id', 'cc.role', 's.harvest_year', 'c.code', 'cc.expected_yield_t_ha', 'cc.straw_removed', sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)::float8`.as('area_ha'), sql<number>`coalesce(g.area_ha, 0)::float8`.as('field_ha')])
      .where('cc.field_id', 'in', fieldIds)
      .where('s.harvest_year', '>=', fromYear)
      .where('s.harvest_year', '<=', toYear)
      .execute();
    const ids = cycles.map((c) => c.id);
    const [yields, lines] = await Promise.all([this.harvestYields(trx, ids), this.nutrients.fertilizationLines(trx, { cropCycleIds: ids, statuses: ['completed'] })]);
    for (const fieldId of fieldIds) {
      const years: P2o5Balance['years'] = [];
      for (let year = fromYear; year <= toYear; year++) {
        const inYear = cycles.filter((c) => c.field_id === fieldId && c.harvest_year === year);
        const fieldHa = inYear[0]?.field_ha ?? 0;
        const ids = new Set(inYear.map((c) => c.id));
        const supplyKg = lines.filter((l) => l.crop_cycle_id && ids.has(l.crop_cycle_id)).reduce((s, l) => s + (l.nutrients.p2o5 ?? 0) * l.treated_area_ha, 0);
        let removalKg = 0;
        let removalHa = 0;
        for (const c of inYear.filter((x) => x.role === 'main')) {
          const y = yields.get(c.id) ?? c.expected_yield_t_ha;
          if (!y) continue;
          const removal = baseFertilizationNeed(c.code, y, c.straw_removed, 'medium', null).find((p) => p.nutrient === 'p2o5')?.removal;
          if (removal == null) continue;
          removalKg += removal * c.area_ha;
          removalHa += c.area_ha;
        }
        years.push({ year, supply: fieldHa > 0 ? r1(supplyKg / fieldHa) : 0, removal: removalHa > 0 ? r1(removalKg / removalHa) : null });
      }
      out.set(fieldId, { fromYear, toYear, years, ...p2o5Balance(years) });
    }
    return out;
  }
}
