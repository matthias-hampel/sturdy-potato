/**
 * Soil-carbon simulation of a field under a crop rotation with the Thünen RothC model
 * (agmeo src/lib/co2nserve/thuenen/functions.ts and operationsConvertor.ts).
 *
 * The rotation is simulated over five shifted ten-year windows of observed weather (2011–2020 …
 * 2015–2024) and the monthly results are averaged into one ten-year series with min/max bands.
 * A rotation entry becomes one simulated year: crop, sowing and harvest month, yield, the N of the
 * entry's template fertilizers and the catch crop. The reference reads the same from its templates.
 */
import { randomUUID } from 'node:crypto';
import {
  type AveragedRothCResult,
  type CarbonSoilValues,
  isOrganicFertilizer,
  massKg,
  nutrientKgPerHa,
} from '@agmeo/contracts';
import { carbonCrop } from '../crops.js';
import { type CarbonInputLine, ORGANIC_CATEGORY } from '../emissions.js';
import {
  DEFAULT_CARBON_MODEL,
  getThuenenCodeForCrop,
  getThuenenCodeForOrganicCategory,
} from './codes.js';
import type {
  MineralFertilizer,
  OrganicFertilizer,
  RothCResultItem,
  ThuenenRunRRequest,
  ThuenenRunRResponseBatch,
  YearData,
} from './types.js';

export const SIMULATION_INTERVALS = [
  { start: 2011, end: 2020 },
  { start: 2012, end: 2021 },
  { start: 2013, end: 2022 },
  { start: 2014, end: 2023 },
  { start: 2015, end: 2024 },
];
export type SimulationInterval = (typeof SIMULATION_INTERVALS)[number];

/** Tillage depth the reference sends for every year, cm. */
const TILLAGE_CM = 20;

export interface RotationEntryForSimulation {
  position: number;
  cropCode: string;
  /** 'MM-DD' defaults of the crop. */
  sowingMd: string | null;
  harvestMd: string | null;
  /** t fresh mass per hectare. */
  yieldTHa: number;
  /** Fertilizers of the entry's template, per hectare. */
  fertilizers: CarbonInputLine[];
  catchCrop: {
    code: string;
    sowingMd: string | null;
    harvestMd: string | null;
  } | null;
}

const month = (md: string | null) => (md ? Number(md.slice(0, 2)) : null);

export class SimulationInputError extends Error {}

/** One rotation entry as a Thünen management year (the year is set by the caller). */
export function entryToYearData(entry: RotationEntryForSimulation): YearData {
  const crop = carbonCrop(entry.cropCode);
  if (!crop)
    throw new SimulationInputError(`No Thünen crop for ${entry.cropCode}`);
  let name: YearData['main_crop']['name'];
  try {
    name = getThuenenCodeForCrop(crop);
  } catch {
    throw new SimulationInputError(`No Thünen crop for ${entry.cropCode}`);
  }
  const mineral: MineralFertilizer[] = [];
  const organic: OrganicFertilizer[] = [];
  for (const line of entry.fertilizers) {
    const n =
      nutrientKgPerHa(line.product, line.ratePerHa, line.product.baseUnit).n ??
      0;
    if (isOrganicFertilizer(line.product.fertilizerType)) {
      const nRate = Math.floor(n);
      // The reference drops organic fertilizers without N.
      if (nRate === 0) continue;
      const { kg } = massKg(
        line.ratePerHa,
        line.product.baseUnit,
        line.product,
      );
      organic.push({
        name: getThuenenCodeForOrganicCategory(
          ORGANIC_CATEGORY[line.product.fertilizerType!] ?? 'unknown',
        ),
        fert_rate: kg != null ? Math.round(kg / 10) / 100 : line.ratePerHa,
        DM_content: line.product.dryMatterPct ?? null,
        N_content: nRate,
      });
    } else if (n > 0) {
      mineral.push({ name: line.product.name, N_rate: Math.floor(n) });
    }
  }
  let secondary: YearData['secondary_crop'] = null;
  const catchCrop = entry.catchCrop ? carbonCrop(entry.catchCrop.code) : null;
  if (entry.catchCrop && catchCrop) {
    try {
      secondary = {
        cover_crop: {
          name: getThuenenCodeForCrop(catchCrop),
          sowing_month: month(entry.catchCrop.sowingMd),
          kill_month: month(entry.catchCrop.harvestMd),
        },
        harvest_sec: null,
      };
    } catch {
      secondary = null;
    }
  }
  return {
    year: 0,
    main_crop: {
      name,
      sowing_month: month(entry.sowingMd),
      harvest_month: month(entry.harvestMd),
      harvest_main: true,
      // TRUE means the residues are harvested; agmeo rotations leave them on the field.
      harvest_residue_main: false,
      harvest_yield: entry.yieldTHa,
    },
    fertilizer: { mineral, organic },
    secondary_crop: secondary,
    tillage: TILLAGE_CM,
  };
}

