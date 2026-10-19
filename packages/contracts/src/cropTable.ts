import { z } from 'zod';
import { isoDate } from './common.js';
import type { RevenueBasis } from './economics.js';
import type { ConditionDay } from './insights.js';

// ---------------------------------------------------------------------------
// Crop table (the reference's field table, fields/[year]): per-crop values of a season in one
// request each, so the table's weather, satellite and economic columns load without one
// request per row.
// ---------------------------------------------------------------------------

export interface CropTableConditionsRow {
  cropCycleId: string;
  fieldId: string;
  /** Booked sowing date, else the planned one. */
  sowingDate: string | null;
  sowingSource: 'booked' | 'planned' | null;
  /** Growing degree days since sowing (crop base temperature). */
  gdd: number | null;
  /** Today's BBCH stage: phenology model, else crop calendar; shifted by farmer observations. */
  bbch: number | null;
  bbchSource: 'model' | 'calendar' | null;
  bbchCalibrated: boolean;
  /** Whether the crop's phenology model takes farmer observations (ESM crops). */
  bbchCalibratable: boolean;
  /** The farmer's observation of today, if one was entered. */
  bbchObservedToday: number | null;
  /** Latest valid satellite value of the field. */
  ndvi: { value: number; observedOn: string } | null;
  lai: { value: number; observedOn: string } | null;
  /** Rain in mm: since sowing (else since the season start), the last and next 24 hours and 7 days. */
  precipitation: { seasonMm: number | null; last24hMm: number | null; last7dMm: number | null; next24hMm: number | null; next7dMm: number | null };
  /** Condition bars from today (disease: the last days with ISIP data); null where the model has no data. */
  bars: {
    spraying: ConditionDay[] | null;
    sowing: ConditionDay[] | null;
    weatherRisk: ConditionDay[] | null;
    trafficability: ConditionDay[] | null;
    disease: ConditionDay[] | null;
  };
}

export interface CropTableConditions {
  seasonId: string;
  /** Oldest weather refresh among the fields' grid cells. */
  refreshedAt: string | null;
  rows: CropTableConditionsRow[];
}

export interface CropTableEvaluationRow {
  cropCycleId: string;
  /** Harvested quantity over harvested area. */
  documentedYieldTHa: number | null;
  /** Mean of the current yield map. */
  yieldMapTHa: number | null;
  /** Deckungsbeitrag II per hectare (revenue minus direct, machinery and labour costs). */
  db2PerHa: number | null;
  revenueBasis: RevenueBasis;
  co2ePerHa: number | null;
  /** N of completed applications, kg/ha (total and plant-available). */
  nAppliedKgHa: number | null;
  nAvailableAppliedKgHa: number | null;
  /** N of planned applications, kg/ha. */
  nPlannedKgHa: number | null;
  /** DüV N need, kg/ha; null when the crop has no DüV values or is not a main crop. */
  nNeedKgHa: number | null;
}

export interface CropTableEvaluation {
  seasonId: string;
  currency: string;
  rows: CropTableEvaluationRow[];
}

/** A BBCH stage seen on the field; `date` defaults to today. */
export const BbchObservationInput = z.object({
  bbch: z.number().int().min(0).max(99),
  date: isoDate.optional(),
});
export type BbchObservationInput = z.input<typeof BbchObservationInput>;
