/**
 * Ported from AGVOLUTION/agmeo src/lib/b2b-maps/soil-classification.ts — KA5 texture classification, unchanged.
 */

/**
 * KA5 Bodenkundliche Kartieranleitung — Soil texture classification
 *
 * Classifies soil into ~30 texture classes based on clay, silt, and sand
 * percentages according to the German KA5 / AG Boden standard.
 */

import { KA5_TO_LUFA, type TSoilTypeKA5, type TSoilTypeLUFA } from './types.js';

export const KA5_CLASSES: Record<string, string> = {
  Ss: 'Reiner Sand',
  Su2: 'Schwach schluffiger Sand',
  Sl2: 'Schwach lehmiger Sand',
  Sl3: 'Mittel lehmiger Sand',
  Sl4: 'Stark lehmiger Sand',
  St2: 'Schwach toniger Sand',
  St3: 'Mittel toniger Sand',
  Su3: 'Mittel schluffiger Sand',
  Su4: 'Stark schluffiger Sand',
  Ls2: 'Schwach sandiger Lehm',
  Ls3: 'Mittel sandiger Lehm',
  Ls4: 'Stark sandiger Lehm',
  Lt2: 'Schwach toniger Lehm',
  Lt3: 'Mittel toniger Lehm',
  Lts: 'Sandig-toniger Lehm',
  Lu: 'Schluffiger Lehm',
  Uu: 'Reiner Schluff',
  Uls: 'Sandig-lehmiger Schluff',
  Us: 'Sandiger Schluff',
  Ut2: 'Schwach toniger Schluff',
  Ut3: 'Mittel toniger Schluff',
  Ut4: 'Stark toniger Schluff',
  Ts2: 'Schwach sandiger Ton',
  Ts3: 'Mittel sandiger Ton',
  Ts4: 'Stark sandiger Ton',
  Tl: 'Lehmiger Ton',
  Tu2: 'Schwach schluffiger Ton',
  Tu3: 'Mittel schluffiger Ton',
  Tu4: 'Stark schluffiger Ton',
  Tt: 'Reiner Ton',
};

/**
 * Classify soil texture according to KA5 (AG Boden).
 *
 * @param clay  Clay content in % (0–100)
 * @param silt  Silt content in % (0–100)
 * @param sand  Sand content in % (0–100)
 * @returns KA5 abbreviation (e.g. "Sl3", "Lu", "Tt") or null if inputs invalid
 */
export function classifyBodenart(
  clay: number,
  silt: number,
  sand: number,
): TSoilTypeKA5 | null {
  // Normalize to ensure sum ≈ 100
  const sum = clay + silt + sand;
  if (sum < 50 || sum > 150) return null;

  const c = (clay / sum) * 100;
  const si = (silt / sum) * 100;
  const sa = (sand / sum) * 100;

  // Ton group (T): clay >= 35%
  if (c >= 65) return 'Tt';
  if (c >= 45) {
    if (sa >= 25) return 'Ts4';
    if (si >= 40) return 'Tu4';
    return 'Tl';
  }
  if (c >= 35) {
    if (sa >= 40) return 'Ts3';
    if (si >= 50) return 'Tu3';
    if (sa >= 25) return 'Ts4';
    return 'Tl';
  }

  // Heavy clay-containing soils: clay 25–35%
  if (c >= 25) {
    if (sa >= 50) return 'Ts2';
    if (si >= 50) return 'Tu2';
    if (sa >= 25) return 'Lts';
    return 'Lt3';
  }

  // Medium clay: clay 17–25%
  if (c >= 17) {
    if (sa >= 65) return 'St3';
    if (sa >= 40) return 'Ls4';
    if (si >= 65) return 'Ut4';
    if (si >= 50) return 'Lt2';
    if (sa >= 25) return 'Ls3';
    return 'Lu';
  }

  // Light clay: clay 12–17%
  if (c >= 12) {
    if (sa >= 65) return 'St2';
    if (sa >= 50) return 'Sl4';
    if (si >= 65) return 'Ut3';
    if (si >= 50) return 'Lu';
    if (sa >= 40) return 'Ls2';
    return 'Ut2';
  }

  // Low clay: clay 8–12%
  if (c >= 8) {
    if (sa >= 65) return 'Sl3';
    if (si >= 65) return 'Ut2';
    if (sa >= 50) return 'Sl2';
    if (si >= 50) return 'Uls';
    return 'Uls';
  }

  // Very low clay: clay 5–8%
  if (c >= 5) {
    if (sa >= 75) return 'Su2';
    if (sa >= 50) return 'Sl2';
    if (si >= 80) return 'Uu';
    if (si >= 50) return 'Us';
    return 'Su3';
  }

  // Minimal clay: clay < 5%
  if (sa >= 82.5) return 'Ss';
  if (sa >= 65) return 'Su2';
  if (si >= 80) return 'Uu';
  if (sa >= 50) return 'Su3';
  if (sa >= 25) return 'Su4';
  return 'Us';
}

export const lufaFromTexture = (
  clay: number | null | undefined,
  silt: number | null | undefined,
  sand: number | null | undefined,
): TSoilTypeLUFA | null => {
  if (clay == null || silt == null || sand == null) return null;
  const ka5 = classifyBodenart(clay, silt, sand);
  return ka5 ? KA5_TO_LUFA[ka5] : null;
};
