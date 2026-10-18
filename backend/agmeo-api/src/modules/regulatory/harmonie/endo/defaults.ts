import {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
} from '../shared/defaults.js';
import type {
  EndoDuengejahrbeginnType,
  EndoNaturraumType,
  EndoOrgMetadata,
} from './types.js';
export {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
};

export const DEFAULT_NATURRAUM: EndoNaturraumType = 'Geest';

export const NATURRAUM_OPTIONS: {
  value: EndoNaturraumType;
  label: string;
}[] = [
  { value: 'Marsch', label: 'Marsch' },
  { value: 'Geest', label: 'Geest' },
  { value: 'Hügelland', label: 'Hügelland' },
];

export function getEffectiveEndoMetadata(
  metadata?: EndoOrgMetadata,
): EndoOrgMetadata & {
  betriebsnummer: string;
  duengejahrbeginn: EndoDuengejahrbeginnType;
  naturraum: EndoNaturraumType;
  betriebsdatenOverrides: Record<string, boolean>;
  cropCodeOverrides: Record<string, string>;
} {
  return {
    betriebsnummer: metadata?.betriebsnummer || '',
    duengejahrbeginn: metadata?.duengejahrbeginn || DEFAULT_DUENGEJAHRBEGINN,
    naturraum: metadata?.naturraum || DEFAULT_NATURRAUM,
    betriebsdatenOverrides: {
      ...DEFAULT_BETRIEBSDATEN,
      ...(metadata?.betriebsdatenOverrides || {}),
    },
    cropCodeOverrides: metadata?.cropCodeOverrides || {},
    ansprechpartner: metadata?.ansprechpartner,
    betriebsstaette: metadata?.betriebsstaette,
  };
}
