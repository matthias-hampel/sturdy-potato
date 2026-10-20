/**
 * Ported from AGVOLUTION/agmeo-crawlers src/lib/isip-client.ts and src/lib/timeseries-types.ts:
 * the ISIP response of the cereal disease model (`/models/siggetreide`), its parsing into
 * per-day, per-disease risk levels 0..3, and the per-crop simulation window.
 */

import { CROP_DISEASES, type DiseaseDay, type DiseaseKey, type DiseaseRiskLevel, type ISIPCrop } from './diseaseRisk.js';

/** ISIP variable names → disease keys. */
export const ISIP_DISEASE_MAPPING: Record<string, DiseaseKey> = {
  'brown rust': 'brownRust',
  dtr: 'dtr',
  fusarium: 'fusarium',
  'yellow rust': 'yellowRust',
  'powdery mildew': 'powderyMildew',
  'net blotch': 'netBlotch',
  ramularia: 'ramularia',
  'leaf blotch': 'leafBlotch',
  'septoria tritici': 'septoriaTritici',
  'leaf rust': 'leafRust',
};

export type ISIPVariable = {
  attributes?: { description?: string; id?: string; path?: string; level?: number; legend?: string; link?: string | null };
  type?: 'date' | 'double' | 'int';
  shape?: string[];
  data?: (number | string)[];
};

export type ISIPResponse = {
  attributes?: Record<string, unknown>;
  nodes: { result: { attributes?: Record<string, unknown>; dimensions?: Record<string, number>; variables: Record<string, ISIPVariable> } };
};

/**
 * Per ISIP: the simulation runs Feb 15 – Jun 30, but the start differs by crop (winter barley
 * Feb 15; winter wheat, rye and triticale Mar 1; spring barley Apr 20).
 */
const SEASON_START: Record<ISIPCrop, { month: number; day: number }> = {
  'winter barley': { month: 2, day: 15 },
  'winter wheat': { month: 3, day: 1 },
  'winter rye': { month: 3, day: 1 },
  'winter triticale': { month: 3, day: 1 },
  'summer barley': { month: 4, day: 20 },
};
const SEASON_END = { month: 6, day: 30 };

/** Whether ISIP simulates `crop` on the ISO date `date` (YYYY-MM-DD). */
export function isWithinIsipSeason(date: string, crop: ISIPCrop): boolean {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const start = SEASON_START[crop];
  if (m < start.month || (m === start.month && d < start.day)) return false;
  if (m > SEASON_END.month || (m === SEASON_END.month && d > SEASON_END.day)) return false;
  return true;
}

/** Per-day risk levels (clamped to 0..3) of the diseases ISIP models for the crop. */
export function parseISIPResponse(response: ISIPResponse, crop: ISIPCrop): Map<string, DiseaseDay> {
  const result = new Map<string, DiseaseDay>();
  const variables = response?.nodes?.result?.variables;
  if (!variables) return result;
  const applicable = new Set<DiseaseKey>(CROP_DISEASES[crop]);
  const dates = variables.date?.data as string[] | undefined;
  if (!dates?.length) return result;

  for (let i = 0; i < dates.length; i++) {
    const day: DiseaseDay = {};
    for (const [isipKey, key] of Object.entries(ISIP_DISEASE_MAPPING)) {
      if (!applicable.has(key)) continue;
      const value = variables[isipKey]?.data?.[i];
      if (typeof value === 'number' && Number.isFinite(value)) day[key] = Math.min(3, Math.max(0, Math.round(value))) as DiseaseRiskLevel;
    }
    if (Object.keys(day).length > 0) result.set(String(dates[i]).slice(0, 10), day);
  }
  return result;
}
