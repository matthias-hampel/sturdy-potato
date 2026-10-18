/**
 * Rule set AGMEO-REC-2026.1: turns calendar, weather, satellite and DüV/PSM facts into typed
 * decisions (what, when, where, why). Pure and deterministic like the DüV rule sets (ADR-007):
 * the same facts always give the same decisions, and every decision names its evidence. A
 * language model may phrase the reason afterwards, but never adds or changes a decision.
 *
 * The weather thresholds are orientation values for field work on the farm forecast, not a
 * product label or a soil-moisture model: trafficability and disease pressure are not modelled.
 */
import type {
  CropCategory,
  OperationType,
  RecommendationAction,
  RecommendationEvidence,
  RecommendationKind,
  SprayWindow,
  TaskPriority,
  WeatherDay,
} from '@agmeo/contracts';
import { closedPeriod, inClosedPeriod } from '../../nutrients/lib/closed-periods.js';

export interface WeatherFacts {
  /** Today and the forecast days after it. */
  daily: WeatherDay[];
  /** Days before today, oldest first. */
  past: WeatherDay[];
  /** Hourly spray windows of the next 72 hours, local time. */
  sprayWindows: SprayWindow[];
}

export interface OperationFacts {
  id: string;
  type: OperationType;
  title: string;
  status: 'planned' | 'in_progress';
  plannedOn: string | null;
  farmId: string;
  fields: { fieldId: string; cropCycleId: string | null }[];
  hasVraMap: boolean;
  closedPeriod: { date: string; from: string; to: string; rule: string } | null;
  psmDeviations: { code: string; productName: string; params: Record<string, string | number> }[];
}

export interface CycleFacts {
  id: string;
  fieldId: string;
  farmId: string;
  cropName: string;
  cropCategory: CropCategory;
  status: 'planned' | 'active' | 'harvested' | 'closed';
  sowingDate: string | null;
  expectedHarvestDate: string | null;
  nitrateSensitiveZone: boolean;
  nNeedKgHa: number | null;
  /** Need minus available N applied and planned (DüV); negative when plans exceed the need. */
  nRemainingKgHa: number | null;
  /** Valid NDVI observations, oldest first. */
  ndvi: { date: string; mean: number; p10: number | null; p90: number | null }[];
}

export interface ZoningFacts {
  zones: { zoneNo: number; relativeProductivity: number }[];
}

/** Completed work that explains a change in the field or settles a question. */
export interface CompletedWork {
  fieldId: string;
  type: OperationType;
  date: string;
}

export interface RuleInput {
  today: string;
  weatherByFarm: Map<string, WeatherFacts | null>;
  operations: OperationFacts[];
  cycles: CycleFacts[];
  zoningByField: Map<string, ZoningFacts>;
  completed: CompletedWork[];
}

export interface Decision {
  key: string;
  kind: RecommendationKind;
  action: RecommendationAction;
  operationType: OperationType | null;
  farmId: string;
  fieldId: string;
  cropCycleId: string | null;
  operationId: string | null;
  zoneNos: number[] | null;
  windowFrom: string | null;
  windowTo: string | null;
  priority: TaskPriority;
  confidence: number;
  evidence: RecommendationEvidence[];
}

