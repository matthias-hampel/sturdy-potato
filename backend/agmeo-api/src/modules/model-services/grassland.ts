/**
 * grassland-api after the reference's lib/grassland (client.ts, types.ts, satellite.ts) and
 * app/api/[orgId]/predictions/grassland/route.ts.
 *
 * Contract: POST /grassland/predict {fields: [{id, geometry (GeoJSON, EPSG:4326), areaInHa?,
 * satellite?: [{date, ndmi, cloudCover?}]}], year?, lastHarvest?: ISO dates, targetDMC} →
 * {fields: [{id, timeseries: {keys, DMC, yieldFM_targetDMC, yieldFM, yieldDM, BBCH, GDD,
 * CumulatedBiologicalDays, DailyTemperatureUnit, LeafAreaIndex, nFK}, cutsUsed, …}],
 * serviceVersion?}. Synchronous; the service fetches weather and NDMI upstream as needed, so a
 * batch can take a while. Optional bearer token.
 */
import type { GrasslandFieldPrediction, GrasslandPredictions, GrasslandTimeseries, GrasslandToday } from '@agmeo/contracts';
import { config } from '../../config.js';
import { requestJson, type FetchLike } from './http.js';

export interface GrasslandOptions {
  url: string;
  token: string;
  timeoutMs: number;
}

export interface GrasslandPredictBody {
  fields: { id: string; geometry: unknown; areaInHa?: number; satellite?: { date: string; ndmi: number; cloudCover?: number }[] }[];
  year?: number;
  lastHarvest?: string[];
  targetDMC: number;
}

export interface GrasslandPredictResponse {
  fields: { id: string; timeseries: Partial<GrasslandTimeseries> }[];
  serviceVersion?: string;
}

export class GrasslandClient {
  constructor(
    private readonly opts: GrasslandOptions = config.models.grassland,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.opts.url;
  }

  /** Three attempts, 1 s and 2 s apart, for 5xx answers and network errors (as the reference). */
  predict(body: GrasslandPredictBody): Promise<GrasslandPredictResponse> {
    return requestJson<GrasslandPredictResponse>(
      'grassland',
      {
        url: `${this.opts.url}/grassland/predict`,
        method: 'POST',
        headers: this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {},
        body,
        timeoutMs: this.opts.timeoutMs,
        attempts: 3,
        retryDelaysMs: [1000, 2000],
      },
      this.fetchFn,
    );
  }
}

const SERIES = ['DMC', 'yieldFM', 'yieldDM', 'BBCH', 'GDD', 'CumulatedBiologicalDays', 'DailyTemperatureUnit', 'LeafAreaIndex', 'nFK'] as const;

/**
 * The reference route's shaping of the service's series: from the latest cut (or March 1 of the
 * year; today when that is later), fresh matter at the target DMC, today's values per hectare
 * and for the area, and the area-weighted totals of all fields.
 */
export function shapeGrasslandPredictions(input: {
  fields: { id: string; areaHa: number }[];
  series: Map<string, Partial<GrasslandTimeseries>>;
  year: number;
  today: string;
  lastHarvest: string[] | null;
  targetDMC: number;
  serviceVersion: string | null;
}): GrasslandPredictions {
  const { year, today, targetDMC } = input;
  const lastHarvest = input.lastHarvest?.length ? input.lastHarvest : null;
  let from = lastHarvest?.toSorted().at(-1) ?? `${year}-03-01`;
  if (from < `${year}-01-01`) from = `${year}-03-01`;
  if (today < from) from = today;

  const todayOf = (ts: Pick<GrasslandTimeseries, 'keys' | 'yieldFM_targetDMC' | 'yieldFM' | 'yieldDM'>, areaHa: number): GrasslandToday => {
    const i = ts.keys.indexOf(today);
    const at = (s: number[]) => (i >= 0 ? (s[i] ?? 0) : 0);
    return {
      date: today,
      lastHarvest,
      targetDMC,
      yieldFM_targetDMC: { perArea: at(ts.yieldFM_targetDMC), total: at(ts.yieldFM_targetDMC) * areaHa },
      yieldFM: { perArea: at(ts.yieldFM), total: at(ts.yieldFM) * areaHa },
      yieldDM: { perArea: at(ts.yieldDM), total: at(ts.yieldDM) * areaHa },
    };
  };

  const fields: GrasslandFieldPrediction[] = input.fields.map((f) => {
    const raw = input.series.get(f.id);
    const keys = Array.isArray(raw?.keys) ? raw.keys : [];
    const idx = keys.map((k, i) => ({ k, i })).filter(({ k }) => k >= from).map(({ i }) => i);
    const pick = (s: number[] | undefined) => idx.map((i) => (Array.isArray(s) && typeof s[i] === 'number' ? s[i] : 0));
    const timeseries = Object.fromEntries([['keys', idx.map((i) => keys[i])], ...SERIES.map((k) => [k, pick(raw?.[k])])]) as unknown as GrasslandTimeseries;
    timeseries.yieldFM_targetDMC = timeseries.yieldDM.map((v) => v / targetDMC);
    return { id: f.id, year, areaInHa: f.areaHa, today: todayOf(timeseries, f.areaHa), timeseries };
  });

  const areaHa = fields.reduce((s, f) => s + f.areaInHa, 0);
  const days = [...new Set(fields.flatMap((f) => f.timeseries.keys))].sort();
  const weighted = (key: 'yieldFM_targetDMC' | 'yieldFM' | 'yieldDM') =>
    days.map((d) => (areaHa > 0 ? fields.reduce((s, f) => s + (f.timeseries[key][f.timeseries.keys.indexOf(d)] ?? 0) * f.areaInHa, 0) / areaHa : 0));
  const totalSeries = { keys: days, yieldFM_targetDMC: weighted('yieldFM_targetDMC'), yieldFM: weighted('yieldFM'), yieldDM: weighted('yieldDM') };
  const sum = (key: 'yieldFM_targetDMC' | 'yieldFM' | 'yieldDM') => fields.reduce((s, f) => s + f.today[key].total, 0);
  const per = (v: number) => (areaHa > 0 ? v / areaHa : 0);
  return {
    configured: true,
    serviceVersion: input.serviceVersion,
    total: {
      year,
      areaInHa: areaHa,
      today: {
        date: today,
        lastHarvest,
        targetDMC,
        yieldFM_targetDMC: { total: sum('yieldFM_targetDMC'), perArea: per(sum('yieldFM_targetDMC')) },
        yieldFM: { total: sum('yieldFM'), perArea: per(sum('yieldFM')) },
        yieldDM: { total: sum('yieldDM'), perArea: per(sum('yieldDM')) },
      },
      timeseries: { ...totalSeries, DMC: totalSeries.yieldFM.map((fm, i) => (fm !== 0 ? totalSeries.yieldDM[i] / fm : 0)) },
    },
    fields,
  };
}
