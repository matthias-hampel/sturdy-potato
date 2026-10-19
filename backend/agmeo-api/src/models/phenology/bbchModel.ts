/**
 * Ported from AGVOLUTION/agmeo src/lib/phenology/bbchModel.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Phenology model ported from ESM (lvl0-models) Rust implementation.
 * Calculates BBCH growth stages using:
 * - Thermal time accumulation (GDD with crop-specific base temps)
 * - Vernalization (cold requirement for winter crops)
 * - Photoperiod response (day length sensitivity)
 * - Snow model (soil surface temperature under snow cover)
 *
 * Point-based calculation (single location, daily weather data).
 *
 * References:
 * - Boettcher U. et al., A phenological model of winter oilseed rape (BBCH scale)
 * - Habekotte B., A model of the phenological development of winter oilseed rape
 * - Soltani & Sinclair, Modeling Physiology of Crop Development, Growth and Yield
 * - Trnka et al. (2010), snowMAUS model, Agricultural and Forest Meteorology
 */

import { addDaysUtc, dayOfYearUtc } from '../dates.js';

import type { SupportedCrops } from '../crops.js';

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

type DailyWeather = {
  tempMin: number;
  tempMax: number;
  tempMean: number;
  precipitation: number;
};

export type PhenologyParams = {
  /** Base temperature for development (°C) */
  TBD: number;
  /** Optimal temperature for development (°C) */
  TP1D: number;
  /** Upper optimal temperature (°C) */
  TP2D: number;
  /** Ceiling temperature (°C) */
  TCD: number;
  /** Base temperature for vernalization (°C) */
  TBVER: number;
  /** Lower optimal for vernalization (°C) */
  TP1VER: number;
  /** Upper optimal for vernalization (°C) */
  TP2VER: number;
  /** Ceiling temperature for vernalization (°C) */
  TCVER: number;
  /** Vernalization saturation days */
  VDSAT: number;
  /** Vernalization sensitivity coefficient */
  vsen: number;
  /** Critical photoperiod (hours) */
  cpp: number;
  /** Photoperiod sensitivity coefficient */
  ppsen: number;
  /** Growth stage biological day thresholds */
  gs: GrowthStageParams;
};

export type GrowthStageParams = {
  /** Sowing to emergence (biological days) */
  bdSOWEMR: number;
  /** Emergence to first tiller */
  bdEMRTIL: number;
  /** First tiller to first node (stem elongation) */
  bdTILSEL: number;
  /** First node to booting */
  bdSELBOT: number;
  /** Booting to ear emergence */
  bdBOTEAR: number;
  /** Ear emergence to anthesis */
  bdEARANT: number;
  /** Anthesis to physiological maturity */
  bdANTPM: number;
  /** Physiological maturity to harvest maturity */
  bdPMHM: number;
};

type BbchModelResult = {
  /** Daily BBCH values (0-97) */
  bbch: number[];
  /** Daily cumulative biological days */
  cumulativeBd: number[];
  /** Daily cumulative vernalization (0 to VDSAT) */
  vernalization: number[];
  /** Daily photoperiod (hours) */
  photoperiod: number[];
  /** Daily GDD increment */
  dailyGdd: number[];
  /** Current BBCH (last day) */
  currentBbch: number;
};

// ──────────────────────────────────────────────────────
// Crop Parameters (from lvl0-models/rust/lib/src/conf.rs)
// ──────────────────────────────────────────────────────

