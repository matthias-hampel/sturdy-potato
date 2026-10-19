/**
 * Every IMP*.TXT serializer writes exactly the columns of the webBESyD import
 * specification, in its order (docs/specs/federal-export/webbesyd-import-columns.json,
 * extracted by scripts/federal-export/extract-webbesyd-columns.mjs).
 */
import { readFileSync } from 'node:fs';

import {
  IMPANBAU_COLUMNS,
  IMPBETR_COLUMNS,
  IMPERNTE_COLUMNS,
  IMPMAKRO_COLUMNS,
  IMPMIND_COLUMNS,
  IMPNLEGUM_COLUMNS,
  IMPNLEGUMBETRIEB_COLUMNS,
  IMPNMIN_COLUMNS,
  IMPORG_COLUMNS,
  IMPWEIDE_COLUMNS,
  IMPWEIDEBETRIEB_COLUMNS,
} from './besyd/builders/index.js';
import type { BesydColumn } from './besyd/formatters.js';
import { ORGANIC_FERTILIZER_CODES } from './besyd/referenzCodes.js';
import { ORGANIC_GROUP_TO_BESYD } from './shared/fertilizerGroup.js';

const spec = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/webbesyd-import-columns.json', import.meta.url),
    'utf8',
  ),
) as Record<string, SpecColumn[]>;

type SpecColumn = { name: string; format: string; required: boolean | null };

const TABLES: Record<string, readonly BesydColumn[]> = {
  'IMPBETR.TXT': IMPBETR_COLUMNS,
  'IMPANBAU.TXT': IMPANBAU_COLUMNS,
  'IMPORG.TXT': IMPORG_COLUMNS,
  'IMPNMIN.TXT': IMPNMIN_COLUMNS,
  'IMPMAKRO.TXT': IMPMAKRO_COLUMNS,
  'IMPMIND.TXT': IMPMIND_COLUMNS,
  'IMPNLEGUM.TXT': IMPNLEGUM_COLUMNS,
  'IMPNLEGUMBETRIEB.TXT': IMPNLEGUMBETRIEB_COLUMNS,
  'IMPWEIDE.TXT': IMPWEIDE_COLUMNS,
  'IMPWEIDEBETRIEB.TXT': IMPWEIDEBETRIEB_COLUMNS,
  'IMPERNTE.TXT': IMPERNTE_COLUMNS,
};

describe('BESyD spec columns', () => {
  test('the spec JSON covers the eleven import files', () => {
    expect(Object.keys(spec).sort()).toEqual(Object.keys(TABLES).sort());
  });

  test.each(Object.keys(TABLES))(
    '%s column names and order match the spec',
    (file) => {
      const specColumns = (spec as Record<string, SpecColumn[]>)[file];
      expect(TABLES[file].map((c) => c.name)).toEqual(
        specColumns.map((c) => c.name),
      );
    },
  );

  test.each(Object.keys(TABLES))(
    '%s column formats follow the spec',
    (file) => {
      const specColumns = (spec as Record<string, SpecColumn[]>)[file];
      TABLES[file].forEach((column, i) => {
        const specFormat = specColumns[i].format;
        // BNR is a text field everywhere; the code/text distinction only matters for quoting.
        const quoted = (f: string) => f === 'text' || f === 'code';
        expect({ column: column.name, quoted: quoted(column.format) }).toEqual({
          column: column.name,
          quoted: quoted(specFormat),
        });
        if (!quoted(specFormat))
          expect({ column: column.name, format: column.format }).toEqual({
            column: column.name,
            format: specFormat,
          });
      });
    },
  );

  test('every organic group code exists in Tabelle 15', () => {
    const codes = new Set(ORGANIC_FERTILIZER_CODES.map((c) => c.code));
    for (const code of Object.values(ORGANIC_GROUP_TO_BESYD))
      expect(codes.has(code)).toBe(true);
  });
});
