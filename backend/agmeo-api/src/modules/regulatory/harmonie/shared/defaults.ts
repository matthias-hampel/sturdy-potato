import type { Betriebsdaten, DuengejahrbeginnType } from '../types.js';

export const DEFAULT_BETRIEBSDATEN: Betriebsdaten = {
  'andere-duenger-ausgebracht': false,
  'kompost-ausgebracht': false,
  'duengungs-oder-beweidungseinschraenkungen': false,
};

/** Kalenderjahr — the Düngejahr the authorities recommend for every farm. */
export const DEFAULT_DUENGEJAHRBEGINN: DuengejahrbeginnType = 'JANUAR';

export const DUENGEJAHRBEGINN_OPTIONS: {
  value: DuengejahrbeginnType;
  label: string;
}[] = [
  { value: 'JANUAR', label: 'Januar' },
  { value: 'FEBRUAR', label: 'Februar' },
  { value: 'MAERZ', label: 'März' },
  { value: 'APRIL', label: 'April' },
  { value: 'MAI', label: 'Mai' },
  { value: 'JUNI', label: 'Juni' },
  { value: 'JULI', label: 'Juli' },
  { value: 'AUGUST', label: 'August' },
  { value: 'SEPTEMBER', label: 'September' },
  { value: 'OKTOBER', label: 'Oktober' },
  { value: 'NOVEMBER', label: 'November' },
  { value: 'DEZEMBER', label: 'Dezember' },
];

export const ENNI_ENDO_VERSION = 'Dube2.5';
