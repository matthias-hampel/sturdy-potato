/**
 * Soil-class estimates of the agmeo N balance, ported from the reference's
 * lib/farmalyzer/nitrogen.ts (fieldNEstimates and its helpers): what the nitrogen page shows
 * as placeholder where neither the farmer nor the ESM gave a value.
 */
import type { SupportedCrops } from '../crops.js';
import { getDefaultNResidual } from './nitrogen.js';

export type NSoilClass = 'light' | 'medium' | 'heavy';

/** The reference's LUFA → soil class mapping (not the DüV's: sandy silt counts as medium here). */
const LUFA_TO_SOIL_CLASS: Record<string, NSoilClass> = {
  S: 'light',
  lS: 'light',
  sU: 'medium',
  ssL: 'medium',
  lU: 'medium',
  sL: 'medium',
  uL: 'medium',
  L: 'medium',
  utL: 'heavy',
  tL: 'heavy',
  T: 'heavy',
};
export const lufaToSoilClass = (lufa: string | null | undefined): NSoilClass => (lufa ? (LUFA_TO_SOIL_CLASS[lufa] ?? 'medium') : 'medium');

export const DEFAULT_HUMUS_PERCENT = 2.0;

const NMIN: Record<NSoilClass, number> = { light: 25, medium: 35, heavy: 45 };
const N_LOSS: Record<NSoilClass, number> = { light: 35, medium: 25, heavy: 15 };
const N_LEACHING: Record<NSoilClass, number> = { light: 25, medium: 13, heavy: 5 };
const N_DENITRIFICATION: Record<NSoilClass, number> = { light: 10, medium: 12, heavy: 10 };
const N_MINERALIZATION_BASE: Record<NSoilClass, number> = { light: 20, medium: 30, heavy: 40 };

export const estimateNmin = (c: NSoilClass) => NMIN[c];
export const estimateNLoss = (c: NSoilClass) => N_LOSS[c];
export const estimateNLeaching = (c: NSoilClass) => N_LEACHING[c];
export const estimateNDenitrification = (c: NSoilClass) => N_DENITRIFICATION[c];
export const estimateNMineralization = (c: NSoilClass, humusPercent: number) => Math.round(N_MINERALIZATION_BASE[c] * (humusPercent / 2));

/** Spring mineralisation by soil class and humus band. */
export function estimateNMinSpring(c: NSoilClass, humusPercent: number): number {
  const table = [
    { maxHumus: 1.5, light: 5, medium: 8, heavy: 10 },
    { maxHumus: 2.5, light: 10, medium: 12, heavy: 15 },
    { maxHumus: 4.0, light: 15, medium: 20, heavy: 25 },
    { maxHumus: 8.0, light: 25, medium: 30, heavy: 35 },
    { maxHumus: Infinity, light: 35, medium: 45, heavy: 50 },
  ];
  const row = table.find((r) => humusPercent <= r.maxHumus) ?? table[table.length - 1];
  return row[c];
}

export interface FieldNEstimates {
  nMin: number;
  nMinSpring: number;
  nLeaching: number;
  nResidual: number;
}

export function fieldNEstimates(soilType: string | null, humus: number | null, crop: SupportedCrops | null): FieldNEstimates {
  const c = lufaToSoilClass(soilType);
  const h = humus ?? DEFAULT_HUMUS_PERCENT;
  return { nMin: estimateNmin(c), nMinSpring: estimateNMinSpring(c, h), nLeaching: estimateNLeaching(c), nResidual: crop ? getDefaultNResidual(crop) : 0 };
}

/**
 * The agmeo N need (reference computeNDifference): crop demand from the yield curve, minus the
 * soil supply (Nmin, spring mineralisation and the DüV deductions for previous management),
 * plus losses (leaching and gaseous, target Nmin after harvest).
 */
export function nDifference(i: { nDemand: number; nMin: number; nMinSpring: number; deductions: number; nLeaching: number; nResidual: number }): number {
  return Math.round(i.nDemand - Math.round(i.nMin + i.nMinSpring + i.deductions) + i.nLeaching + i.nResidual);
}
