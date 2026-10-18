/**
 * Farm fertilizer catalogue — Dube2.5 `dokumentation-der-duengung/duengemittel`.
 *
 * One `duenger` per distinct article used in the Düngejahr, with the nutrient
 * contents per carrier unit (kg / dt for mineral products, kg / cbm or kg / t
 * for organic ones). Values of custom articles are flagged as ANALYSE, seed
 * articles as STANDARD.
 */

import type { Duenger, ExportData, ExportFertilization } from '../types.js';
import { formatExportDecimal } from '../utils.js';
import {
  MINERAL_GROUP_TO_DUBE,
  mineralGroup,
  organicGroup,
} from './fertilizerGroup.js';
import { mindestwirksamkeitPercent } from './mindestwirksamkeit.js';

export function buildDuengerKatalog(data: ExportData): Duenger[] {
  const byFqn = new Map<string, ExportFertilization>();
  for (const field of data.fields) {
    for (const cult of field.cultivations) {
      for (const fert of cult.fertilizations) {
        if (!byFqn.has(fert.articleFqn)) byFqn.set(fert.articleFqn, fert);
      }
    }
  }

  return [...byFqn.values()]
    .sort((a, b) => a.fertilizerName.localeCompare(b.fertilizerName))
    .map(toDuenger);
}

function toDuenger(fert: ExportFertilization): Duenger {
  const duenger: Duenger = {
    'duenger-bezeichnung': fert.fertilizerName,
    'duenger-bezeichnung-betrieb': fert.fertilizerName,
    naehrstofftraegerart: fert.naehrstofftraegerart,
    'art-der-werte': fert.isCustomArticle ? 'ANALYSE' : 'STANDARD',
    einheit: fert.carrierUnit,
    'gehalt-P2O5': formatExportDecimal(fert.p2o5PerCarrierUnit ?? 0),
    'gehalt-N-gesamt': formatExportDecimal(fert.nPerCarrierUnit ?? 0),
  };

  if (fert.naehrstofftraegerart === 'MINERALDUENGER') {
    duenger.mineralduengergruppe = MINERAL_GROUP_TO_DUBE[mineralGroup(fert)];
  } else if (fert.naehrstofftraegerart === 'WIRTSCHAFTSDUENGER') {
    const group = organicGroup(fert.articleFqn);
    duenger.dunggruppe = group;
    // The catalogue is farm-wide; Anlage 3 lists the same value for Acker- and Grünland.
    const percent = mindestwirksamkeitPercent(group, 'ACKER');
    if (percent !== undefined && fert.nPerCarrierUnit !== null) {
      duenger['verfuegbar-N'] = formatExportDecimal(
        (fert.nPerCarrierUnit * percent) / 100,
      );
    }
  }

  if (fert.nh4PerCarrierUnit !== null)
    duenger['gehalt-NH4'] = formatExportDecimal(fert.nh4PerCarrierUnit);
  if (fert.dryMatterContent !== null)
    duenger['anteil-trockensubstanz'] = formatExportDecimal(
      fert.dryMatterContent,
    );

  return duenger;
}
