/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/waterBalance.sensitivity.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import type { SupportedCrops } from '../crops.js';
import { calculateDailyBbchMap } from '../phenology/bbchModel.js';
import { buildCalendarBbchMap } from '../phenology/cropCalendar.js';
import {
  adjustKcForClimate,
  computeAWC,
  computeTEW,
  computeWaterBalance,
  dayOfYear,
  getCropHeight,
  getDepletionFraction,
  getREW,
  hargreavesET0,
  kcFromBbch,
  LUFA_HYDRAULIC_PARAMS,
  type WaterBalanceInput,
} from './waterBalance.js';

// Mid-latitude (52°N) seasonal climate. Monthly means interpolated daily;
// deterministic so two runs match.
const MONTHLY_TMIN_C = [-2, -1, 1, 4, 8, 12, 14, 13, 10, 6, 2, -1];
const MONTHLY_TMAX_C = [3, 5, 9, 14, 19, 22, 24, 23, 19, 13, 7, 4];
const MONTHLY_PRECIP_MM = [55, 40, 45, 40, 55, 70, 75, 70, 55, 50, 55, 60];
const MONTHLY_ET0_MM = [10, 20, 45, 75, 105, 120, 130, 115, 75, 35, 15, 10];

function monthDay(dateStr: string): {
  month: number;
  day: number;
  daysInMonth: number;
} {
  const d = new Date(dateStr + 'T00:00:00Z');
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(d.getUTCFullYear(), month + 1, 0),
  ).getUTCDate();
  return { month, day, daysInMonth };
}

function interpMonthly(values: number[], dateStr: string): number {
  const { month, day, daysInMonth } = monthDay(dateStr);
  const next = (month + 1) % 12;
  const t = (day - 1) / daysInMonth;
  return values[month] * (1 - t) + values[next] * t;
}

type Scenario = 'typical' | 'drySummer' | 'wetWinter';

function buildDailyWeather(
  startDate: string,
  endDate: string,
  scenario: Scenario,
): Array<{
  date: string;
  tempMin: number;
  tempMax: number;
  precipitation: number;
  et0: number;
}> {
  const start = new Date(startDate + 'T00:00:00Z').getTime();
  const end = new Date(endDate + 'T00:00:00Z').getTime();
  const days = Math.round((end - start) / 86400000);
  const out: ReturnType<typeof buildDailyWeather> = [];

  // Deterministic pseudo-random (mulberry32) so rain spikes are reproducible
  let seed = 0xc0ffee;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i <= days; i++) {
    const dateMs = start + i * 86400000;
    const date = new Date(dateMs).toISOString().slice(0, 10);
    const m = new Date(dateMs).getUTCMonth();

    let tmin = interpMonthly(MONTHLY_TMIN_C, date);
    let tmax = interpMonthly(MONTHLY_TMAX_C, date);
    let monthPrecip = interpMonthly(MONTHLY_PRECIP_MM, date);
    let monthEt0 = interpMonthly(MONTHLY_ET0_MM, date);

    if (scenario === 'drySummer' && m >= 4 && m <= 8) {
      monthPrecip *= 0.3;
      tmax += 3;
      tmin += 2;
      monthEt0 *= 1.25;
    }
    if (scenario === 'wetWinter' && (m <= 2 || m >= 9)) {
      monthPrecip *= 1.8;
    }

    const isWet = rand() < 0.3;
    const precipitation = isWet
      ? (monthPrecip / 30) * (1 / 0.3) * (0.5 + rand())
      : 0;

    const et0H = hargreavesET0(
      tmin,
      tmax,
      (tmin + tmax) / 2,
      52,
      dayOfYear(date),
    );
    const et0Cap = monthEt0 / 30;
    const et0 = Math.max(0, Math.min(et0H, et0Cap * 2));

    out.push({ date, tempMin: tmin, tempMax: tmax, precipitation, et0 });
  }
  return out;
}

type RunResult = {
  label: string;
  crop: SupportedCrops;
  soil: string;
  scenario: Scenario;
  endDeficit: number;
  closureErrorMm: number;
};