/** The rotation laid over a window's years, starting with `startPosition`. */
export function buildYearDataForInterval(
  entries: RotationEntryForSimulation[],
  interval: SimulationInterval,
  startPosition = 0,
): YearData[] {
  if (!entries.length)
    throw new SimulationInputError('The rotation has no entries');
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const idx = Math.max(
    0,
    sorted.findIndex((e) => e.position === startPosition),
  );
  const ordered = [...sorted.slice(idx), ...sorted.slice(0, idx)];
  const years: YearData[] = [];
  for (let year = interval.start; year <= interval.end; year++) {
    const yd = entryToYearData(
      ordered[(year - interval.start) % ordered.length],
    );
    yd.year = year;
    years.push(yd);
  }
  return years;
}

export function createThuenenRequestBody({
  interval,
  lat,
  lon,
  fieldName,
  soil,
  years,
}: {
  interval: SimulationInterval;
  lat: number;
  lon: number;
  fieldName: string;
  soil: CarbonSoilValues;
  years: YearData[];
}): ThuenenRunRRequest {
  return {
    id: randomUUID(),
    name: `Simulation ${fieldName} ${interval.start}-${interval.end}`,
    is_active: true,
    carbon_model: DEFAULT_CARBON_MODEL,
    executed_by: 'agmeo',
    site: {
      site_name: `Simulation site ${fieldName}`,
      field_size: 10,
      start_year_v: interval.start,
      end_year_v: interval.end,
      location: `SRID=4326;POINT (${lon.toFixed(6)} ${lat.toFixed(6)})`,
      bd_fb: soil.bulkDensity,
      clay_content: soil.clayPct,
      soc_content: soil.socPct,
      sand_content: soil.sandPct,
      sample_depth: Math.round(soil.depthCm),
      skel: 0,
      CN: 10,
      waterlogging: false,
      hasOrganicFarming: false,
      field_name: fieldName,
    },
    management: { years },
  };
}

const EXPECTED_MONTHS = 120;

/**
 * Averages the runs by month position into one 120-month series starting at the earliest run
 * start, with min and max across runs.
 */
export function averageRothCResults(
  batch: ThuenenRunRResponseBatch,
): AveragedRothCResult[] {
  const runs = batch.results.filter((r) => r.results.length > 0);
  if (!runs.length) return [];
  const earliest = runs.reduce((min, run) => {
    const t = new Date(run.results[0].Time_ISO_8601).getTime();
    if (Number.isNaN(t))
      throw new Error(
        `Invalid Time_ISO_8601 value in RothC result: ${run.results[0].Time_ISO_8601}`,
      );
    return Math.min(min, t);
  }, Number.POSITIVE_INFINITY);
  const monthsPerRun = Math.min(...runs.map((r) => r.results.length));
  if (monthsPerRun < EXPECTED_MONTHS) {
    throw new Error(
      `Not enough monthly results to build a 10-year series. Expected at least ${EXPECTED_MONTHS}, got ${monthsPerRun}.`,
    );
  }
  const out: AveragedRothCResult[] = [];
  for (let m = 0; m < EXPECTED_MONTHS; m++) {
    const items: RothCResultItem[] = runs.map((r) => r.results[m]);
    const stock = items.map((i) => i.SOC_stock_Mg_C_ha_1);
    const content = items.map((i) => i.SOC_content_percent_C_ha_1);
    const date = new Date(earliest);
    date.setUTCMonth(date.getUTCMonth() + m);
    out.push({
      Time_ISO_8601: date.toISOString(),
      SOC_stock_Mg_C_ha_1: stock.reduce((a, b) => a + b, 0) / runs.length,
      SOC_content_percent_C_ha_1:
        content.reduce((a, b) => a + b, 0) / runs.length,
      monthIndex: m + 1,
      monthLabel: `month${m + 1}`,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      lower_SOC_stock_Mg_C_ha_1: Math.min(...stock),
      upper_SOC_stock_Mg_C_ha_1: Math.max(...stock),
      lower_SOC_content_percent_C_ha_1: Math.min(...content),
      upper_SOC_content_percent_C_ha_1: Math.max(...content),
    });
  }
  return out;
}