export const CROP_PARAMS: Partial<Record<SupportedCrops, PhenologyParams>> = {
  winterWheat: {
    TBD: 0,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 4,
      bdEMRTIL: 2,
      bdTILSEL: 11,
      bdSELBOT: 12,
      bdBOTEAR: 14,
      bdEARANT: 3,
      bdANTPM: 60,
      bdPMHM: 8,
    },
  },
  canola: {
    TBD: 2,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.002,
    gs: {
      bdSOWEMR: 2,
      bdEMRTIL: 25,
      bdTILSEL: 15,
      bdSELBOT: 23,
      bdBOTEAR: 6,
      bdEARANT: 3,
      bdANTPM: 50,
      bdPMHM: 8,
    },
  },
  winterBarleyFodder: {
    TBD: 0,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 4,
      bdEMRTIL: 2,
      bdTILSEL: 11,
      bdSELBOT: 12,
      bdBOTEAR: 14,
      bdEARANT: 3,
      bdANTPM: 55,
      bdPMHM: 8,
    },
  },
  springBarleyMalting: {
    TBD: 0,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 2,
      bdEMRTIL: 15,
      bdTILSEL: 8.04,
      bdSELBOT: 7.7,
      bdBOTEAR: 4.3,
      bdEARANT: 30,
      bdANTPM: 45,
      bdPMHM: 8,
    },
  },
  silageMaize: {
    TBD: 6,
    TP1D: 26,
    TP2D: 30,
    TCD: 45,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 0,
    vsen: 0.00305,
    cpp: 12.5,
    ppsen: 0.01,
    gs: {
      bdSOWEMR: 1.8,
      bdEMRTIL: 15,
      bdTILSEL: 15,
      bdSELBOT: 20,
      bdBOTEAR: 10,
      bdEARANT: 5,
      bdANTPM: 50,
      bdPMHM: 6,
    },
  },
  grainMaize: {
    TBD: 6,
    TP1D: 26,
    TP2D: 30,
    TCD: 45,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 0,
    vsen: 0.00305,
    cpp: 12.5,
    ppsen: 0.01,
    gs: {
      bdSOWEMR: 1.8,
      bdEMRTIL: 15,
      bdTILSEL: 15,
      bdSELBOT: 20,
      bdBOTEAR: 10,
      bdEARANT: 5,
      bdANTPM: 50,
      bdPMHM: 6,
    },
  },
  winterRyeBaking: {
    TBD: 0,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 4,
      bdEMRTIL: 2,
      bdTILSEL: 11,
      bdSELBOT: 12,
      bdBOTEAR: 14,
      bdEARANT: 3,
      bdANTPM: 55,
      bdPMHM: 8,
    },
  },
  triticaleFodder: {
    TBD: 0,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 50,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 4,
      bdEMRTIL: 2,
      bdTILSEL: 11,
      bdSELBOT: 12,
      bdBOTEAR: 14,
      bdEARANT: 3,
      bdANTPM: 55,
      bdPMHM: 8,
    },
  },
  springOatsFodder: {
    TBD: 2,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 0,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 2,
      bdEMRTIL: 15,
      bdTILSEL: 8,
      bdSELBOT: 8,
      bdBOTEAR: 4,
      bdEARANT: 30,
      bdANTPM: 45,
      bdPMHM: 8,
    },
  },
  sugarBeet: {
    TBD: 2,
    TP1D: 25,
    TP2D: 28,
    TCD: 40,
    TBVER: -1,
    TP1VER: 0,
    TP2VER: 8,
    TCVER: 12,
    VDSAT: 0,
    vsen: 0.00305,
    cpp: 21,
    ppsen: 0.001,
    gs: {
      bdSOWEMR: 3,
      bdEMRTIL: 20,
      bdTILSEL: 20,
      bdSELBOT: 20,
      bdBOTEAR: 10,
      bdEARANT: 5,
      bdANTPM: 60,
      bdPMHM: 10,
    },
  },
};

// ──────────────────────────────────────────────────────
// Snow Model (snowMAUS, Trnka et al. 2010)
// ──────────────────────────────────────────────────────

const SNOW_DEFAULTS = {
  tMinAccu1: 0, // All precip is rain above this
  tMinAccu2: -6, // All precip is snow below this
  tMinCrit: -12, // No melting below this
  tMaxCrit: 5, // Melting possible above this
  meltingRate: 0.12, // mm water / °C / day
  sublimThreshold: 20,
  sublim: 1,
  thresholdSnow: 3, // mm snow water equiv for insulation
  thresholdTMin: -2,
};

type SnowState = { snow: number; tMean: number; snowHeight: number };