function runOne(opts: {
  crop: SupportedCrops;
  soil: keyof typeof LUFA_HYDRAULIC_PARAMS;
  scenario: Scenario;
  startDate: string;
  endDate: string;
  rootDepthM: number;
}): RunResult {
  const { crop, soil, scenario, startDate, endDate, rootDepthM } = opts;
  const hydra = LUFA_HYDRAULIC_PARAMS[soil];
  const { fc, pwp } = computeAWC(hydra.thetaFc, hydra.thetaPwp, rootDepthM);

  const weather = buildDailyWeather(startDate, endDate, scenario);
  const weatherRecord = Object.fromEntries(
    weather.map((w) => [
      w.date,
      {
        tempMin: w.tempMin,
        tempMax: w.tempMax,
        tempMean: (w.tempMin + w.tempMax) / 2,
        precipitation: w.precipitation,
      },
    ]),
  );

  // Mirror buildFieldWaterBalance's Kc source: phenology model when it covers
  // the crop, FAO-56 calendar curve otherwise (potato exercises the latter).
  // today = endDate so the whole season is "observed" in this offline sweep.
  const dates = weather.map((w) => w.date);
  const bbchMap =
    calculateDailyBbchMap(weatherRecord, crop, 52, startDate, endDate) ??
    buildCalendarBbchMap(dates, crop, startDate, endDate);
  const cropHeight = getCropHeight(crop);

  const inputs: WaterBalanceInput[] = weather.map((w) => {
    const bbch = bbchMap?.get(w.date);
    const baseKc = bbch !== undefined ? kcFromBbch(bbch, crop) : 0.6;
    // Synthetic weather lacks humidity/wind — feed FAO baselines so the
    // climate adjustment is a no-op in this offline sweep.
    const kc = adjustKcForClimate(baseKc, cropHeight, 2, 45);
    return {
      date: w.date,
      precipitation: w.precipitation,
      et0: w.et0,
      kc,
      irrigation: 0,
    };
  });

  const surface = {
    tew: computeTEW(hydra.thetaFc, hydra.thetaPwp),
    rew: getREW(soil),
  };
  const result = computeWaterBalance(
    { fc, pwp, p: getDepletionFraction(crop), surface },
    inputs,
  );

  const startSwc = fc * 0.9; // matches REFILL_TARGET internal default
  const endSwc =
    result.days.length > 0 ? result.days[result.days.length - 1].swc : startSwc;
  const totalDrainage = result.days.reduce((s, d) => s + d.drainage, 0);
  // Conservation: P + I − ETa − drainage = ΔSWC (end − start).
  const closureErrorMm = Math.abs(
    result.totalPrecipitation +
      result.totalIrrigated -
      result.totalEta -
      totalDrainage -
      (endSwc - startSwc),
  );

  return {
    label: `${crop}/${soil}/${scenario}`,
    crop,
    soil,
    scenario,
    endDeficit: result.currentDeficit,
    closureErrorMm,
  };
}

const CROPS: SupportedCrops[] = [
  'winterWheat',
  'silageMaize',
  'sugarBeet',
  'potatoTableLate',
];
const SOILS: Array<keyof typeof LUFA_HYDRAULIC_PARAMS> = ['S', 'sL', 'L', 'T'];
const SCENARIOS: Scenario[] = ['typical', 'drySummer', 'wetWinter'];

const SEASONS: Record<
  SupportedCrops,
  { start: string; end: string; rootDepth: number }
> = {
  winterWheat: { start: '2025-10-01', end: '2026-08-15', rootDepth: 0.6 },
  silageMaize: { start: '2026-04-25', end: '2026-09-30', rootDepth: 0.6 },
  sugarBeet: { start: '2026-04-15', end: '2026-10-15', rootDepth: 0.8 },
  potatoTableLate: { start: '2026-04-20', end: '2026-09-15', rootDepth: 0.4 },
} as Record<SupportedCrops, { start: string; end: string; rootDepth: number }>;

describe('water-balance sensitivity sweep', () => {
  const rows: RunResult[] = [];
  for (const crop of CROPS) {
    const s = SEASONS[crop];
    if (!s) continue;
    for (const soil of SOILS) {
      for (const scenario of SCENARIOS) {
        rows.push(
          runOne({
            crop,
            soil,
            scenario,
            startDate: s.start,
            endDate: s.end,
            rootDepthM: s.rootDepth,
          }),
        );
      }
    }
  }

  it.each(rows.map((r) => [r.label, r] as const))(
    'closes the water-bucket within 1 mm for %s',
    (_label, r) => {
      expect(r.closureErrorMm).toBeLessThanOrEqual(1);
    },
  );

  it('silage maize on sand under drySummer ends with a real deficit', () => {
    const r = rows.find(
      (x) =>
        x.crop === 'silageMaize' &&
        x.soil === 'S' &&
        x.scenario === 'drySummer',
    );
    expect(r).toBeDefined();
    expect(r!.endDeficit).toBeGreaterThanOrEqual(20);
  });
});
