import { Injectable } from '@nestjs/common';
import {
  type BaseUnit,
  type CarbonMeasure,
  type CarbonRecommendationCycle,
  type CarbonRecommendations,
  type CarbonReport,
  type CarbonReportCrop,
  type CarbonReportNotes,
  type CarbonReportNotesInput,
  type FertilizerType,
  isOrganicFertilizer,
  nutrientKgPerHa,
  ORGANIC_FERTILIZER_TYPES,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import PARAMS from './bek/parameters.js';
import { CarbonService, type CycleRow, cycleInput } from './carbon.service.js';
import { carbonCrop, hasModelData } from './crops.js';
import { incorporationTime } from './emissions.js';
import { loadOperationCarbon } from './ledger.js';
import { operationMeasures, strawMeasure } from './recommendations.js';

/** Share of last year's organic N that counts in this year (BEK, reference `nLastYear`). */
const LAST_YEAR_N_SHARE = 0.1;

/**
 * Emission recommendations and the CO2 report of a harvest year: measures priced with the BEK
 * calculator per crop cycle, and the management data, summary and notes of the printable report.
 */
@Injectable()
export class CarbonReportService {
  constructor(
    private readonly db: Database,
    private readonly carbon: CarbonService,
  ) {}

  private async seasonIds(trx: Trx, harvestYear: number): Promise<string[]> {
    const rows = await trx
      .selectFrom('growing_seasons')
      .select('id')
      .where('harvest_year', '=', harvestYear)
      .execute();
    return rows.map((r) => r.id);
  }

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  recommendations(
    ctx: Ctx,
    harvestYear: number,
  ): Promise<CarbonRecommendations> {
    return this.db.run(ctx, async (trx) => {
      const empty: CarbonRecommendations = {
        harvestYear,
        cycles: [],
        emissionsKg: 0,
        savingsKg: 0,
      };
      const seasonIds = await this.seasonIds(trx, harvestYear);
      if (!seasonIds.length) return empty;
      const analysis = await this.carbon.analysisIn(trx, ctx.orgId, 'field', [
        harvestYear,
      ]);
      const cycles = new Map(
        (await this.carbon.cycles(trx, seasonIds)).map((c) => [c.id, c]),
      );
      const measures = new Map<string, CarbonMeasure[]>();
      const push = (cycleId: string, m: CarbonMeasure) =>
        measures.set(cycleId, [...(measures.get(cycleId) ?? []), m]);

      // Operations with an organic fertilizer or a urea with inhibitor on this year's crops.
      const ops = await trx
        .selectFrom('operations as o')
        .select([
          'o.id',
          'o.title',
          sql<
            string | null
          >`to_char(o.performed_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD')`.as(
            'day',
          ),
        ])
        .where('o.status', '=', 'completed')
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('operation_fields as ofl')
              .innerJoin('crop_cycles as cc', 'cc.id', 'ofl.crop_cycle_id')
              .select(sql`1`.as('x'))
              .whereRef('ofl.operation_id', '=', 'o.id')
              .where('cc.season_id', 'in', seasonIds),
          ),
        )
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('operation_inputs as oi')
              .innerJoin('products as p', 'p.id', 'oi.product_id')
              .select(sql`1`.as('x'))
              .whereRef('oi.operation_id', '=', 'o.id')
              .where('p.category', '=', 'fertilizer')
              .where('p.fertilizer_type', 'in', [
                ...ORGANIC_FERTILIZER_TYPES,
                'urea_inhibitor',
              ]),
          ),
        )
        .orderBy('o.performed_at')
        .execute();
      for (const o of ops) {
        const { op, lines } = await loadOperationCarbon(trx, o.id);
        const perCrop = new Map<string, ReturnType<typeof operationMeasures>>();
        for (const line of lines) {
          const cycle = line.crop_cycle_id
            ? cycles.get(line.crop_cycle_id)
            : undefined;
          if (!cycle || !cycle.area_ha) continue;
          const key = line.crop_code ?? '';
          let priced = perCrop.get(key);
          if (!priced) {
            priced = operationMeasures(op, line.crop_code, harvestYear);
            perCrop.set(key, priced);
          }
          for (const m of priced) {
            const savedKg = m.savedKgPerHa * line.treated_area_ha;
            push(cycle.id, {
              type: m.type,
              operationId: o.id,
              operationTitle: o.title,
              date: o.day,
              productName: m.productName,
              savedKg,
              savedKgPerHa: savedKg / cycle.area_ha,
            });
          }
        }
      }

      // Straw left on the field.
      const organicN = await this.carbon.organicNByFieldYear(trx);
      for (const c of cycles.values()) {
        const input = cycleInput(c, organicN);
        if (!input?.harvested) continue;
        const m = strawMeasure(input, harvestYear);
        if (m)
          push(c.id, {
            type: m.type,
            operationId: null,
            operationTitle: null,
            date: c.harvested_on,
            productName: null,
            savedKgPerHa: m.savedKgPerHa,
            savedKg: m.savedKgPerHa * c.area_ha,
          });
      }

      const out: CarbonRecommendationCycle[] = [];
      for (const row of analysis.rows) {
        const c = cycles.get(row.entityId);
        if (!c) continue;
        const list = (measures.get(c.id) ?? [])
          .map((m) => ({
            ...m,
            savedKg: round(m.savedKg, 1),
            savedKgPerHa: round(m.savedKgPerHa, 2),
          }))
          .sort((a, b) => b.savedKg - a.savedKg);
        out.push({
          cropCycleId: c.id,
          fieldId: c.field_id,
          fieldName: c.field_name,
          cropId: c.crop_id,
          cropName: c.crop_name,
          cropColor: c.crop_color,
          templateName: c.template_name,
          areaHa: round(c.area_ha, 4),
          yieldTHa: yieldTHa(c),
          emissionsKg: row.total,
          savingsKg: round(
            list.reduce((s, m) => s + m.savedKg, 0),
            1,
          ),
          measures: list,
        });
      }
      out.sort(
        (a, b) =>
          b.savingsKg - a.savingsKg || a.fieldName.localeCompare(b.fieldName),
      );
      return {
        harvestYear,
        cycles: out,
        emissionsKg: round(
          out.reduce((s, c) => s + c.emissionsKg, 0),
          1,
        ),
        savingsKg: round(
          out.reduce((s, c) => s + c.savingsKg, 0),
          1,
        ),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  report(ctx: Ctx, harvestYear: number): Promise<CarbonReport> {
    return this.db.run(ctx, async (trx) => {
      const notes = await this.notesIn(trx, harvestYear);
      const seasonIds = await this.seasonIds(trx, harvestYear);
      if (!seasonIds.length) return { harvestYear, crops: [], notes };
      const analysis = await this.carbon.analysisIn(trx, ctx.orgId, 'crop', [
        harvestYear,
      ]);
      const cycles = await this.carbon.cycles(trx, seasonIds);
      const cropOf = new Map(cycles.map((c) => [c.id, c.crop_id]));

      // Applied amounts of the completed operations on this year's crops, per crop.
      const { rows } = await sql<{
        crop_cycle_id: string;
        treated_area_ha: number;
        total_quantity: number;
        op_area: number;
        incorporation_hours: string | null;
        category: string;
        fertilizer_type: string | null;
        base_unit: string;
        n_pct: number | null;
        density_t_m3: number | null;
      }>`
        SELECT ofl.crop_cycle_id, ofl.treated_area_ha, oi.total_quantity, tot.area AS op_area,
               o.details ->> 'incorporationHours' AS incorporation_hours,
               p.category, p.fertilizer_type, p.base_unit, p.n_pct, p.density_t_m3
        FROM operations o
        JOIN operation_fields ofl ON ofl.operation_id = o.id
        JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id
        JOIN operation_inputs oi ON oi.operation_id = o.id
        JOIN products p ON p.id = oi.product_id
        JOIN LATERAL (SELECT sum(treated_area_ha) AS area FROM operation_fields WHERE operation_id = o.id) tot ON true
        WHERE o.status = 'completed' AND cc.season_id IN (${sql.join(seasonIds)})
          AND p.category IN ('fertilizer', 'crop_protection')`.execute(trx);
      const applied = new Map<
        string,
        { mineralN: number; organicN: number; organicN1h: number; ppp: number }
      >();
      for (const r of rows) {
        const cropId = cropOf.get(r.crop_cycle_id);
        if (!cropId || !r.op_area) continue;
        const a = applied.get(cropId) ?? {
          mineralN: 0,
          organicN: 0,
          organicN1h: 0,
          ppp: 0,
        };
        applied.set(cropId, a);
        const rate = r.total_quantity / r.op_area;
        const unit = r.base_unit as BaseUnit;
        if (r.category === 'crop_protection') {
          a.ppp +=
            (unit === 't' || unit === 'm3'
              ? rate * 1000
              : unit === 'unit'
                ? 0
                : rate) * r.treated_area_ha;
          continue;
        }
        const type = r.fertilizer_type as FertilizerType | null;
        const n =
          (nutrientKgPerHa(
            { nPct: r.n_pct, densityTM3: r.density_t_m3, fertilizerType: type },
            rate,
            unit,
          ).n ?? 0) * r.treated_area_ha;
        if (isOrganicFertilizer(type)) {
          a.organicN += n;
          const hours =
            r.incorporation_hours != null
              ? Number(r.incorporation_hours)
              : null;
          if (incorporationTime(hours) === '1h') a.organicN1h += n;
        } else a.mineralN += n;
      }

      // 10 % of last year's organic N, by crop (main crops, as in the analysis).
      const organicN = await this.carbon.organicNByFieldYear(trx);
      const previousN = new Map<string, number>();
      for (const c of cycles) {
        if (c.role !== 'main' || !c.area_ha) continue;
        const n = organicN.get(`${c.field_id}:${c.harvest_year - 1}`) ?? 0;
        previousN.set(
          c.crop_id,
          (previousN.get(c.crop_id) ?? 0) + n * LAST_YEAR_N_SHARE * c.area_ha,
        );
      }

      const crops: CarbonReportCrop[] = analysis.rows.map((r) => {
        const crop = carbonCrop(r.cropCode);
        const params = hasModelData(crop) ? PARAMS.crop[crop] : null;
        const a = applied.get(r.cropId);
        const perHa = (v: number) => (r.areaHa ? round(v / r.areaHa, 1) : 0);
        return {
          cropId: r.cropId,
          cropCode: r.cropCode,
          cropName: r.cropName,
          cropColor: r.cropColor,
          carbonCrop: r.carbonCrop,
          hasModelData: r.hasModelData,
          areaHa: r.areaHa,
          yieldT: r.yieldT,
          yieldTHa: r.areaHa && r.yieldT ? round(r.yieldT / r.areaHa, 2) : null,
          dryMatterPct: params ? round(params.dryMatterContent * 100, 1) : null,
          byproductRatio: params ? round(params.MPBR ?? 0, 2) : null,
          mineralNKgHa: perHa(a?.mineralN ?? 0),
          organicNKgHa: perHa(a?.organicN ?? 0),
          incorporated1hPct: a?.organicN
            ? round((a.organicN1h / a.organicN) * 100, 0)
            : null,
          previousYearNKgHa: perHa(previousN.get(r.cropId) ?? 0),
          protectionKgLHa: perHa(a?.ppp ?? 0),
        };
      });
      return { harvestYear, crops, notes };
    });
  }

  private async notesIn(
    trx: Trx,
    harvestYear: number,
  ): Promise<CarbonReportNotes> {
    const row = await trx
      .selectFrom('carbon_report_notes')
      .select(['summary', 'notes', 'updated_at'])
      .where('harvest_year', '=', harvestYear)
      .executeTakeFirst();
    return {
      harvestYear,
      summary: row?.summary ?? null,
      notes: row?.notes ?? '',
      updatedAt: row ? iso(row.updated_at) : null,
    };
  }

  saveNotes(
    ctx: Ctx,
    input: Out<typeof CarbonReportNotesInput>,
  ): Promise<CarbonReportNotes> {
    return this.db.run(ctx, async (trx) => {
      const summary = input.summary?.trim() ? input.summary : null;
      await trx
        .insertInto('carbon_report_notes')
        .values({
          organization_id: ctx.orgId,
          harvest_year: input.harvestYear,
          summary,
          notes: input.notes,
          updated_by: ctx.userId,
        })
        .onConflict((oc) =>
          oc.columns(['organization_id', 'harvest_year']).doUpdateSet({
            summary,
            notes: input.notes,
            updated_at: new Date(),
            updated_by: ctx.userId,
          }),
        )
        .execute();
      await record(trx, ctx, {
        entityType: 'carbon_report',
        entityId: ctx.orgId,
        action: 'updated',
        changes: { harvestYear: input.harvestYear },
      });
      return this.notesIn(trx, input.harvestYear);
    });
  }
}

function yieldTHa(c: CycleRow): number | null {
  if (c.harvested_t && c.harvested_area)
    return round(c.harvested_t / c.harvested_area, 2);
  return c.expected_yield_t_ha;
}