function snowStep(day: DailyWeather, prevSnow: number): SnowState {
  const {
    tMinAccu1,
    tMinAccu2,
    tMinCrit,
    tMaxCrit,
    meltingRate,
    sublimThreshold,
    sublim,
    thresholdSnow,
    thresholdTMin,
  } = SNOW_DEFAULTS;

  // Snow accumulation
  let snowAccu = 0;
  if (day.tempMin <= tMinAccu2) {
    snowAccu = day.precipitation;
  } else if (day.tempMin < tMinAccu1) {
    const range = Math.abs(tMinAccu1 - tMinAccu2);
    snowAccu = (1 - (day.tempMin - tMinAccu2) / range) * day.precipitation;
  }

  // Snow melt
  let snowMelt = 0;
  if (day.tempMin >= tMinCrit && day.tempMax >= tMaxCrit) {
    const potMelt = (day.tempMin + Math.abs(tMinCrit)) * meltingRate;
    snowMelt = Math.min(potMelt, prevSnow);
  }

  // Snow cover
  let snow = prevSnow + snowAccu - snowMelt;
  if (prevSnow > sublimThreshold) snow -= sublim;
  snow = Math.max(0, snow);

  // Soil surface temperature (insulation by snow)
  let tMean: number;
  if (snow >= thresholdSnow && day.tempMin < thresholdTMin) {
    tMean = Math.max(0, day.tempMean);
  } else {
    tMean = day.tempMean;
  }

  return { snow, tMean, snowHeight: snow };
}

/** Soil surface (crown) temperature from air temps and snow depth (Sinclair method) */
function calcSoilSurfaceTemp(
  tMax: number,
  tMin: number,
  snowHeight: number,
): number {
  const snowFactor = Math.min(snowHeight * 0.01, 0.15);
  const tSurfMin = 2 + tMax * (0.4 + 18 * (snowFactor - 0.15) ** 2);
  const tSurfMax = 2 + tMin * (0.4 + 18 * (snowFactor - 0.15) ** 2);
  return (tSurfMin + tSurfMax) / 2;
}

// ──────────────────────────────────────────────────────
// Photoperiod (Soltani & Sinclair, p78, Box 7.2)
// ──────────────────────────────────────────────────────

/** Calculate day length in hours from day of year and latitude */
function calcPhotoperiod(doy: number, lat: number): number {
  const SABH = 6.0;
  const RDN = Math.PI / 180;
  const ALPHA = 90 + SABH;
  const SMA3 = 0.9856 * doy - 3.251;
  const LANDA =
    SMA3 +
    1.916 * Math.sin(SMA3 * RDN) +
    0.02 * Math.sin(2 * SMA3 * RDN) +
    282.565;
  const decSin = 0.39779 * Math.sin(LANDA * RDN);
  const DEC = Math.atan(decSin / Math.sqrt(1 - decSin ** 2)) / RDN;
  const TALSOC = 1 / Math.cos(lat * RDN);
  const CEDSOC = 1 / Math.cos(DEC * RDN);
  const SOCRA =
    Math.cos(ALPHA * RDN) * TALSOC * CEDSOC -
    Math.tan(lat * RDN) * Math.tan(DEC * RDN);
  const clamped = Math.max(-1, Math.min(1, SOCRA));
  const pp = Math.PI / 2 - Math.atan(clamped / Math.sqrt(1 - clamped ** 2));
  return (2 / 15) * (pp / RDN);
}

// ──────────────────────────────────────────────────────
// Vernalization
// ──────────────────────────────────────────────────────

/** Daily vernalization rate (piecewise linear, Habekotte 1997) */
function calcVernalizationRate(
  surfaceTemp: number,
  TBVER: number,
  TP1VER: number,
  TP2VER: number,
  TCVER: number,
): number {
  if (surfaceTemp <= TBVER) return 0;
  if (surfaceTemp <= TP1VER) return (surfaceTemp - TBVER) / (TP1VER - TBVER);
  if (surfaceTemp <= TP2VER) return 1;
  if (surfaceTemp <= TCVER)
    return 1 - (surfaceTemp - TP2VER) / (TCVER - TP2VER);
  return 0;
}

