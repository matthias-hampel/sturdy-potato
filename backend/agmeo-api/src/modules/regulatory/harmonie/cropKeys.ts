/**
 * System crop code → agmeo crop key (the vocabulary of the ENNI / ENDO
 * Fruchtart catalogues in shared/fruchtartCodes.ts and endo/fruchtartCodesSh.ts).
 *
 * Every key below resolves in BOTH catalogues (checked by cropKeys.spec.ts).
 * A code without an entry has no Dube2.5 Fruchtart; the preflight then reports
 * it as a missing crop mapping so the farm supplies a `cropCodeOverrides` entry.
 *
 * Choices worth knowing:
 * - `spring_barley` → Braugerste (`springBarleyMalting`), the only spring barley
 *   the catalogues know.
 * - `cover_crop` → `intercropMixture` (Gründüngung ≤ 50 % Leguminosen), the
 *   generic intercrop key.
 * - `cc_legume_mix` → `vetchIntercrop` (Gründüngung > 50 % Leguminosen).
 * - `fallow` → `nonProductiveArea` (ENNI Sonstige Fläche, SH Dauerbrache).
 */

import type { AgmeoCropKey } from './types.js';

export const CROP_KEY_BY_CODE: Record<string, AgmeoCropKey> = {
  winter_wheat: 'winterWheat',
  spring_wheat: 'springWheatFodder',
  winter_barley: 'winterBarleyFodder',
  spring_barley: 'springBarleyMalting',
  winter_rye: 'winterRyeBaking',
  triticale: 'triticaleFodder',
  oats: 'springOatsFodder',
  winter_rapeseed: 'canola',
  sunflower: 'sunflower',
  grain_maize: 'grainMaize',
  silage_maize: 'silageMaize',
  sugar_beet: 'sugarBeet',
  potatoes: 'potatoTableLate',
  field_beans: 'broadBeans',
  peas: 'peasDry',
  soybeans: 'soybeanBeans',
  grassland: 'permanentGrasslandWiltedSilage',
  cover_crop: 'intercropMixture',
  fallow: 'nonProductiveArea',
  winter_spelt: 'spelt',
  winter_oats: 'winterOats',
  spring_rapeseed: 'springCanola',
  lupins: 'lupine',
  field_grass: 'fieldGrassWiltedSilage',
  clover_grass: 'cloverGrass',
  alfalfa: 'alfalfa',
  cc_mustard: 'mustardIntercrop',
  cc_phacelia: 'phaceliaIntercrop',
  cc_oil_radish: 'oilRadishIntercrop',
  cc_legume_mix: 'vetchIntercrop',
  cc_winter_rye: 'cerealRyeIntercrop',
};

/** agmeo crop key for a system crop code; null when the code has no mapping. */
export function cropKeyForCode(
  code: string | null | undefined,
): AgmeoCropKey | null {
  if (!code || !Object.hasOwn(CROP_KEY_BY_CODE, code)) return null;
  return CROP_KEY_BY_CODE[code];
}
