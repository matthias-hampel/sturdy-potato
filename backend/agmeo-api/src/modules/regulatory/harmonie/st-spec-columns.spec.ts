/**
 * The four Sachsen-Anhalt files write exactly the columns of the LLG
 * Exportvorgaben in their order (docs/specs/federal-export/st-mitteilungspflicht-columns.json,
 * extracted by scripts/federal-export/extract-st-columns.mjs).
 */
import { readFileSync } from 'node:fs';

import {
  ANL5_COLUMNS,
  DBE_COLUMNS,
  DUENGUNGEN_COLUMNS,
  ERTRAEGE_COLUMNS,
} from './st/index.js';

const spec = JSON.parse(
  readFileSync(
    new URL(
      './__fixtures__/st-mitteilungspflicht-columns.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<'Anl5' | 'Ertraege' | 'DBE' | 'Duengungen', { name: string }[]>;

const TABLES = {
  Anl5: ANL5_COLUMNS,
  Ertraege: ERTRAEGE_COLUMNS,
  DBE: DBE_COLUMNS,
  Duengungen: DUENGUNGEN_COLUMNS,
};

describe('Sachsen-Anhalt spec columns', () => {
  test.each(Object.keys(TABLES) as (keyof typeof TABLES)[])(
    '%s column names and order match the spec',
    (file) => {
      expect(TABLES[file].map((c) => c.name)).toEqual(
        spec[file].map((c) => c.name),
      );
    },
  );

  test('KreisNr is the only integer, every other number has two decimals', () => {
    for (const columns of Object.values(TABLES)) {
      for (const column of columns) {
        if (column.name === 'KreisNr') expect(column.format).toBe('integer');
        // BG / AZ are "Zahl" too but the Richtwertsammlung group and Ackerzahl are integral by definition.
        else if (column.format === 'integer')
          expect(['BG', 'AZ']).toContain(column.name);
      }
    }
  });
});
