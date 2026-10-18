/**
 * Soil-analysis conversions for the ENNI/ENDO `bodenuntersuchung`.
 */

import type { HumusklasseType } from '../types.js';

/** Oxide → element mass factors (VDLUFA). */
const P2O5_TO_P = 0.4364;
const K2O_TO_K = 0.8301;
const MGO_TO_MG = 0.603;

export function p2o5ToP(p2o5: number): number {
  return p2o5 * P2O5_TO_P;
}

export function k2oToK(k2o: number): number {
  return k2o * K2O_TO_K;
}

export function mgoToMg(mgo: number): number {
  return mgo * MGO_TO_MG;
}

/**
 * Humus class per DüV Anlage 4 (Humusgehalt in % of the topsoil). The Dube2.5
 * enum has no "humos" class: everything below 4 % counts as HUMUSARM.
 */
export function humusklasseFromPercent(humusPercent: number): HumusklasseType {
  if (humusPercent < 4) return 'HUMUSARM';
  if (humusPercent < 8) return 'STARK_HUMOS';
  if (humusPercent < 15) return 'SEHR_STARK_HUMOS';
  if (humusPercent < 30) return 'ANMOORIG';
  return 'NIEDERMOOR';
}

/** LUFA soil-type groups (Bodenartengruppen) as free text — the XSD element is an unrestricted string. */
const LUFA_BODENARTGRUPPE: Record<string, string> = {
  S: 'Sand',
  lS: 'schwach lehmiger Sand',
  sU: 'sandiger Schluff',
  ssL: 'stark sandiger Lehm',
  lU: 'lehmiger Schluff',
  sL: 'sandiger Lehm',
  uL: 'schluffiger Lehm',
  L: 'Lehm',
  utL: 'schluffig-toniger Lehm',
  tL: 'toniger Lehm',
  T: 'Ton',
};

export function bodenartgruppeFromLufa(
  soilTypeLufa: string | null,
): string | null {
  if (!soilTypeLufa) return null;
  return LUFA_BODENARTGRUPPE[soilTypeLufa] ?? soilTypeLufa;
}
