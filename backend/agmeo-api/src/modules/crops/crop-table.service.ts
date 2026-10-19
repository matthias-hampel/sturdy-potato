/**
 * Economic and agronomic values of a season's crops for the crop table (the reference's field
 * list evaluation: yield, contribution margin, CO2e and nitrogen per cultivation). Read from the
 * season views the economics, nutrient and yield pages use, so the table shows their figures.
 */
import { Injectable } from '@nestjs/common';
import type { CropTableEvaluation, CropTableEvaluationRow } from '@agmeo/contracts';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { EconomicsService } from '../economics/economics.service.js';
import { NutrientsService } from '../nutrients/nutrients.service.js';
import { YieldService } from '../yield/yield.service.js';

@Injectable()
export class CropTableService {
  constructor(
    private readonly economics: EconomicsService,
    private readonly nutrients: NutrientsService,
    private readonly yields: YieldService,
  ) {}

  async evaluation(ctx: Ctx, seasonId: string): Promise<CropTableEvaluation> {
    const [summary, balance, yields] = await Promise.all([
      this.economics.summary(ctx, seasonId),
      this.nutrients.seasonBalance(ctx, seasonId),
      this.yields.overview(ctx, seasonId),
    ]);
    if (!summary) throw notFound('Season');
    const nOf = new Map(balance.rows.map((r) => [r.cropCycleId, r]));
    const mapOf = new Map(yields.rows.map((r) => [r.cropCycleId, r.raster?.meanTHa ?? null]));
    const rows: CropTableEvaluationRow[] = summary.cycles.map((c) => {
      const n = nOf.get(c.cropCycleId);
      return {
        cropCycleId: c.cropCycleId,
        documentedYieldTHa: c.yieldTHa,
        yieldMapTHa: mapOf.get(c.cropCycleId) ?? null,
        db2PerHa: c.revenueBasis === 'none' && !c.totalCosts ? null : c.db2PerHa,
        revenueBasis: c.revenueBasis,
        co2ePerHa: c.co2eKg ? c.co2ePerHa : null,
        nAppliedKgHa: n?.applied.n ?? null,
        nAvailableAppliedKgHa: n?.applied.availableN ?? null,
        nPlannedKgHa: n?.planned.n ?? null,
        nNeedKgHa: n?.nNeed ?? null,
      };
    });
    return { seasonId, currency: summary.currency, rows };
  }
}
