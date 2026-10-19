import type { FederalExportFormat } from '../types.js';

/** ENNI/ENDO: the 15-digit InVeKoS number (276 + Land + …). */
export const INVEKOS_BETRIEBSNUMMER_PATTERN = /^276\d{12}$/;
/** webBESyD: 12 digits starting with the Land key 12 (BB), 14 (SN), 15 (ST) or 16 (TH). */
const BESYD_BETRIEBSNUMMER_PATTERN = /^(12|14|15|16)\d{10}$/;
/** Sachsen-Anhalt Mitteilung: the 12-digit EU-Betriebsnummer. */
const EU_BETRIEBSNUMMER_PATTERN = /^\d{12}$/;

const BETRIEBSNUMMER_PATTERNS: Record<FederalExportFormat, RegExp> = {
  enni: INVEKOS_BETRIEBSNUMMER_PATTERN,
  endo: INVEKOS_BETRIEBSNUMMER_PATTERN,
  besyd: BESYD_BETRIEBSNUMMER_PATTERN,
  st: EU_BETRIEBSNUMMER_PATTERN,
};

export const BETRIEBSNUMMER_EXAMPLES: Record<FederalExportFormat, string> = {
  enni: '276030000000001',
  endo: '276010000000001',
  besyd: '150000000001',
  st: '150000000001',
};

export const isValidBetriebsnummer = (
  format: FederalExportFormat,
  value: string,
): boolean => BETRIEBSNUMMER_PATTERNS[format].test(value.trim());
