/**
 * Sachsen-Anhalt rules — what the LLG rejects ("unvollständige, leere,
 * falsch benannte … Daten werden nicht anerkannt") plus the metadata the
 * files need.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/preflight.ts`.
 */

import type { MetadataRule, Rule } from '../shared/preflight/engine.js';
import { cropCounts, runRules } from '../shared/preflight/engine.js';
import {
  bundeslandMismatch,
  COMMON_RULES,
  sowingDateMissing,
  vorfruchtMissing,
} from '../shared/preflight/rules/common.js';
import type {
  ExportCultivation,
  ExportData,
  PreflightResult,
} from '../types.js';
import { ST_KREISE } from './codes/kreise.js';
import { getStKultur, isStKulturCode } from './codes/kulturen.js';
import type { StOrgMetadata } from './types.js';

/** 12 digits; Land 15 for a Betriebssitz in ST, 12/14/16 (BB, SN, TH) for neighbours farming ST land. */
const EU_BNR_PATTERN = /^(12|14|15|16)\d{10}$/;
const FELDBLOCK_PATTERN = /^DESTLI\d{10}$/;

/** Rows of the DBE file — next year's Herbstansaat has no DBE of this year. */
const isStHauptfrucht = (cult: ExportCultivation) =>
  cult.cropRole === 'MAIN' && !cult.herbstansaat;

const missingText = (key: string, label: string) => ({
  missingFields: [{ key, label, type: 'text' as const }],
});

const betriebsnummerMissing: MetadataRule<StOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.euBetriebsnummer
      ? {}
      : missingText('euBetriebsnummer', 'EU-Betriebsnummer'),
};

const betriebsnummerFormat: Rule<StOrgMetadata> = {
  code: 'betriebsnummer_format',
  severity: 'blocking',
  stage: 'pflichtfelder',
  check: ({ metadata }) => {
    const bnr = metadata?.euBetriebsnummer?.trim();
    if (!bnr || EU_BNR_PATTERN.test(bnr)) return [];
    return [{ scope: 'betrieb', value: bnr }];
  },
};

/** A Betriebssitz in Sachsen-Anhalt carries the Land code 15. */
const betriebsnummerLand: Rule<StOrgMetadata> = {
  code: 'st_betriebsnummer_land',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ metadata }) => {
    const bnr = metadata?.euBetriebsnummer?.trim();
    if (!bnr || !EU_BNR_PATTERN.test(bnr)) return [];
    const inSt = metadata?.sitzInSt ?? true;
    return inSt !== bnr.startsWith('15')
      ? [{ scope: 'betrieb', value: bnr.slice(0, 2) }]
      : [];
  },
};

const betriebsnameMissing: MetadataRule<StOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.betriebsname ? {} : missingText('betriebsname', 'Betriebsname'),
};

const sitzMissing: MetadataRule<StOrgMetadata> = {
  check: ({ metadata }) => ({
    missingFields: [
      ...(metadata?.sitzPlz
        ? []
        : missingText('sitzPlz', 'PLZ des Betriebssitzes').missingFields),
      ...(metadata?.sitzOrt
        ? []
        : missingText('sitzOrt', 'Ort des Betriebssitzes').missingFields),
    ],
  }),
};

const kreisMissing: MetadataRule<StOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.kreisNr && ST_KREISE.some((k) => k.nr === metadata.kreisNr)
      ? {}
      : {
          missingFields: [
            {
              key: 'kreisNr',
              label: 'Landkreis',
              type: 'select',
              options: ST_KREISE.map((k) => ({
                value: String(k.nr),
                label: `${k.nr} - ${k.name}`,
              })),
            },
          ],
        },
};

const bewirtschaftungMissing: MetadataRule<StOrgMetadata> = {
  check: ({ metadata }) =>
    metadata?.bewirtschaftung
      ? {}
      : {
          missingFields: [
            {
              key: 'bewirtschaftung',
              label: 'Bewirtschaftung',
              type: 'select',
              options: [
                { value: 'k', label: 'konventionell' },
                { value: 'o', label: 'ökologisch' },
              ],
              defaultValue: 'k',
            },
          ],
        },
};

