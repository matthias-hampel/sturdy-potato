/**
 * BESyD / webBESyD rules (Brandenburg, Sachsen, Sachsen-Anhalt, Thüringen).
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/shared/preflight/rules/besyd.ts`.
 */

import {
  detectBundeslandFromBnr,
  validateBetriebsnummer,
} from '../../../besyd/defaults.js';
import { getBesydFruchtart } from '../../../besyd/fruchtartCodes.js';
import {
  BODEN_KLIMA_RAUM_CODES,
  getBodenKlimaRaumByBundesland,
} from '../../../besyd/referenzCodes.js';
import type { BesydOrgMetadata } from '../../../besyd/types.js';
import type { MetadataRule, Rule } from '../engine.js';
import { cropCounts } from '../engine.js';
import {
  bundeslandMismatch,
  COMMON_RULES,
  flikMissingBlocking,
  sowingDateMissing,
  vorfruchtMissing,
} from './common.js';

const besydBetriebsnummer: MetadataRule<BesydOrgMetadata> = {
  check: ({ metadata }) => {
    if (!metadata?.betriebsnummer) {
      return {
        missingFields: [
          { key: 'betriebsnummer', label: 'Betriebsnummer', type: 'text' },
        ],
      };
    }
    const validation = validateBetriebsnummer(metadata.betriebsnummer);
    if (validation.valid) return {};
    return {
      missingFields: [
        {
          key: 'betriebsnummer',
          label: 'Betriebsnummer',
          type: 'text',
          defaultValue: metadata.betriebsnummer,
        },
      ],
    };
  },
};

const besydBetriebsnummerFormat: Rule<BesydOrgMetadata> = {
  code: 'betriebsnummer_format',
  severity: 'blocking',
  stage: 'pflichtfelder',
  check: ({ metadata }) => {
    if (!metadata?.betriebsnummer) return [];
    const validation = validateBetriebsnummer(metadata.betriebsnummer);
    return validation.valid
      ? []
      : [{ scope: 'betrieb', value: metadata.betriebsnummer }];
  },
};

const berechnungsgrundlageMissing: MetadataRule<BesydOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.berechnungsgrundlage
      ? {}
      : {
          missingFields: [
            {
              key: 'berechnungsgrundlage',
              label: 'Berechnungsgrundlage',
              type: 'select',
              options: [
                { value: 'DV', label: 'Konventionell (DV)' },
                { value: 'ÖL', label: 'Ökologisch (ÖL)' },
              ],
              defaultValue: 'DV',
            },
          ],
        },
};

const besydBodenklimaraumMissing: MetadataRule<BesydOrgMetadata> = {
  check: ({ metadata }) => {
    if (metadata?.bodenklimaraum) return {};
    const bundesland = metadata?.betriebsnummer
      ? detectBundeslandFromBnr(metadata.betriebsnummer)
      : null;
    const options = bundesland
      ? getBodenKlimaRaumByBundesland(bundesland)
      : BODEN_KLIMA_RAUM_CODES;
    return {
      missingFields: [
        {
          key: 'bodenklimaraum',
          label: 'Boden-Klima-Raum',
          type: 'select',
          options: options.map((bkr) => ({
            value: bkr.code,
            label: `${bkr.code} - ${bkr.name}`,
          })),
        },
      ],
    };
  },
};

const besydCropMappings: MetadataRule<BesydOrgMetadata> = {
  check: ({ data, metadata }) => ({
    missingCropMappings: cropCounts(data, false)
      .filter(
        ({ cropName }) =>
          !getBesydFruchtart(cropName, metadata?.cropCodeOverrides),
      )
      .map(({ cropName, count }) => ({ cropName, cultivationCount: count })),
  }),
};

/** webBESyD accepts one import per Betrieb and Erntejahr — remind before download. */
const importOncePerYear: Rule<BesydOrgMetadata> = {
  code: 'besyd_import_once_per_year',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: () => [{ scope: 'betrieb' }],
};

/** IMPANBAU.VFRUCHT is a Pflichtfeld and never substituted → blocking. */
export const BESYD_RULES: Rule<BesydOrgMetadata>[] = [
  besydBetriebsnummerFormat,
  bundeslandMismatch('warning'),
  flikMissingBlocking,
  vorfruchtMissing('blocking'),
  sowingDateMissing,
  ...COMMON_RULES,
  importOncePerYear,
];

export const BESYD_METADATA_RULES: MetadataRule<BesydOrgMetadata>[] = [
  besydBetriebsnummer,
  berechnungsgrundlageMissing,
  besydBodenklimaraumMissing,
  besydCropMappings,
];
