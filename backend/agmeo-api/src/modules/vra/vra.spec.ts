import { inflateRawSync } from 'node:zlib';
import {
  columnNameFrom,
  defaultRates,
  defaultZoneRate,
  presetRate,
  roundRate,
  VraMapInput,
  vraFileName,
  vraInputTotals,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { taskDataXml } from './export/isoxml.js';
import { polygonShapefile } from './export/shapefile.js';
import { zip } from './export/zip.js';

describe('VRA rate maths', () => {
  it('scales the standard rate by zone productivity', () => {
    expect(defaultZoneRate(200, 93.74, 'kg/ha')).toBe(187.48);
    expect(defaultZoneRate(180, 103.333, 'l/ha')).toBe(186);
    expect(defaultZoneRate(200, null, 'kg/ha')).toBe(200);
  });

  it('rounds seeds and values from 1000 up to whole numbers, otherwise to two decimals', () => {
    expect(roundRate(123.456, 'kg/ha')).toBe(123.46);
    expect(roundRate(999.994, 'kg/ha')).toBe(999.99);
    expect(roundRate(1000.4, 'kg/ha')).toBe(1000);
    expect(roundRate(45.6, 'seeds/ha')).toBe(46);
    expect(defaultZoneRate(350_000, 96.55, 'seeds/ha')).toBe(337_925);
  });

  it('applies presets', () => {
    expect(presetRate(200, 10, 'kg/ha')).toBe(220);
    expect(presetRate(200, -30, 'kg/ha')).toBe(140);
    expect(presetRate(333.33, 5, 'kg/ha')).toBe(350);
    expect(presetRate(350_000, -15, 'seeds/ha')).toBe(297_500);
  });

  it('totals rates over zone areas and reports savings above 0.1 only', () => {
    const zones = [
      { zoneNo: 1, areaHa: 1, relativeProductivity: 90 },
      { zoneNo: 2, areaHa: 2, relativeProductivity: 105 },
    ];
    const rates = defaultRates(100, zones, 'kg/ha');
    expect(rates).toEqual({ '1': 90, '2': 105 });
    const t = vraInputTotals({ standardRate: 100, rates }, zones, 3);
    expect(t.total).toBe(300);
    expect(t.flatTotal).toBe(300);
    expect(t.showSavings).toBe(false);
    const lower = vraInputTotals({ standardRate: 100, rates: { '1': 80, '2': 100 } }, zones, 3);
    expect(lower.savings).toBe(20);
    expect(lower.showSavings).toBe(true);
    expect(vraInputTotals({ standardRate: null, rates }, zones, 3).savings).toBeNull();
  });

  it('derives column and file names', () => {
    expect(columnNameFrom('Kalkammonsalpeter 27')).toBe('KALKAM');
    expect(columnNameFrom('N-2')).toBe('N2');
    expect(vraFileName('Nordweide', 'fertilizing', '2026-10-18')).toBe('Nordweide_VRA_fertilizing_2026-10-18');
    const long = vraFileName('Großer Schlag hinter dem Wald an der Landstraße Richtung Oldenburg', 'several', '2026-10-18');
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('_VRA_several_2026-10-18')).toBe(true);
    expect(long.startsWith('Grosser_Schlag')).toBe(true);
  });
});

