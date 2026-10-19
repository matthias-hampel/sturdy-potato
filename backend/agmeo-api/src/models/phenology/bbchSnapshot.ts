/**
 * Calibrated BBCH per crop cycle, ported from the reference's `actions/bbch.ts`
 * (runBbchModelForCultivation, buildBbchSnapshots, saveBbchCalibration): the ESM
 * phenology model runs from the booked sowing date to seven days past today; each
 * observed BBCH stage is an anchor in biological days that shifts the model from
 * there on (see {@link buildCalibrationCurve}).
 */
import type { SupportedCrops } from '../crops.js';
import { bbchToBd, bdToBbch, buildCalibrationCurve, calculateBbchModel, getCropGsParams, hasModelParams } from './bbchModel.js';

/** Days past today the model runs into the forecast (reference FORECAST_HORIZON_DAYS). */
export const BBCH_FORECAST_HORIZON_DAYS = 7;

type Weather = Record<string, { tempMin: number; tempMax: number; tempMean?: number; precipitation?: number }>;

export type BbchModelRun = {
  dates: string[];
  bbch: number[];
  cumulativeBd: number[];
  vernalization: number[];
  photoperiod: number[];
  tempMean: number[];
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The raw model from sowing to today + horizon; null without model parameters, sowing, or weather from sowing on. */
export function runBbchModel(input: { weather: Weather; crop: SupportedCrops | null; latitude: number; sowingDate: string | null; today: string }): BbchModelRun | null {
  const { weather, crop, sowingDate, today } = input;
  if (!hasModelParams(crop) || !sowingDate || sowingDate > today) return null;
  const all = Object.keys(weather).sort();
  const start = all.findIndex((d) => d >= sowingDate);
  if (start < 0) return null;
  const horizon = addDays(today, BBCH_FORECAST_HORIZON_DAYS);
  const dates: string[] = [];
  const daily: { tempMin: number; tempMax: number; tempMean: number; precipitation: number }[] = [];
  for (let i = start; i < all.length && all[i] <= horizon; i++) {
    const w = weather[all[i]];
    dates.push(all[i]);
    daily.push({ tempMin: w.tempMin, tempMax: w.tempMax, tempMean: w.tempMean ?? (w.tempMin + w.tempMax) / 2, precipitation: w.precipitation ?? 0 });
  }
  if (!daily.length) return null;
  const r = calculateBbchModel(daily, crop, input.latitude, sowingDate);
  if (!r) return null;
  return { dates, bbch: r.bbch, cumulativeBd: r.cumulativeBd, vernalization: r.vernalization, photoperiod: r.photoperiod, tempMean: daily.map((d) => d.tempMean) };
}

export type BbchCalibrationAnchor = { observedOn: string; observedBbch: number; bdOffset: number };

export type BbchSnapshot = {
  sowingDate: string;
  /** Calibrated BBCH today (else on the last modelled day). */
  currentBbch: number | null;
  /** Uncalibrated model BBCH on the last modelled day. */
  modelBbch: number | null;
  /** Offset in biological days applied today; null without calibrations. */
  bbchOffset: number | null;
  bbchByDate: Record<string, number>;
  modelBbchByDate: Record<string, number>;
};

/** Applies the calibration curve to a model run (calibrations newest first or in any order). */
export function calibrateBbch(run: BbchModelRun, crop: SupportedCrops, calibrations: BbchCalibrationAnchor[], today: string): BbchSnapshot {
  const gs = getCropGsParams(crop);
  const offsetAt = buildCalibrationCurve(calibrations, crop);
  const bbchByDate: Record<string, number> = {};
  const modelBbchByDate: Record<string, number> = {};
  run.dates.forEach((d, i) => {
    const bd = run.cumulativeBd[i];
    bbchByDate[d] = gs ? Math.round(bdToBbch(Math.max(0, bd + offsetAt(bd)), gs.gs, gs.isCanola)) : run.bbch[i];
    modelBbchByDate[d] = run.bbch[i];
  });
  const todayIdx = run.dates.indexOf(today);
  const refIdx = todayIdx >= 0 ? todayIdx : run.dates.length - 1;
  return {
    sowingDate: run.dates[0],
    currentBbch: bbchByDate[run.dates[refIdx]] ?? null,
    modelBbch: run.bbch[run.bbch.length - 1] ?? null,
    bbchOffset: calibrations.length ? offsetAt(run.cumulativeBd[refIdx]) : null,
    bbchByDate,
    modelBbchByDate,
  };
}

export type CalibrationError = 'UNSUPPORTED_CROP' | 'MODEL_UNAVAILABLE' | 'DATE_OUT_OF_RANGE';

/** The anchor an observation on `date` becomes: observed − model biological days on that day. */
export function calibrationAnchor(run: BbchModelRun | null, crop: SupportedCrops | null, date: string, observedBbch: number): { bdOffset: number; modelBbch: number } | CalibrationError {
  const gs = crop ? getCropGsParams(crop) : null;
  if (!gs) return 'UNSUPPORTED_CROP';
  if (!run) return 'MODEL_UNAVAILABLE';
  const i = run.dates.indexOf(date);
  if (i < 0) return 'DATE_OUT_OF_RANGE';
  return { bdOffset: bbchToBd(observedBbch, gs.gs, gs.isCanola) - run.cumulativeBd[i], modelBbch: run.bbch[i] };
}