/** Only crops that end up in a row need a code: Hauptfrüchte (DBE, Ertraege) and fertilized cultivations. */
const cropMappings: MetadataRule<StOrgMetadata> = {
  check: ({ data, metadata }) => {
    const needed = new Set<string>();
    for (const field of data.fields) {
      for (const cult of field.cultivations) {
        if (cult.herbstansaat) continue;
        if (cult.cropRole === 'MAIN' || cult.fertilizations.length > 0)
          needed.add(cult.crop);
        if (cult.cropRole === 'MAIN' && cult.previousCrop)
          needed.add(cult.previousCrop);
      }
    }
    return {
      missingCropMappings: cropCounts(data, false)
        .filter(
          ({ cropName }) =>
            needed.has(cropName) &&
            !getStKultur(cropName, metadata?.cropCodeOverrides),
        )
        .map(({ cropName, count }) => ({ cropName, cultivationCount: count })),
    };
  },
};

const kulturNotInAnlage1: Rule<StOrgMetadata> = {
  code: 'fruchtart_not_in_stammdaten',
  severity: 'blocking',
  stage: 'stammdaten',
  check: ({ data, metadata }) =>
    cropCounts(data, false).flatMap(({ cropName }) => {
      const code = getStKultur(cropName, metadata?.cropCodeOverrides)?.code;
      if (!code || isStKulturCode(code)) return [];
      return [
        {
          scope: 'betrieb' as const,
          value: code,
          params: { crop: cropName, code },
        },
      ];
    }),
};

const feldblockFormat: Rule<StOrgMetadata> = {
  code: 'st_feldblock_format',
  severity: 'blocking',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter(
        (f) =>
          f.cultivations.length > 0 &&
          !(f.flik && FELDBLOCK_PATTERN.test(f.flik)),
      )
      .map((f) => ({
        scope: 'field' as const,
        fieldId: f.id,
        fieldName: f.name,
        value: f.flik ?? '',
      })),
};

const parzelleMissing: Rule<StOrgMetadata> = {
  code: 'st_parzelle_missing',
  severity: 'blocking',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter(
        (f) =>
          f.cultivations.length > 0 && isNaN(parseInt(f.parcelId ?? '', 10)),
      )
      .map((f) => ({
        scope: 'field' as const,
        fieldId: f.id,
        fieldName: f.name,
        value: f.parcelId ?? '',
      })),
};

/** §10(1) Nr. 3: the DBE file carries the P soil content of every Schlag. */
const pSoilValueMissing: Rule<StOrgMetadata> = {
  code: 'st_p_soil_value_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter(
        (f) =>
          f.cultivations.some(isStHauptfrucht) &&
          f.soilSamples[0]?.p2o5 == null,
      )
      .map((f) => ({
        scope: 'field' as const,
        fieldId: f.id,
        fieldName: f.name,
      })),
};

/** No stored Düngebedarfsermittlung → the DBE row has no N need. */
const dbeMissing = (
  cultivationIdsWithDbe: ReadonlySet<string>,
): Rule<StOrgMetadata> => ({
  code: 'st_dbe_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter(
          (c) =>
            isStHauptfrucht(c) && !cultivationIdsWithDbe.has(c.cultivationId),
        )
        .map((c) => ({
          scope: 'cultivation' as const,
          fieldId: f.id,
          fieldName: f.name,
          cultivationId: c.cultivationId,
          params: { crop: c.crop },
        })),
    ),
});

const ST_RULES: Rule<StOrgMetadata>[] = [
  betriebsnummerFormat,
  betriebsnummerLand,
  bundeslandMismatch('blocking'),
  kulturNotInAnlage1,
  feldblockFormat,
  parzelleMissing,
  pSoilValueMissing,
  vorfruchtMissing('warning'),
  sowingDateMissing,
  ...COMMON_RULES,
];

const ST_METADATA_RULES: MetadataRule<StOrgMetadata>[] = [
  betriebsnameMissing,
  betriebsnummerMissing,
  sitzMissing,
  kreisMissing,
  bewirtschaftungMissing,
  cropMappings,
];

export function runStPreflightRules(
  data: ExportData,
  metadata?: StOrgMetadata,
  cultivationIdsWithDbe?: ReadonlySet<string>,
): PreflightResult {
  const rules = cultivationIdsWithDbe
    ? [...ST_RULES, dbeMissing(cultivationIdsWithDbe)]
    : ST_RULES;
  return runRules(rules, ST_METADATA_RULES, {
    data,
    metadata: metadata ?? {},
    format: 'st',
  });
}
