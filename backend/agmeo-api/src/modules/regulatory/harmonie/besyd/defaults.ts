/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/defaults.ts`. */

import type {
  Berechnungsgrundlage,
  BesydBundesland,
  BesydOrgMetadata,
} from './types.js';

export const DEFAULT_BERECHNUNGSGRUNDLAGE: Berechnungsgrundlage = 'DV';
export const DEFAULT_AMT = '99';
export const DEFAULT_BODENKLIMARAUM = '107';

export function detectBundeslandFromBnr(bnr: string): BesydBundesland | null {
  if (!bnr || bnr.length < 2) return null;
  const prefix = bnr.substring(0, 2);
  if (['12', '14', '15', '16'].includes(prefix))
    return prefix as BesydBundesland;
  return null;
}

export function validateBetriebsnummer(bnr: string): {
  valid: boolean;
  error?: string;
} {
  if (!bnr) return { valid: false, error: 'Betriebsnummer ist erforderlich' };
  if (bnr.length !== 12)
    return { valid: false, error: 'Betriebsnummer muss 12 Zeichen lang sein' };
  const bundesland = detectBundeslandFromBnr(bnr);
  if (!bundesland) {
    return {
      valid: false,
      error:
        'Betriebsnummer muss mit 12, 14, 15 oder 16 beginnen (Brandenburg, Sachsen, Sachsen-Anhalt oder Thüringen)',
    };
  }
  return { valid: true };
}

export function getEffectiveBesydMetadata(
  metadata?: BesydOrgMetadata,
): Required<
  Pick<BesydOrgMetadata, 'betriebsnummer' | 'berechnungsgrundlage' | 'amt'>
> &
  BesydOrgMetadata {
  return {
    betriebsnummer: metadata?.betriebsnummer || '',
    berechnungsgrundlage:
      metadata?.berechnungsgrundlage || DEFAULT_BERECHNUNGSGRUNDLAGE,
    bodenklimaraum: metadata?.bodenklimaraum || DEFAULT_BODENKLIMARAUM,
    amt: metadata?.amt || DEFAULT_AMT,
    email: metadata?.email,
    firma: metadata?.firma,
    plz: metadata?.plz,
    ort: metadata?.ort,
    strasse: metadata?.strasse,
    cropCodeOverrides: metadata?.cropCodeOverrides || {},
    organicFertilizerCodeOverrides:
      metadata?.organicFertilizerCodeOverrides || {},
    mineralFertilizerCodeOverrides:
      metadata?.mineralFertilizerCodeOverrides || {},
  };
}
