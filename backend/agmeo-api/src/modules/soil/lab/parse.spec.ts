/** Lab result files (ported behaviour of AGVOLUTION/agmeo lib/soil/labResultsUpload.ts and probenkarteImport.ts). */
import type { MultiPolygon } from 'geojson';
import { zip } from '../../vra/export/zip.js';
import { formatNumeric, SAMPLE_CARD_FIELDS, sampleCardRows, tgisShapefile } from '../export/tgis.js';
import {
  assertPlausible,
  decodeText,
  dedupeRows,
  fieldNameFromSchlagnummer,
  LabFileError,
  parseGermanDate,
  parseGermanNumber,
  parseLabCsv,
  parseLabFile,
  parseLabSheet,
} from './parse.js';
import { columnIndex, excelDate, parseSheet } from './xlsx.js';

describe('numbers, dates and names', () => {
  it('reads German numbers, detection limits and dates', () => {
    expect(parseGermanNumber('6,8')).toBe(6.8);
    expect(parseGermanNumber('<0,10')).toBe(0.1);
    expect(parseGermanNumber('1.234,5')).toBe(1234.5);
    expect(parseGermanNumber('-')).toBeNull();
    expect(parseGermanDate('06.03.24')).toBe('2024-03-06');
    expect(parseGermanDate('31.02.2024')).toBeNull();
    expect(fieldNameFromSchlagnummer('0 - 1001 - GL Kummer (2,15 ha)')).toBe('GL Kummer');
    expect(excelDate(45357)).toBe('2024-03-06');
    expect(columnIndex('AB12')).toBe(27);
  });

  it('decodes windows-1252 when the bytes are not UTF-8', () => {
    expect(decodeText(Buffer.from('Schlag;Größe', 'latin1'))).toBe('Schlag;Größe');
    expect(decodeText(Buffer.from('Schlag;Größe', 'utf8'))).toBe('Schlag;Größe');
  });
});

describe('CSV', () => {
  it('reads the FarmFacts/LUFA layout and converts element columns to oxides', () => {
    const csv = ['Gpsnr;Schlag;PNDatum;pH;P;K;Mg;Orgs;PStufe;Kalkbed.;Labornr', '101;Am Bach;06.03.2024;6,4;5,2;10;5;2,1;C;12;L-1', '102;Am Bach;06.03.2024;5,9;3;8;4;;B;;L-2', ';Summe;;;;;;;;;'].join('\r\n')
    const rows = parseLabCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      probeNr: 101,
      fieldNameHint: 'Am Bach',
      date: '2024-03-06',
      values: { ph: 6.4, p2o5: 11.91, k2o: 12.05, mgo: 8.29, humus: 2.1 },
      methods: { ph: 'cacl2', p2o5: 'cal', k2o: 'cal', mgo: 'cacl2' },
      stages: { p2o5: 'C' },
      kalkbedarf: { dtHa: 12, kg: null },
      labNr: 'L-1',
    });
    expect(rows[1].values.humus).toBeUndefined();
  });

  it('skips the numbered dummy row of ASDE exports and takes oxide columns as they are', () => {
    const csv = ['1;2;3;4', 'Probe-Nr;P2O5;K2O;Methode', '7;14;18;DL'].join('\n');
    expect(parseLabCsv(csv)[0]).toMatchObject({ probeNr: 7, values: { p2o5: 14, k2o: 18 }, methods: { p2o5: 'dl', k2o: 'dl' } });
  });

  it('rejects files without probe numbers or values', () => {
    expect(() => parseLabCsv('Name;Wert\nA;1')).toThrow(LabFileError);
  });

  it('rejects P values that do not fit mg P/100 g', () => {
    const rows = [1, 2, 3].map(() => ({ values: { p2o5: 200 }, stages: { p2o5: 'C' } }));
    expect(() => assertPlausible(rows)).toThrow('unit-mismatch');
    expect(() => assertPlausible([{ values: { p2o5: 14 }, stages: { p2o5: 'C' } }])).not.toThrow();
  });

  it('drops duplicate rows', () => {
    const csv = 'Gpsnr;pH\n1;6\n1;6\n2;6';
    expect(dedupeRows(parseLabCsv(csv))).toMatchObject({ duplicates: 1 });
  });
});

describe('XLSX', () => {
  const sheetXml = (rows: (string | number)[][]) => {
    const strings: string[] = [];
    const cell = (v: string | number, ref: string) => {
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      strings.push(v);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    };
    const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, `${String.fromCharCode(65 + j)}${i + 1}`)).join('')}</row>`).join('');
    return {
      sheet: `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`,
      shared: `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`,
      strings,
    };
  };

  it('reads the agrolab EXPORT_ASDE sheet', async () => {
    const { sheet, shared } = sheetXml([
      ['Probenummer', 'Schlagnummer', 'Befunddatum', 'pH-Wert', 'Phosphor', 'Gehaltsklasse Phosphor', 'Kalkbedarf dt', 'Labornummer'],
      [12, '0 - 1001 - GL Kummer (2,15 ha)', 45357, '6,1', 6, 'C', 15, 'A-12'],
    ]);
    const xlsx = zip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="EXPORT_ASDE" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(shared) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
    const rows = await parseLabFile('EXPORT_ASDE.xlsx', xlsx);
    expect(rows[0]).toMatchObject({ probeNr: 12, fieldNameHint: 'GL Kummer', date: '2024-03-06', values: { ph: 6.1, p2o5: 13.75 }, stages: { p2o5: 'C' }, labNr: 'A-12' });
  });

  it('parses sheet cells by reference, inline strings included', () => {
    const rows = parseSheet('<sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>x</t></is></c></row><row r="3"><c r="A3"><v>2</v></c></row></sheetData>', []);
    expect(rows).toEqual([[null, 'x'], [], [2]]);
    expect(() => parseLabSheet([['Name']])).toThrow(LabFileError);
  });
});

describe('Probenkarte returned by the lab', () => {
  it('reads the values the lab filled into the sample card', async () => {
    const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[10, 52], [10.001, 52], [10.001, 52.001], [10, 52.001], [10, 52]]]] };
    const rows = sampleCardRows([{ fieldId: 'f', fieldName: 'Am Bach', parcel: '1', areaHa: 1, bodenart: 'sL', geometry, zones: [{ zoneId: 'z', areaHa: 1, probeNr: 5, geometry }] }], '1', '06.03.2024');
    Object.assign(rows[0].record, { P_WERT: formatNumeric(5.2, 10, 8), P_VS: 'C', PH_WERT: formatNumeric(6.3, 10, 8), LABORPRNR: 'L-5' });
    const card = zip(tgisShapefile(rows, SAMPLE_CARD_FIELDS, 'Kunde_PROBEKARTE').map((f) => ({ name: f.name, data: f.data })));
    const delivery = zip([{ name: 'Lieferung/Kunde_PROBEKARTE.zip', data: card }, { name: 'Bericht.pdf', data: Buffer.from('%PDF') }]);
    const parsed = await parseLabFile('Lieferung.zip', delivery);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ probeNr: 5, fieldNameHint: 'Am Bach', date: '2024-03-06', values: { ph: 6.3, p2o5: 11.91 }, stages: { p2o5: 'C' }, labNr: 'L-5' });
    expect(parsed[0].point![0]).toBeCloseTo(10.0005, 4);
    // Zero means "not analysed".
    expect(parsed[0].values.k2o).toBeUndefined();
  });
});