// ──────────────────────────────────────────────────────
// Development Rate (thermal time with temp response)
// ──────────────────────────────────────────────────────

/** Beta function temperature response for development rate */
function calcDevRate(
  temp: number,
  TBD: number,
  TP1D: number,
  TP2D: number,
  TCD: number,
): number {
  if (temp <= TBD || temp >= TCD) return 0;
  if (temp <= TP1D) return (temp - TBD) / (TP1D - TBD);
  if (temp <= TP2D) return 1;
  return (TCD - temp) / (TCD - TP2D);
}

// ──────────────────────────────────────────────────────
// BBCH from biological days (ESM GrowthStage.to_bbch)
// ──────────────────────────────────────────────────────

/** Inverse: BBCH → biological days (for farmer calibration) */
export function bbchToBd(
  bbch: number,
  gs: GrowthStageParams,
  isCanola: boolean,
): number {
  const map = (
    x: number,
    outMin: number,
    outMax: number,
    inMin: number,
    inMax: number,
  ) => ((x - outMin) * (inMax - inMin)) / (outMax - outMin) + inMin;

  const emr = gs.bdSOWEMR;
  const til = emr + gs.bdEMRTIL;
  const sel = til + gs.bdTILSEL;
  const bot = sel + gs.bdSELBOT;
  const ear = bot + gs.bdBOTEAR;
  const ant = ear + gs.bdEARANT;
  const pm = ant + gs.bdANTPM;
  const hm = pm + gs.bdPMHM;

  if (bbch <= 9) return map(bbch, 0, 9, 0, emr);
  if (bbch <= 20) return map(bbch, 10, 20, emr, til);
  if (bbch <= 30) return map(bbch, 20, 30, til, sel);
  if (isCanola) {
    // Canola skips BBCH 40-49: 30→49 maps sel→bot, 50→60 maps bot→ear
    if (bbch <= 49) return map(bbch, 30, 49, sel, bot);
    if (bbch <= 60) return map(bbch, 50, 60, bot, ear);
  } else {
    if (bbch <= 40) return map(bbch, 30, 40, sel, bot);
    if (bbch <= 60) return map(bbch, 40, 60, bot, ear);
  }
  if (bbch <= 70) return map(bbch, 60, 70, ear, ant);
  if (bbch <= 90) return map(bbch, 70, 90, ant, pm);
  if (bbch <= 97) return map(bbch, 90, 97, pm, hm);
  return hm;
}

export function bdToBbch(
  cbd: number,
  gs: GrowthStageParams,
  isCanola: boolean,
): number {
  const map = (
    x: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
  ) => ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;

  // Cumulative thresholds
  const emr = gs.bdSOWEMR;
  const til = emr + gs.bdEMRTIL;
  const sel = til + gs.bdTILSEL;
  const bot = sel + gs.bdSELBOT;
  const ear = bot + gs.bdBOTEAR;
  const ant = ear + gs.bdEARANT;
  const pm = ant + gs.bdANTPM;
  const hm = pm + gs.bdPMHM;

  if (cbd <= emr) return map(cbd, 0, emr, 0, 9);
  if (cbd <= til) return map(cbd, emr, til, 10, 20);
  if (cbd <= sel) return map(cbd, til, sel, 20, 30);
  if (cbd <= bot) return map(cbd, sel, bot, 30, 40);
  if (cbd <= ear)
    return isCanola ? map(cbd, bot, ear, 50, 60) : map(cbd, bot, ear, 40, 60);
  if (cbd <= ant) return map(cbd, ear, ant, 60, 70);
  if (cbd <= pm) return map(cbd, ant, pm, 70, 90);
  if (cbd <= hm) return map(cbd, pm, hm, 90, 97);
  return 97;
}

// ──────────────────────────────────────────────────────
// Main Model Function
// ──────────────────────────────────────────────────────

