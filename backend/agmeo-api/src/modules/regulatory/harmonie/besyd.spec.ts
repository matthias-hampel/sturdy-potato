import {
  BESYD_TEXT_DELIMITER,
  type BesydColumn,
  formatBesydBoolean,
  formatBesydDateShort,
  formatBesydNumber,
  formatBesydText,
  serializeBesydRow,
} from './besyd/index.js';

describe('BESyD Formatters', () => {
  describe('formatBesydText', () => {
    test('formats text with German quotes', () => {
      expect(formatBesydText('Test')).toBe(
        `${BESYD_TEXT_DELIMITER}Test${BESYD_TEXT_DELIMITER}`,
      );
    });

    test('returns empty string for null/undefined', () => {
      expect(formatBesydText(null)).toBe('');
      expect(formatBesydText(undefined)).toBe('');
      expect(formatBesydText('')).toBe('');
    });

    test('escapes internal German quotes', () => {
      const result = formatBesydText(`Test${BESYD_TEXT_DELIMITER}Value`);
      expect(result).toBe(
        `${BESYD_TEXT_DELIMITER}Test${BESYD_TEXT_DELIMITER}${BESYD_TEXT_DELIMITER}Value${BESYD_TEXT_DELIMITER}`,
      );
    });
  });

  describe('formatBesydNumber', () => {
    test('writes the value as is without a decimals setting (EJAHR, REFERENCE_ID)', () => {
      expect(formatBesydNumber(2025)).toBe('2025');
    });

    test('formats number with specified decimal places', () => {
      expect(formatBesydNumber(123.456, 1)).toBe('123.5');
      expect(formatBesydNumber(123.456, 0)).toBe('123');
    });

    test('returns empty string for null/undefined/NaN', () => {
      expect(formatBesydNumber(null)).toBe('');
      expect(formatBesydNumber(undefined)).toBe('');
      expect(formatBesydNumber(NaN)).toBe('');
    });
  });

  describe('formatBesydDateShort', () => {
    // Dates reaching the export are UTC instants from the DB, and the day they
    // name must not shift with the runtime's zone — this file is submitted.
    test('formats date as dd.mm.yyyy (the per-column format of every IMP* table)', () => {
      expect(formatBesydDateShort(new Date(Date.UTC(2025, 0, 15)))).toBe(
        '15.01.2025',
      );
      expect(formatBesydDateShort('2025-01-15')).toBe('15.01.2025');
      expect(formatBesydDateShort(null)).toBe('');
    });
  });

  describe('formatBesydBoolean', () => {
    test('formats boolean as j/n', () => {
      expect(formatBesydBoolean(true)).toBe('j');
      expect(formatBesydBoolean(false)).toBe('n');
    });

    test('returns empty string for null/undefined', () => {
      expect(formatBesydBoolean(null)).toBe('');
      expect(formatBesydBoolean(undefined)).toBe('');
    });
  });

  describe('serializeBesydRow', () => {
    const columns: BesydColumn[] = [
      { name: 'T', format: 'text' },
      { name: 'C', format: 'code' },
      { name: 'N', format: 'number', decimals: 1 },
      { name: 'D', format: 'date' },
      { name: 'F', format: 'flag' },
    ];

    test('quotes text and code columns, writes numbers, dates and flags bare', () => {
      expect(
        serializeBesydRow(columns, [
          'Feld',
          '0102',
          12.345,
          new Date(Date.UTC(2025, 0, 15)),
          true,
        ]),
      ).toBe('„Feld„;„0102„;12.3;15.01.2025;j');
    });

    test('empty cells for null / undefined / NaN', () => {
      expect(
        serializeBesydRow(columns, [null, undefined, NaN, null, undefined]),
      ).toBe(';;;;');
    });

    test('refuses a row whose cell count differs from the column count', () => {
      expect(() => serializeBesydRow(columns, ['a'])).toThrow(/cells/);
    });
  });
});
