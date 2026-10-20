import type { MultiPolygon } from 'geojson';
import { inflateSync } from 'node:zlib';
import { PdfDoc } from './pdf.js';
import { resultsPdf, zonationPdf } from './sheets.js';
import { CONTOUR_FIELDS, contourRows, formatNullableNumeric, formatNumeric, parcelNumber, SAMPLE_CARD_FIELDS, sampleCardRows, tgisShapefile } from './tgis.js';

const square = (x: number, y: number, d: number): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: [[[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]],
});

const field = {
  fieldId: 'f1',
  fieldName: 'Großer Schlag am Bach',
  parcel: '12/3',
  areaHa: 4.2,
  bodenart: 'sL',
  geometry: square(10, 52, 0.002),
  zones: [
    { zoneId: 'z1', areaHa: 2.1, probeNr: 7, geometry: square(10, 52, 0.001) },
    { zoneId: 'z2', areaHa: 2.1, probeNr: 8, geometry: square(10.001, 52, 0.001) },
  ],
};

describe('TGIS sample card', () => {
  it('formats numbers like the lab template', () => {
    expect(formatNumeric(0, 10, 8)).toBe('0.00000000');
    expect(formatNumeric(123.456, 10, 8)).toBe('123.456000');
    expect(formatNullableNumeric(null, 10, 0)).toBe('**********');
    expect(formatNullableNumeric(12, 10, 0)).toBe('        12');
    expect(parcelNumber('12/3')).toBe('12-3');
    expect(parcelNumber('12')).toBe('12-0');
    expect(parcelNumber('A-12')).toBe('A-12');
  });

  it('writes one PROBEKARTE row per zone with empty analysis columns', () => {
    const rows = sampleCardRows([field], '4711', '01.03.2026');
    expect(rows.map((r) => r.record.PROBENUMME)).toEqual(['7', '8']);
    expect(rows[0].record).toMatchObject({ ID: '1', SCHLAGNUMM: '12-3', SCHLAGNAME: 'Großer Schlag a', KUNDE: '4711', BODENART: 'sL', P_VS: '?', P_WERT: '0.00000000' });
    expect(SAMPLE_CARD_FIELDS.map((f) => f.name)).toContain('MG_EMPFEHL');
    expect(SAMPLE_CARD_FIELDS.every((f) => f.name.length <= 10)).toBe(true);

    const files = tgisShapefile(rows, SAMPLE_CARD_FIELDS, 'X_PROBEKARTE');
    expect(files.map((f) => f.name)).toEqual(['X_PROBEKARTE.shp', 'X_PROBEKARTE.shx', 'X_PROBEKARTE.dbf', 'X_PROBEKARTE.prj']);
    const dbf = files[2].data;
    const headerSize = dbf.readUInt16LE(8);
    const recordSize = dbf.readUInt16LE(10);
    expect(dbf.readUInt32LE(4)).toBe(2);
    expect(recordSize).toBe(1 + SAMPLE_CARD_FIELDS.reduce((s, f) => s + f.length, 0));
    expect(dbf.length).toBe(headerSize + 2 * recordSize);
    // Latin-1 text for the lab's importers.
    expect(dbf.includes(Buffer.from('Großer', 'latin1'))).toBe(true);
    const shp = files[0].data;
    expect(shp.readInt32BE(0)).toBe(9994);
    expect(shp.readInt32BE(24) * 2).toBe(shp.length);
  });

  it('writes one CONTOUR row per field', () => {
    const rows = contourRows([field], 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].record).toMatchObject({ NUMMER: '        12', TEILNUM: '         3', ERNTEJAHR: '      2026' });
    expect(Object.keys(rows[0].record)).toEqual(CONTOUR_FIELDS.map((f) => f.name));
  });
});

describe('PDF', () => {
  const objects = (pdf: Buffer) => pdf.toString('latin1');

  it('writes a valid cross-reference table and escapes text', () => {
    const doc = new PdfDoc();
    doc.text('Ölrettich (Zwischenfrucht) – 5 €', 20, 20);
    doc.addPage().text('Seite 2', 20, 20);
    const pdf = doc.toBuffer({ title: 'Test' });
    const text = objects(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)![1];
    const content = inflateSync(Buffer.from(stream, 'latin1')).toString('latin1');
    expect(content).toContain('\\(Zwischenfrucht\\)');
    expect(content).toContain('\\226'); // en dash in WinAnsi
  });

  it('measures and fits text', () => {
    const doc = new PdfDoc();
    expect(doc.textWidth('iii', 10)).toBeLessThan(doc.textWidth('WWW', 10));
    expect(doc.fit('A very long field name that does not fit', 60, 10).endsWith('…')).toBe(true);
  });

  it('draws zonation and results sheets, one page per field plus the overview', () => {
    const sheetField = {
      name: field.fieldName,
      areaHa: field.areaHa,
      soilType: 'sL',
      geometry: field.geometry,
      zones: field.zones.map((z, i) => ({
        label: `Zone ${i + 1}`,
        color: '#22c55e',
        areaHa: z.areaHa,
        probeNr: z.probeNr,
        geometry: z.geometry,
        point: [10.0005 + i * 0.001, 52.0005] as [number, number],
        values: { ph: 6.2, p2o5: 14 },
        classes: { ph: 'C', p2o5: 'C' },
        sampledOn: '2026-03-01',
      })),
    };
    const zonation = objects(zonationPdf([sheetField], [{ ...sheetField, name: 'Ohne', zones: [] }], { orgName: 'Hof', date: '2026-03-02' }));
    expect(zonation).toContain('/Count 2');
    const results = objects(resultsPdf([sheetField], ['ph', 'p2o5'], { orgName: 'Hof', date: '2026-03-02', paramLabel: (p) => p }));
    expect(results).toContain('/Count 2');
  });
});