/**
 * Calculate daily BBCH progression using ESM phenology model.
 *
 * @param weather - Daily weather data array (from sowing date onwards)
 * @param crop - Crop type
 * @param latitude - Field latitude in degrees (for photoperiod)
 * @param sowingDate - Sowing date as `YYYY-MM-DD`; the day-of-year the
 *   photoperiod term needs is derived from it per simulated day, so the season
 *   stays aligned across new year and leap day
 * @returns Daily BBCH values and intermediate model state
 */
export function calculateBbchModel(
  weather: DailyWeather[],
  crop: SupportedCrops,
  latitude: number,
  sowingDate: string,
): BbchModelResult | null {
  const params = CROP_PARAMS[crop];
  if (!params || weather.length === 0) return null;

  const {
    TBD,
    TP1D,
    TP2D,
    TCD,
    TBVER,
    TP1VER,
    TP2VER,
    TCVER,
    VDSAT,
    vsen,
    cpp,
    ppsen,
    gs,
  } = params;
  const isCanola = crop === 'canola';
  const n = weather.length;

  const bbch = new Array<number>(n).fill(0);
  const cumulativeBd = new Array<number>(n).fill(0);
  const vernalization = new Array<number>(n).fill(0);
  const photoperiodArr = new Array<number>(n).fill(0);
  const dailyGdd = new Array<number>(n).fill(0);

  let snow = 0;
  let cumVern = 0;
  let cumBd = 0;

  for (let day = 0; day < n; day++) {
    // Real calendar day-of-year. The previous `% 365` wrap drifted by a day
    // for the rest of any season that ran past a February 29th.
    const doy = dayOfYearUtc(addDaysUtc(sowingDate, day));
    const w = weather[day];

    // Snow model → soil surface temperature
    const snowState = snowStep(w, snow);
    snow = snowState.snow;
    const surfaceTemp = calcSoilSurfaceTemp(
      w.tempMax,
      w.tempMin,
      snowState.snowHeight,
    );

    // Photoperiod
    const pp = calcPhotoperiod(doy, latitude);
    photoperiodArr[day] = pp;

    // Photoperiod factor (long-day crops: pp < cpp reduces development)
    let ppFactor = 1;
    if (pp < cpp) {
      ppFactor = Math.max(0, 1 - ppsen * (cpp - pp));
    }

    // Vernalization rate and accumulation
    const vernRate = calcVernalizationRate(
      surfaceTemp,
      TBVER,
      TP1VER,
      TP2VER,
      TCVER,
    );
    if (cumBd > gs.bdSOWEMR && VDSAT > 0) {
      cumVern = Math.min(cumVern + vernRate, VDSAT);
    }
    vernalization[day] = cumVern;

    // Vernalization factor (0-1)
    let vernFactor = 1;
    if (VDSAT > 0 && cumBd > gs.bdSOWEMR) {
      vernFactor = Math.max(0, Math.min(1, 1 - vsen * (VDSAT - cumVern)));
    }

    // Development rate (temperature response)
    const devRate = calcDevRate(snowState.tMean, TBD, TP1D, TP2D, TCD);
    dailyGdd[day] = Math.max(0, snowState.tMean - TBD);

    // Biological day increment: devRate × vernalization × photoperiod
    // Pre-emergence: no vernalization/photoperiod effect
    const bdIncrement =
      cumBd < gs.bdSOWEMR ? devRate : devRate * vernFactor * ppFactor;

    cumBd += bdIncrement;
    cumulativeBd[day] = cumBd;

    // BBCH from biological days
    bbch[day] = Math.round(bdToBbch(cumBd, gs, isCanola));
  }

  return {
    bbch,
    cumulativeBd,
    vernalization,
    photoperiod: photoperiodArr,
    dailyGdd,
    currentBbch: bbch[n - 1],
  };
}

/** Check if a crop has ESM phenology parameters */
export function hasModelParams(
  crop: SupportedCrops | null,
): crop is SupportedCrops {
  return crop != null && crop in CROP_PARAMS;
}