describe('VRA map validation', () => {
  const base = { zoningId: '01a14e4b-de8e-7024-a479-9d912166e332', title: 'Map' };
  const rates = { '1': 1, '2': 2, '3': 3 };
  const errors = (input: object) => {
    const r = VraMapInput.safeParse({ ...base, ...input });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('needs a standard rate and a crop for sowing', () => {
    expect(errors({ type: 'sowing', inputs: [{ inputType: 'sowing', unit: 'seeds/ha', rates }] })).toEqual([
      'Sowing needs a standard rate above 0',
      'Sowing needs a crop',
    ]);
    expect(
      errors({ type: 'sowing', inputs: [{ inputType: 'sowing', unit: 'seeds/ha', standardRate: 300_000, cropId: base.zoningId, rates }] }),
    ).toEqual([]);
  });

  it('needs a product name for fertilizing and spraying, and a fitting unit', () => {
    expect(errors({ type: 'fertilizing', inputs: [{ inputType: 'fertilizing', unit: 'kg/ha', rates }] })).toEqual(['Enter the product name']);
    expect(errors({ type: 'spraying', inputs: [{ inputType: 'spraying', name: 'X', unit: 'seeds/ha', rates }] })).toEqual([
      'Unit seeds/ha does not fit spraying',
    ]);
  });

  it('needs unique short column names for several inputs', () => {
    const input = (columnName?: string) => ({ inputType: 'fertilizing', name: 'KAS', unit: 'kg/ha', columnName, rates });
    expect(errors({ type: 'several', inputs: [input('a1'), input('A1')] })).toEqual(['Column names must be unique']);
    expect(errors({ type: 'several', inputs: [input('KAS'), input()] })).toEqual(['Each input needs a column name']);
    expect(errors({ type: 'several', inputs: [input('TOOLONG'), input('B')] })).toEqual(['Up to six letters or digits']);
    expect(errors({ type: 'several', inputs: [input('KAS')] })).toEqual(['A map with several inputs needs at least two']);
    const ok = VraMapInput.parse({ ...base, type: 'several', inputs: [input('kas'), input('ahl')] });
    expect(ok.inputs.map((i) => i.columnName)).toEqual(['KAS', 'AHL']);
  });
});

/** Reads the entries of a zip written by `zip()`. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength;
    out[name] = inflateRawSync(buf.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

describe('prescription export', () => {
  // A square with a hole, counter-clockwise exterior as in GeoJSON.
  const square: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [[7, 53], [7.01, 53], [7.01, 53.01], [7, 53.01], [7, 53]],
        [[7.004, 53.004], [7.004, 53.006], [7.006, 53.006], [7.006, 53.004], [7.004, 53.004]],
      ],
    ],
  };

  it('writes a polygon Shapefile with clockwise outer rings and numeric attributes', () => {
    const shp = polygonShapefile(
      [
        { name: 'RATE', length: 14, decimals: 2 },
        { name: 'ZONE', length: 2, decimals: 0 },
      ],
      [{ geometry: square, values: { RATE: 187.48, ZONE: 1 } }],
    );
    expect(shp.shp.readInt32BE(0)).toBe(9994);
    expect(shp.shp.readInt32BE(24) * 2).toBe(shp.shp.length);
    expect(shp.shx.readInt32BE(24) * 2).toBe(shp.shx.length);
    expect(shp.shp.readInt32LE(100 + 8)).toBe(5);
    expect(shp.shp.readInt32LE(108 + 36)).toBe(2); // parts
    // The first ring now runs clockwise: (7,53) → (7,53.01).
    const first = 108 + 44 + 8;
    expect([shp.shp.readDoubleLE(first + 16), shp.shp.readDoubleLE(first + 24)]).toEqual([7, 53.01]);
    expect(shp.dbf.readUInt32LE(4)).toBe(1);
    const header = shp.dbf.readUInt16LE(8);
    expect(shp.dbf.toString('ascii', header, header + 1 + 16)).toBe(`         187.48 1`);
    expect(shp.prj.toString()).toContain('GCS_WGS_1984');

    const files = unzip(zip([{ name: 'a.shp', data: shp.shp }, { name: 'a.dbf', data: shp.dbf }]));
    expect(files['a.shp'].equals(shp.shp)).toBe(true);
    expect(files['a.dbf'].equals(shp.dbf)).toBe(true);
  });

  it('writes ISO-XML treatment zones with SI process data', () => {
    const xml = taskDataXml({
      customer: 'Hof & Co',
      farm: 'Marschhof',
      field: { name: 'Nordweide', areaM2: 42130, boundary: square },
      task: 'N1',
      inputs: [
        { productName: 'KAS', unit: 'kg/ha', standardRate: 200 },
        { productName: 'AHL', unit: 'l/ha', standardRate: 100 },
        { productName: 'Weizen', unit: 'seeds/ha', standardRate: 350_000 },
      ],
      zones: [{ zoneNo: 1, geometry: square, rates: [187.48, 90, 337_925] }],
    });
    expect(xml).toContain('<CTR A="CTR1" B="Hof &amp; Co"/>');
    expect(xml).toContain('<PDV A="0006" B="18748" C="PDT1" E="VPN1"/>');
    expect(xml).toContain('<PDV A="0001" B="900000" C="PDT2" E="VPN2"/>');
    expect(xml).toContain('<PDV A="000B" B="33793" C="PDT3" E="VPN3"/>');
    expect(xml).toContain('<TZN A="2" B="Standard rate"><PDV A="0006" B="20000"');
    expect(xml).toContain('<TSK A="TSK1" B="N1" C="CTR1" D="FRM1" E="PFD1" G="1" I="2" J="0">');
    expect(xml.match(/<LSG A="2">/g)).toHaveLength(2); // the hole, in the boundary and in the zone
  });
});
