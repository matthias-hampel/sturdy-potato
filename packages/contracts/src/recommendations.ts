import { z } from 'zod';
import { id, isoDate, type Ref } from './common.js';
import type { OperationStatus, OperationType } from './operations.js';
import type { TaskPriority } from './operations.js';

/**
 * Field recommendations: typed, bounded decisions ("what, when, where, why") of a versioned rule
 * set over the calendar, weather, satellite observations and DüV/PSM rules. A language model may
 * phrase the reason, but never adds or changes a decision.
 */
export const RECOMMENDATION_RULE_SET = 'AGMEO-REC-2026.1';

export const RECOMMENDATION_KINDS = ['operation_timing', 'scouting', 'fertilization', 'compliance', 'variable_rate'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

/**
 * - `do_now`: the planned operation fits the forecast, go ahead.
 * - `postpone`: the planned day does not fit; `window` is the better day.
 * - `catch_up`: the operation is overdue; `window` is the next suitable day.
 * - `inspect`: walk the field (or the given zones) and look.
 * - `plan_operation`: work is missing from the plan.
 * - `review`: a planned operation conflicts with a rule; check before doing it.
 * - `create_vra_map`: the field has productivity zones; apply the rate per zone.
 */
export const RECOMMENDATION_ACTIONS = ['do_now', 'postpone', 'catch_up', 'inspect', 'plan_operation', 'review', 'create_vra_map'] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

export const RECOMMENDATION_STATUSES = ['open', 'accepted', 'dismissed', 'expired'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const DISMISS_REASONS = ['already_done', 'not_relevant', 'wrong_timing', 'wrong_data', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** Why a decision was made. Each code has a fixed set of params; the UI renders it in German. */
export const EVIDENCE_CODES = [
  // Calendar
  'planned_on', // {date}
  'overdue_days', // {days}
  // Weather (farm forecast)
  'spray_window', // {start, end, hours}
  'no_spray_window', // {date}
  'rain_forecast', // {date, mm, probability}
  'heavy_rain_forecast', // {date, mm}
  'rain_before', // {days, mm} rain in the days before (trafficability)
  'light_rain_after', // {date, mm} N is washed in
  'frost_forecast', // {date, tempMinC}
  'frozen_ground', // {date, tempMaxC}
  'strong_wind', // {date, windKmh, gustKmh}
  'dry_days', // {from, to}
  'weather_unavailable', // {}
  'forecast_lead_days', // {days}
  // Satellite
  'ndvi_drop', // {from, to, before, after, change}
  'ndvi_below_peers', // {date, value, peersMedian, peers}
  'ndvi_heterogeneous', // {date, p10, p90}
  // Nutrients and compliance
  'n_remaining', // {kgHa, needKgHa}
  'n_exceeds_need', // {kgHa, needKgHa}
  'closed_period', // {date, from, to, rule}
  'psm_finding', // {code, productName, ...params}
  'nitrate_sensitive_zone', // {}
  // Zones
  'productivity_zones', // {zoneCount, minPct, maxPct}
  'low_zones', // {zoneNos}
] as const;
export type EvidenceCode = (typeof EVIDENCE_CODES)[number];

export interface RecommendationEvidence {
  code: EvidenceCode;
  params: Record<string, string | number | null>;
}

export interface Recommendation {
  id: string;
  key: string;
  kind: RecommendationKind;
  action: RecommendationAction;
  operationType: OperationType | null;
  farmId: string;
  field: Ref;
  cropCycle: { id: string; cropName: string; cropColor: string | null } | null;
  operation: { id: string; title: string; plannedOn: string | null; status: OperationStatus } | null;
  /** Productivity zones the action applies to (1 = least productive); null for the whole field. */
  zoneNos: number[] | null;
  windowFrom: string | null;
  windowTo: string | null;
  priority: TaskPriority;
  /** 0–1: how sure the rule is, mostly lowered by forecast lead time and thin data. */
  confidence: number;
  evidence: RecommendationEvidence[];
  ruleSet: string;
  /** Plain-language reason from the language model; null when none is configured. */
  explanation: string | null;
  explanationModel: string | null;
  status: RecommendationStatus;
  dismissReason: DismissReason | null;
  taskId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface RecommendationList {
  generatedAt: string | null;
  ruleSet: string;
  briefing: string | null;
  explanationModel: string | null;
  /** Whether a language model is configured to phrase the reasons. */
  explanationsEnabled: boolean;
  items: Recommendation[];
}

export const RecommendationListQuery = z.object({
  fieldId: id.optional(),
  cropCycleId: id.optional(),
  status: z.enum([...RECOMMENDATION_STATUSES, 'all']).default('open'),
});
export type RecommendationListQuery = z.input<typeof RecommendationListQuery>;

/**
 * Accepting reschedules the operation to the recommended day (postpone, catch up) or creates a
 * task. The task title comes from the client so it is in the user's language.
 */
export const AcceptRecommendationInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  dueOn: isoDate.nullish(),
  assigneeEmployeeId: id.nullish(),
});
export type AcceptRecommendationInput = z.input<typeof AcceptRecommendationInput>;

export const DismissRecommendationInput = z.object({
  reason: z.enum(DISMISS_REASONS),
  note: z.string().trim().max(500).nullish(),
});
export type DismissRecommendationInput = z.input<typeof DismissRecommendationInput>;

export interface AcceptRecommendationResult {
  recommendation: Recommendation;
  taskId: string | null;
  rescheduledTo: string | null;
}
