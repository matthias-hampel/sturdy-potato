/**
 * Ported from AGVOLUTION/agmeo src/lib/timeseries/types.ts — the disease-risk
 * part (ISIP crop/disease tables, the season window, and the per-day collapse
 * to one risk bar).
 *
 * The reference computes no disease model itself. Its disease crawler
 * (src/app/api/cron/disease-crawler, daily 06:00, Feb 15 – Jun 30 only)
 * enqueues one job per supported cultivation — {cultivationId, lat, lon (field
 * centroid), crop, simulationDate} — to an external crawler service, which
 * queries the ISIP disease models (isip.de) and stores per-day, per-disease
 * risk levels 0..3 on the cultivation's `disease` series ({@link
 * DiseaseTimeseries}). This module only reads that series.
 */

import type { SupportedCrops } from '../crops.js';

export type DiseaseRiskLevel = 0 | 1 | 2 | 3;

export type DiseaseDay = {
  brownRust?: DiseaseRiskLevel;
  dtr?: DiseaseRiskLevel;
  fusarium?: DiseaseRiskLevel;
  yellowRust?: DiseaseRiskLevel;
  powderyMildew?: DiseaseRiskLevel;
  netBlotch?: DiseaseRiskLevel;
  ramularia?: DiseaseRiskLevel;
  leafBlotch?: DiseaseRiskLevel;
  septoriaTritici?: DiseaseRiskLevel;
  leafRust?: DiseaseRiskLevel;
};

/** ISO date → per-disease risk levels, as delivered by the ISIP crawler. */
export type DiseaseTimeseries = Record<string, DiseaseDay>;

export type DiseaseKey = keyof DiseaseDay;

/** Crop names as expected by the ISIP API */
export type ISIPCrop =
  | 'winter wheat'
  | 'winter barley'
  | 'winter rye'
  | 'winter triticale'
  | 'summer barley';

/** Diseases available per crop in the ISIP disease models */
export const CROP_DISEASES: Record<ISIPCrop, DiseaseKey[]> = {
  'winter wheat': [
    'brownRust',
    'dtr',
    'yellowRust',
    'powderyMildew',
    'septoriaTritici',
  ],
  'winter triticale': [
    'brownRust',
    'yellowRust',
    'powderyMildew',
    'leafBlotch',
  ],
  'winter barley': [
    'powderyMildew',
    'netBlotch',
    'ramularia',
    'leafBlotch',
    'leafRust',
  ],
  'winter rye': ['brownRust', 'powderyMildew', 'leafBlotch'],
  'summer barley': [
    'powderyMildew',
    'netBlotch',
    'ramularia',
    'leafBlotch',
    'leafRust',
  ],
};

/** Map internal crop codes to ISIP crop names */
export const ISIP_SUPPORTED_CROPS: Partial<Record<SupportedCrops, ISIPCrop>> = {
  winterWheat: 'winter wheat',
  winterBarleyFodder: 'winter barley',
  winterRyeBaking: 'winter rye',
  ryeWholePlantSilage: 'winter rye',
  triticaleFodder: 'winter triticale',
  springBarleyMalting: 'summer barley',
};

export function getISIPCrop(cropCode: string): ISIPCrop | undefined {
  return Object.hasOwn(ISIP_SUPPORTED_CROPS, cropCode)
    ? ISIP_SUPPORTED_CROPS[cropCode as SupportedCrops]
    : undefined;
}

export type DiseaseRiskDay = { date: string; value: DiseaseRiskLevel };

/** Worst daily risk across the diseases the ISIP models cover for `cropCode`. */
export function collapseDiseaseRisk(
  disease: DiseaseTimeseries | null | undefined,
  cropCode: string | null | undefined,
): DiseaseRiskDay[] | null {
  const isipCrop = cropCode ? getISIPCrop(cropCode) : undefined;
  if (!disease || !isipCrop) return null;

  const dates = Object.keys(disease).toSorted((a, b) => a.localeCompare(b));
  if (dates.length === 0) return null;

  return dates.map((date) => ({
    date,
    value: CROP_DISEASES[isipCrop].reduce<DiseaseRiskLevel>(
      (worst, key) =>
        Math.max(worst, disease[date]?.[key] ?? 0) as DiseaseRiskLevel,
      0,
    ),
  }));
}

/**
 * Check if a date is within the ISIP simulation period (Feb 15 - June 30).
 */
export function isWithinDiseaseModelPeriod(date: Date): boolean {
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();

  // Feb 15 (month 1, day 15) to June 30 (month 5, day 30)
  if (month < 1 || month > 5) return false;
  if (month === 1 && day < 15) return false;

  return true;
}
