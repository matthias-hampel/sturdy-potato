import {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
} from '../shared/defaults.js';
import type {
  DuengejahrbeginnType,
  EnniBodenklimaraum,
  EnniOrgMetadata,
} from './types.js';
import { ENNI_BODENKLIMARAUM_CODES } from './types.js';
export {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
};

export const ENNI_SOFTWARE_HERSTELLER = 'agmeo (Agvolution GmbH)';

export const ENNI_DATENHERKUNFT = 'SL';

export const DEFAULT_BODENKLIMARAUM: EnniBodenklimaraum = 'BKR_45';

export const BODENKLIMARAUM_OPTIONS: {
  value: EnniBodenklimaraum;
  label: string;
}[] = ENNI_BODENKLIMARAUM_CODES.map((code) => ({
  value: code,
  label: code.replace('BKR_', 'BKR '),
}));

export function getEffectiveEnniMetadata(
  metadata?: EnniOrgMetadata,
): EnniOrgMetadata & {
  betriebsnummer: string;
  duengejahrbeginn: DuengejahrbeginnType;
  bodenklimaraum: EnniBodenklimaraum;
  betriebsdatenOverrides: Record<string, boolean>;
  cropCodeOverrides: Record<string, string>;
} {
  return {
    betriebsnummer: metadata?.betriebsnummer || '',
    duengejahrbeginn: metadata?.duengejahrbeginn || DEFAULT_DUENGEJAHRBEGINN,
    bodenklimaraum: metadata?.bodenklimaraum || DEFAULT_BODENKLIMARAUM,
    nKulisse: metadata?.nKulisse ?? false,
    betriebsdatenOverrides: {
      ...DEFAULT_BETRIEBSDATEN,
      ...(metadata?.betriebsdatenOverrides || {}),
    },
    cropCodeOverrides: metadata?.cropCodeOverrides || {},
    ansprechpartner: metadata?.ansprechpartner,
    betriebsstaette: metadata?.betriebsstaette,
  };
}
