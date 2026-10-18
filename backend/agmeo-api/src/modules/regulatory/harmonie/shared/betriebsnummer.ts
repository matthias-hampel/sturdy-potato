import type { FederalExportFormat } from '../types.js';

/** ENNI/ENDO: the 15-digit InVeKoS number (276 + Land + …). */
export const INVEKOS_BETRIEBSNUMMER_PATTERN = /^276\d{12}$/;

const BETRIEBSNUMMER_PATTERNS: Record<FederalExportFormat, RegExp> = {
  enni: INVEKOS_BETRIEBSNUMMER_PATTERN,
  endo: INVEKOS_BETRIEBSNUMMER_PATTERN,
};

export const BETRIEBSNUMMER_EXAMPLES: Record<FederalExportFormat, string> = {
  enni: '276030000000001',
  endo: '276010000000001',
};

export const isValidBetriebsnummer = (
  format: FederalExportFormat,
  value: string,
): boolean => BETRIEBSNUMMER_PATTERNS[format].test(value.trim());