export const THRESHOLDS = {
  /** Planned work this close is confirmed against the forecast (do now). */
  confirmDays: 2,
  /** Planned work is checked against the forecast up to this many days ahead. */
  lookaheadDays: 7,
  /** Overdue work older than this is left to the user; the plan is probably stale. */
  maxOverdueDays: 45,
  spray: { maxWindKmh: 15, maxGustKmh: 30, maxRainMm: 0.5, maxRainProbabilityPct: 30, minTempC: 8, maxTempC: 27 },
  fertilization: { maxRainMm: 5, heavyRainMm: 15, lightRainMinMm: 2, lightRainMaxMm: 10 },
  /** Rain on the day and the two days before that leaves soil too wet to drive on. */
  soil: { maxRainBeforeMm: 10, maxRainMm: 3 },
  harvest: { maxRainMm: 1, maxRainProbabilityPct: 50, maxRainDayBeforeMm: 5 },
  irrigation: { rainNext3DaysMm: 10 },
  ndvi: { minDrop: 0.08, strongDrop: 0.15, minVegetated: 0.3, maxAgeDays: 21, pairWithinDays: 30, belowPeers: 0.1, minPeers: 3, peersWithinDays: 10, heterogeneous: 0.25, harvestQuietDays: 21 },
  nitrogen: { minRemainingKgHa: 20, highRemainingKgHa: 60, exceedsKgHa: 15, planAheadDays: 21, minDaysToHarvest: 30 },
  vra: { minSpreadPct: 15, aheadDays: 21 },
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Forecast skill falls with lead time; so does how sure a weather-based decision can be. */
export function leadConfidence(leadDays: number): number {
  const table = [0.9, 0.85, 0.8, 0.7, 0.65, 0.6];
  return table[Math.max(0, leadDays)] ?? 0.5;
}

const ev = (code: RecommendationEvidence['code'], params: RecommendationEvidence['params'] = {}): RecommendationEvidence => ({ code, params });
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Weather suitability of a day for a kind of work
// ---------------------------------------------------------------------------

export interface DayAssessment {
  ok: boolean;
  /** Higher is better among suitable days. */
  score: number;
  evidence: RecommendationEvidence[];
}

/** Weather days around `date`: the day itself, the days before and the days after. */
function around(w: WeatherFacts, date: string) {
  const all = [...w.past, ...w.daily];
  const i = all.findIndex((d) => d.date === date);
  return { day: i >= 0 ? all[i] : null, before: i >= 0 ? all.slice(Math.max(0, i - 2), i) : [], after: i >= 0 ? all.slice(i + 1, i + 4) : [] };
}

const rain = (d: WeatherDay | null | undefined) => d?.precipitationMm ?? 0;

export function assessDay(type: OperationType, w: WeatherFacts, date: string, today: string): DayAssessment {
  const { day, before, after } = around(w, date);
  if (!day) return { ok: false, score: 0, evidence: [ev('weather_unavailable')] };
  const blockers: RecommendationEvidence[] = [];
  const support: RecommendationEvidence[] = [];
  let score = 1;

  switch (type) {
    case 'crop_protection': {
      const t = THRESHOLDS.spray;
      // The hourly windows cover the next 72 hours; later days fall back to the daily values.
      if (daysBetween(today, date) <= 2) {
        const windows = w.sprayWindows.filter((s) => s.start.slice(0, 10) === date);
        if (windows.length) {
          const best = windows.reduce((a, b) => (b.hours > a.hours ? b : a));
          support.push(ev('spray_window', { start: best.start, end: best.end, hours: best.hours }));
          score += Math.min(best.hours, 8) / 8;
        } else {
          blockers.push(ev('no_spray_window', { date }));
        }
      } else {
        if ((day.windMaxKmh ?? 0) > t.maxWindKmh || (day.gustMaxKmh ?? 0) > t.maxGustKmh) {
          blockers.push(ev('strong_wind', { date, windKmh: day.windMaxKmh, gustKmh: day.gustMaxKmh }));
        }
        if (rain(day) > t.maxRainMm || (day.precipitationProbabilityPct ?? 0) > t.maxRainProbabilityPct) {
          blockers.push(ev('rain_forecast', { date, mm: day.precipitationMm, probability: day.precipitationProbabilityPct }));
        }
        if (day.tempMaxC != null && (day.tempMaxC < t.minTempC || day.tempMaxC > t.maxTempC)) {
          blockers.push(ev('no_spray_window', { date }));
        }
      }
      break;
    }
    case 'fertilization': {
      const t = THRESHOLDS.fertilization;
      if (day.tempMaxC != null && day.tempMaxC <= 0) blockers.push(ev('frozen_ground', { date, tempMaxC: day.tempMaxC }));
      const heavy = [day, after[0]].find((d) => rain(d) >= t.heavyRainMm);
      if (heavy) blockers.push(ev('heavy_rain_forecast', { date: heavy.date, mm: heavy.precipitationMm }));
      else if (rain(day) > t.maxRainMm) blockers.push(ev('rain_forecast', { date, mm: day.precipitationMm, probability: day.precipitationProbabilityPct }));
      const wash = after.find((d) => rain(d) >= t.lightRainMinMm && rain(d) <= t.lightRainMaxMm);
      if (wash) {
        support.push(ev('light_rain_after', { date: wash.date, mm: wash.precipitationMm }));
        score += 0.5;
      }
      break;
    }
    case 'sowing':
    case 'tillage': {
      const t = THRESHOLDS.soil;
      const wet = before.reduce((s, d) => s + rain(d), 0) + rain(day);
      if (wet > t.maxRainBeforeMm) blockers.push(ev('rain_before', { days: before.length + 1, mm: round2(wet) }));
      else if (rain(day) > t.maxRainMm) blockers.push(ev('rain_forecast', { date, mm: day.precipitationMm, probability: day.precipitationProbabilityPct }));
      if (type === 'sowing' && day.tempMinC != null && day.tempMinC < -2) blockers.push(ev('frost_forecast', { date, tempMinC: day.tempMinC }));
      break;
    }
    case 'harvest': {
      const t = THRESHOLDS.harvest;
      if (rain(day) > t.maxRainMm || (day.precipitationProbabilityPct ?? 0) > t.maxRainProbabilityPct) {
        blockers.push(ev('rain_forecast', { date, mm: day.precipitationMm, probability: day.precipitationProbabilityPct }));
      } else if (rain(before.at(-1)) > t.maxRainDayBeforeMm) {
        blockers.push(ev('rain_before', { days: 1, mm: rain(before.at(-1)) }));
      }
      break;
    }
    case 'irrigation': {
      const coming = [day, ...after.slice(0, 2)].reduce((s, d) => s + rain(d), 0);
      if (coming >= THRESHOLDS.irrigation.rainNext3DaysMm) blockers.push(ev('rain_forecast', { date, mm: round2(coming), probability: null }));
      break;
    }
    default:
      break;
  }
  return { ok: blockers.length === 0, score, evidence: blockers.length ? blockers : support };
}

/** The best suitable day in [from, to] of the forecast, preferring early days and `prefer`. */
export function bestDay(type: OperationType, w: WeatherFacts, from: string, to: string, today: string, prefer?: string) {
  let best: { date: string; a: DayAssessment; value: number } | null = null;
  for (const d of w.daily) {
    if (d.date < from || d.date > to || d.date < today) continue;
    const a = assessDay(type, w, d.date, today);
    if (!a.ok) continue;
    const distance = Math.abs(daysBetween(prefer ?? today, d.date));
    const value = a.score - distance * 0.15;
    if (!best || value > best.value) best = { date: d.date, a, value };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const WEATHER_DEPENDENT: OperationType[] = ['crop_protection', 'fertilization', 'sowing', 'tillage', 'harvest', 'irrigation'];
const TIME_CRITICAL: OperationType[] = ['crop_protection', 'fertilization', 'sowing', 'harvest'];

/** Planned work against the forecast: go ahead, move to a better day, or catch up. */
export function timingRule(input: RuleInput): Decision[] {
  const { today } = input;
  const out: Decision[] = [];
  for (const op of input.operations) {
    if (!op.plannedOn || !op.fields.length) continue;
    const lead = daysBetween(today, op.plannedOn);
    if (lead < -THRESHOLDS.maxOverdueDays || lead > THRESHOLDS.lookaheadDays) continue;
    const w = input.weatherByFarm.get(op.farmId) ?? null;
    const weatherDependent = WEATHER_DEPENDENT.includes(op.type);
    const base = {
      kind: 'operation_timing' as const,
      operationType: op.type,
      farmId: op.farmId,
      fieldId: op.fields[0].fieldId,
      cropCycleId: op.fields[0].cropCycleId,
      operationId: op.id,
      zoneNos: null,
      windowTo: null,
    };
    const planned = ev('planned_on', { date: op.plannedOn });

    if (lead < 0) {
      const overdue = ev('overdue_days', { days: -lead });
      const priority: TaskPriority = TIME_CRITICAL.includes(op.type) || -lead > 7 ? 'high' : 'normal';
      if (!weatherDependent) {
        out.push({ ...base, key: `timing:${op.id}:catch_up`, action: 'catch_up', windowFrom: today, priority, confidence: 0.9, evidence: [planned, overdue] });
      } else if (!w) {
        out.push({ ...base, key: `timing:${op.id}:catch_up`, action: 'catch_up', windowFrom: null, priority, confidence: 0.5, evidence: [planned, overdue, ev('weather_unavailable')] });
      } else {
        const best = bestDay(op.type, w, today, addDays(today, 6), today);
        const blockers = best ? [] : assessDay(op.type, w, today, today).evidence;
        out.push({
          ...base,
          key: `timing:${op.id}:catch_up`,
          action: 'catch_up',
          windowFrom: best?.date ?? null,
          priority,
          confidence: best ? leadConfidence(daysBetween(today, best.date)) : 0.5,
          evidence: [planned, overdue, ...(best ? best.a.evidence : blockers)],
        });
      }
      continue;
    }

    if (!weatherDependent || !w) continue;
    const onPlan = assessDay(op.type, w, op.plannedOn, today);
    if (onPlan.ok) {
      if (lead > THRESHOLDS.confirmDays) continue;
      out.push({
        ...base,
        key: `timing:${op.id}:do_now`,
        action: 'do_now',
        windowFrom: op.plannedOn,
        priority: lead === 0 && TIME_CRITICAL.includes(op.type) ? 'high' : 'normal',
        confidence: leadConfidence(lead),
        evidence: [planned, ...onPlan.evidence, ev('forecast_lead_days', { days: lead })],
      });
      continue;
    }
    const best = bestDay(op.type, w, addDays(op.plannedOn, -3), addDays(op.plannedOn, 5), today, op.plannedOn);
    out.push({
      ...base,
      key: `timing:${op.id}:postpone`,
      action: 'postpone',
      windowFrom: best?.date ?? null,
      priority: lead <= THRESHOLDS.confirmDays ? 'high' : 'normal',
      confidence: round2(leadConfidence(lead) * (best ? 1 : 0.8)),
      evidence: [planned, ...onPlan.evidence, ...(best ? best.a.evidence : []), ev('forecast_lead_days', { days: lead })],
    });
  }
  return out;
}

/** Planned work that conflicts with the DüV closed periods or the PSM approval. */
export function complianceRule(input: RuleInput): Decision[] {
  const { today } = input;
  const out: Decision[] = [];
  for (const op of input.operations) {
    if (!op.plannedOn || !op.fields.length) continue;
    const lead = daysBetween(today, op.plannedOn);
    if (lead < -THRESHOLDS.maxOverdueDays || lead > 60) continue;
    const base = {
      kind: 'compliance' as const,
      action: 'review' as const,
      operationType: op.type,
      farmId: op.farmId,
      fieldId: op.fields[0].fieldId,
      cropCycleId: op.fields[0].cropCycleId,
      operationId: op.id,
      zoneNos: null,
      windowFrom: op.plannedOn,
      windowTo: null,
      priority: (lead <= 2 ? 'urgent' : 'high') as TaskPriority,
      confidence: 0.95,
    };
    if (op.closedPeriod) {
      const c = op.closedPeriod;
      out.push({ ...base, key: `closed:${op.id}`, evidence: [ev('planned_on', { date: op.plannedOn }), ev('closed_period', { date: c.date, from: c.from, to: c.to, rule: c.rule })] });
    }
    if (op.psmDeviations.length) {
      out.push({
        ...base,
        key: `psm:${op.id}`,
        evidence: [ev('planned_on', { date: op.plannedOn }), ...op.psmDeviations.map((f) => ev('psm_finding', { code: f.code, productName: f.productName, ...f.params }))],
      });
    }
  }
  return out;
}

/** Remaining N need of a growing crop without fertilization in the plan, and plans above the need. */
export function nitrogenRule(input: RuleInput): Decision[] {
  const { today } = input;
  const t = THRESHOLDS.nitrogen;
  const out: Decision[] = [];
  for (const c of input.cycles) {
    if (c.nRemainingKgHa == null || c.nNeedKgHa == null) continue;
    const base = {
      operationType: 'fertilization' as const,
      farmId: c.farmId,
      fieldId: c.fieldId,
      cropCycleId: c.id,
      operationId: null,
      zoneNos: null,
      windowTo: null,
    };
    const red = c.nitrateSensitiveZone ? [ev('nitrate_sensitive_zone')] : [];

    const plannedForCycle = input.operations.filter((o) => o.type === 'fertilization' && o.fields.some((f) => f.cropCycleId === c.id));
    if (c.nRemainingKgHa <= -t.exceedsKgHa && plannedForCycle.length) {
      const next = plannedForCycle.filter((o) => o.plannedOn).sort((a, b) => a.plannedOn!.localeCompare(b.plannedOn!))[0];
      out.push({
        ...base,
        key: `n_excess:${c.id}`,
        kind: 'compliance',
        action: 'review',
        operationId: next?.id ?? null,
        windowFrom: next?.plannedOn ?? null,
        priority: 'high',
        confidence: 0.85,
        evidence: [ev('n_exceeds_need', { kgHa: -c.nRemainingKgHa, needKgHa: c.nNeedKgHa }), ...red],
      });
      continue;
    }

    if (c.status !== 'active' || c.nRemainingKgHa < t.minRemainingKgHa) continue;
    if (!c.sowingDate || c.sowingDate > today) continue;
    if (c.expectedHarvestDate && daysBetween(today, c.expectedHarvestDate) < t.minDaysToHarvest) continue;
    // The general closed period for N on arable land; nothing to recommend while it runs.
    if (c.cropCategory !== 'grassland' && inClosedPeriod(today, closedPeriod('arable', null, c.nitrateSensitiveZone))) continue;
    const upcoming = plannedForCycle.some((o) => o.plannedOn && daysBetween(today, o.plannedOn) >= -7 && daysBetween(today, o.plannedOn) <= t.planAheadDays);
    if (upcoming) continue;

    const w = input.weatherByFarm.get(c.farmId) ?? null;
    const best = w ? bestDay('fertilization', w, today, addDays(today, 9), today) : null;
    const month = Number(today.slice(5, 7));
    out.push({
      ...base,
      key: `n:${c.id}`,
      kind: 'fertilization',
      action: 'plan_operation',
      windowFrom: best?.date ?? null,
      priority: c.nRemainingKgHa >= t.highRemainingKgHa && month >= 3 && month <= 5 ? 'high' : 'normal',
      confidence: best ? round2(0.75 * leadConfidence(daysBetween(today, best.date)) / 0.9) : 0.6,
      evidence: [ev('n_remaining', { kgHa: c.nRemainingKgHa, needKgHa: c.nNeedKgHa }), ...red, ...(best ? best.a.evidence : w ? [] : [ev('weather_unavailable')])],
    });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Satellite anomalies of a growing crop: a field walk, starting in the weak zones when known. */
export function scoutingRule(input: RuleInput): Decision[] {
  const { today } = input;
  const t = THRESHOLDS.ndvi;
  const out: Decision[] = [];
  const growing = input.cycles.filter((c) => c.status === 'active' && c.ndvi.length > 0);
  for (const c of growing) {
    const latest = c.ndvi.at(-1)!;
    if (daysBetween(latest.date, today) > t.maxAgeDays) continue;
    // Ripening and harvest lower NDVI on purpose.
    if (c.expectedHarvestDate && daysBetween(latest.date, c.expectedHarvestDate) < t.harvestQuietDays) continue;
    const evidence: RecommendationEvidence[] = [];
    let strength = 0;

    const prev = [...c.ndvi].reverse().find((o) => o.date < latest.date && daysBetween(o.date, latest.date) <= t.pairWithinDays);
    const settled = input.completed.some(
      (w) => w.fieldId === c.fieldId && (w.type === 'harvest' || w.type === 'tillage' || w.type === 'inspection') && w.date >= (prev?.date ?? latest.date),
    );
    if (settled) continue;
    if (prev && prev.mean >= t.minVegetated) {
      const change = latest.mean - prev.mean;
      if (change <= -t.minDrop) {
        evidence.push(ev('ndvi_drop', { from: prev.date, to: latest.date, before: round2(prev.mean), after: round2(latest.mean), change: round2(change) }));
        strength = Math.max(strength, change <= -t.strongDrop ? 2 : 1);
      }
    }

    const peers = growing
      .filter((p) => p.id !== c.id && p.cropName === c.cropName)
      .map((p) => p.ndvi.at(-1)!)
      .filter((o) => Math.abs(daysBetween(o.date, latest.date)) <= t.peersWithinDays);
    if (peers.length >= t.minPeers) {
      const m = median(peers.map((o) => o.mean));
      if (latest.mean <= m - t.belowPeers) {
        evidence.push(ev('ndvi_below_peers', { date: latest.date, value: round2(latest.mean), peersMedian: round2(m), peers: peers.length }));
        strength = Math.max(strength, 1);
      }
    }
    if (!strength) continue;

    let zoneNos: number[] | null = null;
    if (latest.p10 != null && latest.p90 != null && latest.p90 - latest.p10 >= t.heterogeneous) {
      evidence.push(ev('ndvi_heterogeneous', { date: latest.date, p10: round2(latest.p10), p90: round2(latest.p90) }));
      const zoning = input.zoningByField.get(c.fieldId);
      if (zoning?.zones.length) {
        const weak = zoning.zones.filter((z) => z.relativeProductivity < 95).map((z) => z.zoneNo);
        if (weak.length && weak.length < zoning.zones.length) {
          zoneNos = weak;
          evidence.push(ev('low_zones', { zoneNos: weak.join(', ') }));
        }
      }
    }
    out.push({
      key: `scout:${c.id}:${latest.date}`,
      kind: 'scouting',
      action: 'inspect',
      operationType: 'inspection',
      farmId: c.farmId,
      fieldId: c.fieldId,
      cropCycleId: c.id,
      operationId: null,
      zoneNos,
      windowFrom: today,
      windowTo: addDays(today, 3),
      priority: strength >= 2 ? 'high' : 'normal',
      confidence: strength >= 2 ? 0.75 : 0.6,
      evidence,
    });
  }
  return out;
}

/** Planned fertilization or sowing on a field with distinct productivity zones and no zone rates yet. */
export function variableRateRule(input: RuleInput): Decision[] {
  const { today } = input;
  const out: Decision[] = [];
  for (const op of input.operations) {
    if ((op.type !== 'fertilization' && op.type !== 'sowing') || !op.plannedOn || op.hasVraMap) continue;
    const lead = daysBetween(today, op.plannedOn);
    if (lead < 0 || lead > THRESHOLDS.vra.aheadDays) continue;
    for (const f of op.fields) {
      const zoning = input.zoningByField.get(f.fieldId);
      if (!zoning || zoning.zones.length < 3) continue;
      const rel = zoning.zones.map((z) => z.relativeProductivity);
      const min = Math.min(...rel);
      const max = Math.max(...rel);
      if (max - min < THRESHOLDS.vra.minSpreadPct) continue;
      out.push({
        key: `vra:${op.id}:${f.fieldId}`,
        kind: 'variable_rate',
        action: 'create_vra_map',
        operationType: op.type,
        farmId: op.farmId,
        fieldId: f.fieldId,
        cropCycleId: f.cropCycleId,
        operationId: op.id,
        zoneNos: zoning.zones.map((z) => z.zoneNo),
        windowFrom: op.plannedOn,
        windowTo: null,
        priority: lead <= 3 ? 'high' : 'normal',
        confidence: 0.75,
        evidence: [ev('planned_on', { date: op.plannedOn }), ev('productivity_zones', { zoneCount: zoning.zones.length, minPct: Math.round(min), maxPct: Math.round(max) })],
      });
    }
  }
  return out;
}

const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

/** All decisions of the rule set, most pressing first. */
export function decide(input: RuleInput): Decision[] {
  const all = [...complianceRule(input), ...timingRule(input), ...nitrogenRule(input), ...scoutingRule(input), ...variableRateRule(input)];
  const seen = new Set<string>();
  return all
    .filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)))
    .sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
        (a.windowFrom ?? '9999').localeCompare(b.windowFrom ?? '9999') ||
        b.confidence - a.confidence,
    );
}
