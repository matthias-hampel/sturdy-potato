/**
 * Organic-N limitation (170 kg N/ha, DüV §6) farm data — Dube2.5 `n-170-begrenzung`.
 *
 * agmeo has no livestock model, so these values are entered once per Düngejahr
 * on the export page and stored in the org metadata (`integrations.n170[year]`).
 * The field areas of the module are derived from the exported Schläge.
 */

import type { NaehrstofftraegerartType } from '../types.js';

export type N170Tierhaltung = {
  tierBezeichnung: string;
  anzahlTiere: number;
  weidetage?: number;
  weidefaktor?: number;
  /** ENDO only (ENNI's XSD has no such element). */
  milchleistungKgEcm?: number;
};

export type N170Transfer = {
  duengerBezeichnung: string;
  naehrstofftraegerart: NaehrstofftraegerartType;
  /** ISO date `YYYY-MM-DD` */
  lieferdatum: string;
  beteiligterBetrieb: string;
  /** t or m³ of the product */
  menge: number;
  /** kg N per carrier unit */
  gehaltNGesamt: number;
  /** kg P2O5 per carrier unit */
  gehaltP2o5: number;
  lieferscheinBezeichnung?: string;
};

export type N170Betriebsdaten = {
  tierhaltungen?: N170Tierhaltung[];
  organischeDuengerAufnahmen?: N170Transfer[];
  organischeDuengerAbgaben?: N170Transfer[];
  hofeigeneBiogasanlage?: boolean;
};
