/**
 * Rules of the two Dube2.5 XML dialects (ENNI Niedersachsen, ENDO-SH).
 */

import { NATURRAUM_OPTIONS } from '../../../endo/defaults.js';
import {
  getFruchtartSh,
  isFruchtartInStammdatenSh,
} from '../../../endo/fruchtartCodesSh.js';
import type { EndoOrgMetadata } from '../../../endo/types.js';
import { BODENKLIMARAUM_OPTIONS } from '../../../enni/defaults.js';
import type { EnniOrgMetadata } from '../../../enni/types.js';
import { INVEKOS_BETRIEBSNUMMER_PATTERN } from '../../betriebsnummer.js';
import type { FruchtartInfo } from '../../fruchtartCodes.js';
import { getFruchtart, isFruchtartInStammdaten } from '../../fruchtartCodes.js';
import type { ExportFormat, MetadataRule, Rule } from '../engine.js';
import { cropCounts } from '../engine.js';
import {
  bundeslandMismatch,
  COMMON_RULES,
  flikMissing,
  multipleHauptfrucht,
  sowingDateMissing,
  vorfruchtMissing,
} from './common.js';

type XmlMetadata = EnniOrgMetadata | EndoOrgMetadata;

const betriebsnummerFormat = (
  severity: Rule<XmlMetadata>['severity'],
): Rule<XmlMetadata> => ({
  code: 'betriebsnummer_format',
  severity,
  stage: 'pflichtfelder',
  check: ({ metadata }) => {
    const bnr = metadata?.betriebsnummer?.trim();
    if (!bnr || INVEKOS_BETRIEBSNUMMER_PATTERN.test(bnr)) return [];
    return [{ scope: 'betrieb', value: bnr }];
  },
});

const betriebsnummerMissing: MetadataRule<XmlMetadata> = {
  check: ({ metadata }) =>
    metadata?.betriebsnummer
      ? {}
      : {
          missingFields: [
            { key: 'betriebsnummer', label: 'Betriebsnummer', type: 'text' },
          ],
        },
};

type Dialect = {
  resolve: (
    cropName: string,
    overrides?: Record<string, string>,
  ) => FruchtartInfo | undefined;
  inStammdaten: (code: string) => boolean;
};

const DIALECTS: Record<ExportFormat, Dialect> = {
  enni: { resolve: getFruchtart, inStammdaten: isFruchtartInStammdaten },
  endo: { resolve: getFruchtartSh, inStammdaten: isFruchtartInStammdatenSh },
  besyd: { resolve: () => undefined, inStammdaten: () => false },
  st: { resolve: () => undefined, inStammdaten: () => false },
};

const cropMappings: MetadataRule<XmlMetadata> = {
  check: ({ data, metadata, format }) => ({
    missingCropMappings: cropCounts(data)
      .filter(
        ({ cropName }) =>
          !DIALECTS[format].resolve(cropName, metadata?.cropCodeOverrides),
      )
      .map(({ cropName, count }) => ({ cropName, cultivationCount: count })),
  }),
};

/** Stammdaten stage: every resolved code (incl. user overrides) must exist in the dialect's Berechnungsstammdaten. */
const fruchtartNotInStammdaten: Rule<XmlMetadata> = {
  code: 'fruchtart_not_in_stammdaten',
  severity: 'blocking',
  stage: 'stammdaten',
  check: ({ data, metadata, format }) => {
    const dialect = DIALECTS[format];
    return cropCounts(data).flatMap(({ cropName }) => {
      const code = dialect.resolve(cropName, metadata?.cropCodeOverrides)?.code;
      if (!code || dialect.inStammdaten(code)) return [];
      return [
        {
          scope: 'betrieb' as const,
          value: code,
          params: { crop: cropName, code },
        },
      ];
    });
  },
};

const bodenklimaraumMissing: MetadataRule<EnniOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.bodenklimaraum
      ? {}
      : {
          missingFields: [
            {
              key: 'bodenklimaraum',
              label: 'Boden-Klima-Raum',
              type: 'select',
              options: BODENKLIMARAUM_OPTIONS,
              defaultValue: 'BKR_45',
            },
          ],
        },
};

const naturraumMissing: MetadataRule<EndoOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.naturraum
      ? {}
      : {
          missingFields: [
            {
              key: 'naturraum',
              label: 'Naturraum',
              type: 'select',
              options: NATURRAUM_OPTIONS,
              defaultValue: 'Geest',
            },
          ],
        },
};

/** ENNI rejects a malformed 15-digit Betriebsnummer at import — blocking, like ENDO. */
export const ENNI_RULES: Rule<EnniOrgMetadata>[] = [
  betriebsnummerFormat('blocking'),
  bundeslandMismatch('blocking'),
  fruchtartNotInStammdaten,
  flikMissing,
  multipleHauptfrucht,
  vorfruchtMissing('warning'),
  sowingDateMissing,
  ...COMMON_RULES,
];

export const ENNI_METADATA_RULES: MetadataRule<EnniOrgMetadata>[] = [
  betriebsnummerMissing,
  cropMappings,
  bodenklimaraumMissing,
];

/** ENDO-SH drops every Schlag whose Anbau has no Vorfrucht → blocking. */
export const ENDO_RULES: Rule<EndoOrgMetadata>[] = [
  betriebsnummerFormat('blocking'),
  bundeslandMismatch('blocking'),
  fruchtartNotInStammdaten,
  flikMissing,
  multipleHauptfrucht,
  vorfruchtMissing('blocking'),
  sowingDateMissing,
  ...COMMON_RULES,
];

export const ENDO_METADATA_RULES: MetadataRule<EndoOrgMetadata>[] = [
  betriebsnummerMissing,
  cropMappings,
  naturraumMissing,
];
