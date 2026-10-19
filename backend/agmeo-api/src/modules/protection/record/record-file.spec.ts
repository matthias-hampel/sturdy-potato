import { EXPORT_SCHEMA, EXPORT_SCHEMA_VERSION, type ProtectionExport } from './eu-export.js';
import { fileName, toCsv, toJson } from './record-file.js';

const document = (): ProtectionExport => ({
  schema: EXPORT_SCHEMA,
  schemaVersion: EXPORT_SCHEMA_VERSION,
  year: 2026,
  generatedAt: '2026-09-13T08:00:00.000Z',
  farm: {
    sachkunde: { number: 'SK-1', holder: null, validUntil: '2028-01-31' },
    sprayerInspection: { number: null, lastInspection: null },
  },
  applications: [
    {
      operationId: 'op-1',
      passId: 'p-1',
      applicationDate: '2026-04-12',
      timeOfDay: '08:30',
      usageType: 'FREILAND',
      field: { id: 'f1', name: 'Am Bach; Nord', areaHa: 12.5, flik: null, hasGeometry: true },
      crop: { name: 'Winterweizen', eppoCode: 'TRZAW' },
      growthStageBbch: 31,
      applicator: 'Anwender A',
      products: [
        {
          articleId: 'Mittel 1',
          kennr: '024780-00',
          awgId: '024780-00/01-001',
          targetOrganism: 'Septoria',
          dose: 1.25,
          doseUnit: 'l/ha',
          absoluteAmount: 15.625,
          absoluteAmountUnit: 'l',
          preHarvestIntervalDays: 35,
          earliestHarvestDate: '2026-05-17',
        },
        {
          articleId: 'Mittel 2',
          kennr: null,
          awgId: null,
          targetOrganism: null,
          dose: 0.5,
          doseUnit: 'l/ha',
          absoluteAmount: 6.25,
          absoluteAmountUnit: 'l',
          preHarvestIntervalDays: null,
          earliestHarvestDate: null,
        },
      ],
      missingFields: ['BVL-Zulassungsnummer'],
    },
    {
      operationId: 'op-2',
      passId: 'p-2',
      applicationDate: '2026-05-02',
      timeOfDay: null,
      usageType: null,
      field: { id: 'f2', name: 'Hinterm Hof', areaHa: 3, flik: 'DENILI0000000001', hasGeometry: false },
      crop: { name: null, eppoCode: null },
      growthStageBbch: null,
      applicator: null,
      products: [],
      missingFields: ['Mittelname', 'Aufwandmenge', 'Anwender'],
    },
  ],
});

describe('toCsv', () => {
  const lines = toCsv(document()).split('\r\n');

  it('starts with a byte-order mark and the certificates before the header', () => {
    expect(lines[0].charCodeAt(0)).toBe(0xfeff);
    expect(lines[2]).toBe('# Sachkundenachweis: SK-1, gültig bis 2028-01-31');
    expect(lines[3]).toBe('# Spritzenprüfung: nicht hinterlegt');
    expect(lines[4].startsWith('Vorgang;Datum;Uhrzeit')).toBe(true);
  });

  it('writes one row per product of a tank mix, sharing the operation id', () => {
    const op1 = lines.filter((z) => z.startsWith('op-1;'));
    expect(op1).toHaveLength(2);
    expect(op1[0]).toContain(';Mittel 1;024780-00;Septoria;024780-00/01-001;1,25;l/ha;15,625;l;35;2026-05-17;');
    expect(op1[1]).toContain(';Mittel 2;;;;0,5;l/ha;6,25;l;;;');
  });

  it('keeps a pass without a product as one row with its gaps', () => {
    const op2 = lines.filter((z) => z.startsWith('op-2;'));
    expect(op2).toHaveLength(1);
    expect(op2[0].endsWith(';;Mittelname, Aufwandmenge, Anwender')).toBe(true);
  });

  it('uses German decimals, names the usage type and quotes a field name with the separator in it', () => {
    const op1 = lines.find((z) => z.startsWith('op-1;'))!;
    expect(op1.startsWith('op-1;2026-04-12;08:30;Freiland;"Am Bach; Nord";;12,5;Winterweizen;TRZAW;31;')).toBe(true);
    expect(lines.find((z) => z.startsWith('op-2;'))).toContain(';Hinterm Hof;DENILI0000000001;3;;;;');
  });

  it('has the same number of cells in every row', () => {
    const columns = lines[4].split(';').length;
    for (const line of lines.slice(5).filter(Boolean)) {
      // A quoted cell may hide a separator; count cells outside quotes.
      const cells = line.match(/("([^"]|"")*"|[^;]*)(;|$)/g)!.filter((z) => z !== '').length;
      expect(cells).toBe(columns);
    }
  });
});

describe('toJson and fileName', () => {
  it('round-trips the document and names the file by year', () => {
    const json = JSON.parse(toJson(document())) as ProtectionExport;
    expect(json.schema).toBe(EXPORT_SCHEMA);
    expect(json.applications[0].products).toHaveLength(2);
    expect(fileName(2026, 'csv')).toBe('Pflanzenschutz_2026.csv');
    expect(fileName(2026, 'json')).toBe('Pflanzenschutz_2026.json');
  });
});