/**
 * Convenience wrapper around calculateBbchModel: takes a date-keyed
 * weather record (the shape stored in CultivationTimeseries.weather)
 * and returns a Map<dateISO, bbch>. Stops at "today" so we never
 * project BBCH past observed weather.
 *
 * Used by the irrigation page to drive Kc(BBCH) per day.
 */
export function calculateDailyBbchMap(
  weather: Record<
    string,
    {
      tempMin: number;
      tempMax: number;
      tempMean?: number;
      precipitation?: number;
    }
  >,
  crop: SupportedCrops,
  latitude: number,
  sowingDate: string,
  todayOverride?: string,
): Map<string, number> | null {
  if (!CROP_PARAMS[crop]) return null;
  const dates = Object.keys(weather).sort();
  if (dates.length === 0) return null;

  const startIdx = dates.findIndex((d) => d >= sowingDate);
  if (startIdx === -1) return null;

  const today = todayOverride ?? new Date().toISOString().slice(0, 10);
  const usedDates: string[] = [];
  const dailyWeather: DailyWeather[] = [];
  for (let i = startIdx; i < dates.length; i++) {
    if (dates[i] > today) break;
    usedDates.push(dates[i]);
    const d = weather[dates[i]];
    dailyWeather.push({
      tempMin: d.tempMin,
      tempMax: d.tempMax,
      tempMean: d.tempMean ?? (d.tempMin + d.tempMax) / 2,
      precipitation: d.precipitation ?? 0,
    });
  }

  const result = calculateBbchModel(dailyWeather, crop, latitude, sowingDate);
  if (!result) return null;

  const map = new Map<string, number>();
  usedDates.forEach((d, i) => map.set(d, result.bbch[i]));
  return map;
}

/** Get crop growth stage params for calibration calculations */
export function getCropGsParams(
  crop: SupportedCrops,
): { gs: GrowthStageParams; isCanola: boolean } | null {
  const params = CROP_PARAMS[crop];
  if (!params) return null;
  return { gs: params.gs, isCanola: crop === 'canola' };
}

/**
 * Build a piecewise-linear offset curve from a list of calibration
 * observations. Each anchor sits at (modelBd_at_save, bdOffset) — the
 * model bd at save time is recovered as bbchToBd(observedBbch) - bdOffset
 * so we don't need to keep modelBdAtOverride separately on the row.
 *
 * A virtual anchor at (modelBd = 0, offset = 0) is prepended so the offset
 * ramps in from zero at sowing — drift is unknown in the very early stage,
 * so we tie the curve to a definitionally-true point (BBCH 0 at sowing)
 * rather than flat-extrapolating the first user observation backward.
 *
 * Returns a function offsetAt(bd) that interpolates linearly between
 * adjacent anchors and flat-extrapolates after the last anchor (we don't
 * know how drift evolves past the most recent observation, so "constant
 * since last" is the best guess).
 */
export function buildCalibrationCurve(
  calibrations: Array<{ observedBbch: number; bdOffset: number }>,
  crop: SupportedCrops,
): (bd: number) => number {
  const gsParams = getCropGsParams(crop);
  if (!gsParams || calibrations.length === 0) return () => 0;
  const observed = calibrations
    .map((c) => ({
      modelBd:
        bbchToBd(c.observedBbch, gsParams.gs, gsParams.isCanola) - c.bdOffset,
      offset: c.bdOffset,
    }))
    .filter((a) => a.modelBd > 0)
    .sort((a, b) => a.modelBd - b.modelBd);
  const anchors = [{ modelBd: 0, offset: 0 }, ...observed];
  return (bd: number): number => {
    if (bd <= 0) return 0;
    if (bd >= anchors[anchors.length - 1].modelBd) {
      return anchors[anchors.length - 1].offset;
    }
    for (let j = 0; j < anchors.length - 1; j++) {
      const a = anchors[j];
      const b = anchors[j + 1];
      if (bd >= a.modelBd && bd <= b.modelBd) {
        const span = b.modelBd - a.modelBd;
        if (span <= 0) return a.offset;
        const t = (bd - a.modelBd) / span;
        return a.offset + t * (b.offset - a.offset);
      }
    }
    return 0;
  };
}
