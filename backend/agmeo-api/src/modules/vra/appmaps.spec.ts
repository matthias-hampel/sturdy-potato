/**
 * Application maps: the reference's rate distribution, export chain (exportChain.test.ts),
 * zone area fractions (utils/area.test.ts), relative-yield spread and uploaded zone files.
 */
import { inflateRawSync } from 'node:zlib';
import {
  BulkVraInput,
  exportRate,
  geometryAreaHa,
  multiplierViolations,
  normalizedRelative,
  plainTargets,
  relativeColor,
  snapRate,
  strategyRates,
  syntheticRelative,
  VraMapInput,
  weightedTargets,
  zoneAreaFractions,
  type VraMapInputView,
} from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { parseGeojson, parseIsoxmlGrid, parseShapefile, zonesFromRated } from './bases/zone-file.js';
import { taskDataXmlMulti } from './export/isoxml.js';
import { prescriptionGeojson, prescriptionShapefile, prescriptionTask, type PrescriptionMap } from './export/prescription.js';
import { polygonShapefile } from './export/shapefile.js';

const GERMINATION = 94;

const square = (x: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 50], [x + 0.001, 50], [x + 0.001, 50.001], [x, 50.001], [x, 50]]],
});
const multi = (p: Polygon): MultiPolygon => ({ type: 'MultiPolygon', coordinates: [p.coordinates] });
const island: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(9).coordinates, square(9.01).coordinates] };

const input = (patch: Partial<VraMapInputView>): VraMapInputView => ({
  id: 'i',
  inputType: 'sowing',
  productId: null,
  productName: null,
  cropId: null,
  cropName: 'Winterweizen',
  name: 'Absint',
  unit: 'plants/ha',
  standardRate: 1_100_000,
  columnName: 'RATE',
  rates: { '1': 1_300_000, '2': 800_000 },
  germinationPct: GERMINATION,
  strategy: 'proportional',
  ...patch,
});

const map = (i: VraMapInputView, type: PrescriptionMap['type'] = 'sowing'): PrescriptionMap => ({
  title: 'Aussaat',
  type,
  unitSystem: 'metric',
  inputs: [i],
  zones: [
    { zoneNo: 1, areaHa: 1, sharePct: 50, relativeProductivity: 130, geometry: multi(square(8)) },
    { zoneNo: 2, areaHa: 1, sharePct: 50, relativeProductivity: 80, geometry: island },
  ],
});

describe('application map export chain', () => {
  it('carries the seed rate the zone table shows, divided by germination exactly once', () => {
    const fc = prescriptionGeojson(map(input({})), { field: 'Nord' }, 'x');
    expect(fc.features.map((f) => f.properties.UNIT)).toEqual(['seeds/ha', 'seeds/ha']);
    expect(fc.features[0].properties.RATE).toBe(Math.round((1_300_000 * 100) / GERMINATION));
    expect(fc.features[1].properties.RATE).toBe(Math.round((800_000 * 100) / GERMINATION));
    // 130 plants/m² at 94 % → 138.3 seeds/m².
    expect(Number(fc.features[0].properties.RATE) / 10_000).toBeCloseTo(138.3, 1);
    // ISO-XML sends the same seed rate (count per area).
    const task = prescriptionTask(map(input({})), { field: 'Nord', farm: 'Hof', organization: 'Org', boundary: square(8), areaHa: 2 });
    expect(task.inputs[0].unit).toBe('seeds/ha');
    expect(task.zones[0].rates[0]).toBe(fc.features[0].properties.RATE);
    expect(task.inputs[0].standardRate).toBe(Math.round((1_100_000 * 100) / GERMINATION));
  });

  it('leaves the rate alone when the zones already hold seed', () => {
    const fc = prescriptionGeojson(map(input({ unit: 'seeds/ha', germinationPct: null })), { field: 'Nord' }, 'x');
    expect(fc.features[0].properties.UNIT).toBe('seeds/ha');
    expect(fc.features[0].properties.RATE).toBe(1_300_000);
  });

  it('hands over the zone geometry untouched, multipart zones included', () => {
    const fc = prescriptionGeojson(map(input({})), { field: 'Nord' }, 'x');
    expect(fc.features[0].geometry).toEqual(multi(square(8)));
    expect(fc.features[1].geometry).toEqual(island);
    expect(fc.features[1].geometry.coordinates).toHaveLength(2);
  });

  it.each([undefined, null, 0])('leaves a target stand untouched when germination is %p', (germination) => {
    expect(exportRate(1_300_000, 'plants/ha', germination)).toEqual({ rate: 1_300_000, unit: 'plants/ha' });
    const fc = prescriptionGeojson(map(input({ germinationPct: germination ?? null })), { field: 'Nord' }, 'x');
    expect(fc.features[0].properties.UNIT).toBe('plants/ha');
    expect(fc.features[0].properties.RATE).toBe(1_300_000);
  });

  it('returns an empty collection for a map without zones', () => {
    const fc = prescriptionGeojson({ ...map(input({ unit: 'kg/ha', inputType: 'fertilizing' }), 'fertilizing'), zones: [] }, { field: 'Nord' }, 'x');
    expect(fc.features).toEqual([]);
  });

  it('keeps fertilizer rates in their own unit, with the product on every zone', () => {
    const m = map(input({ inputType: 'fertilizing', unit: 'kg/ha', name: 'Harnstoff', germinationPct: null, rates: { '1': 130, '2': 80 } }), 'fertilizing');
    const fc = prescriptionGeojson(m, { field: 'Nord' }, 'x');
    expect(fc.features.map((f) => f.properties.UNIT)).toEqual(['kg/ha', 'kg/ha']);
    expect(fc.features.map((f) => f.properties.RATE)).toEqual([130, 80]);
    expect(fc.features.map((f) => f.properties.PRODUCT)).toEqual(['Harnstoff', 'Harnstoff']);
    // The Shapefile carries the same columns.
    const files = prescriptionShapefile(m, 'Nord', 'Nord');
    expect(files.map((f) => f.name)).toEqual(['Nord/Nord.shp', 'Nord/Nord.shx', 'Nord/Nord.dbf', 'Nord/Nord.prj', 'Nord/Nord.cpg']);
    const dbf = files[2].data;
    const fields = Array.from({ length: (dbf.readUInt16LE(8) - 33) / 32 }, (_, i) => dbf.toString('latin1', 32 + i * 32, 43 + i * 32).replace(/\0.*$/, ''));
    expect(fields).toEqual(['RATE', 'ZONE', 'AREA_HA', 'UNIT', 'PRODUCT']);
  });

  it('converts imperial maps after the germination step', () => {
    const fc = prescriptionGeojson({ ...map(input({})), unitSystem: 'imperial' }, { field: 'Nord' }, 'x');
    expect(fc.features[0].properties.UNIT).toBe('seeds/ac');
    expect(Number(fc.features[0].properties.RATE)).toBeCloseTo(Math.round((1_300_000 * 100) / GERMINATION) * 0.40468564, 1);
  });
});

/** Axis-aligned box of `widthDeg` × 0.01° near 52 °N, so areas differ by width. */
const box = (offsetDeg: number, widthDeg: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[10 + offsetDeg, 52], [10 + offsetDeg + widthDeg, 52], [10 + offsetDeg + widthDeg, 52.01], [10 + offsetDeg, 52.01], [10 + offsetDeg, 52]]],
});

describe('zoneAreaFractions', () => {
  it('fractions sum to 1', () => {
    const fractions = zoneAreaFractions([box(0, 0.01), box(0.01, 0.02), box(0.03, 0.03)]);
    expect(fractions).toHaveLength(3);
    expect(fractions.reduce((s, f) => s + f, 0)).toBeCloseTo(1, 10);
  });

  it('a zone twice the width of another gets twice the share', () => {
    const [narrow, wide] = zoneAreaFractions([box(0, 0.01), box(0.02, 0.02)]);
    expect(wide / narrow).toBeCloseTo(2, 3);
    expect(narrow).toBeCloseTo(1 / 3, 3);
  });

  it('an area-weighted mean over the fractions reproduces the field rate', () => {
    const fractions = zoneAreaFractions([box(0, 0.01), box(0.02, 0.03)]);
    const weighted = [120, 40].reduce((s, rate, i) => s + rate * fractions[i], 0);
    expect(weighted).toBeGreaterThan(40);
    expect(weighted).toBeLessThan(120);
  });

  it('zero-area zones give zeros, not NaN; no zones, no fractions', () => {
    expect(zoneAreaFractions([box(0, 0), box(0.01, 0)])).toEqual([0, 0]);
    expect(zoneAreaFractions([])).toEqual([]);
  });

  it('measures geodesic area like turf', () => {
    // 0.01° × 0.01° at 52 °N ≈ 685 m × 1112 m.
    expect(geometryAreaHa(box(0, 0.01))).toBeCloseTo(76.2, 0);
  });
});

describe('rate distribution', () => {
  const zones = [
    { zoneNo: 1, areaHa: 1, relativeProductivity: 40 },
    { zoneNo: 2, areaHa: 2, relativeProductivity: 90 },
    { zoneNo: 3, areaHa: 1, relativeProductivity: 120 },
  ];
  // Area-weighted mean 85 %: relative yields 0.47, 1.06, 1.41.

  it('normalises relative yields to an area-weighted mean of 1', () => {
    const r = normalizedRelative(zones);
    const mean = zones.reduce((s, z) => s + r.get(z.zoneNo)! * z.areaHa, 0) / 4;
    expect(mean).toBeCloseTo(1, 10);
    expect(r.get(2)).toBeCloseTo(90 / 85, 10);
  });

  it('scales the standard rate by yield and clips to 65–135 %', () => {
    expect(strategyRates(zones, 100, 'proportional', 'kg/ha')).toEqual({ '1': 65, '2': 105.88, '3': 135 });
  });

  it('inverts the distribution (compensating strategy)', () => {
    expect(strategyRates(zones, 100, 'inverse', 'kg/ha')).toEqual({ '1': 135, '2': 94.12, '3': 65 });
  });

  it('snaps to the spreader resolution', () => {
    expect(snapRate(123.4, 5)).toBe(125);
    expect(snapRate(123.4, null)).toBe(123.4);
    expect(strategyRates(zones, 103, 'proportional', 'kg/ha', 10)).toEqual({ '1': 70, '2': 110, '3': 140 });
  });

  it('counts zones outside the bounds', () => {
    expect(multiplierViolations({ '1': 60, '2': 100, '3': 140 }, 100)).toBe(2);
    expect(multiplierViolations({ '1': 65, '2': 135 }, 100)).toBe(0);
    expect(multiplierViolations({ '1': 1 }, null)).toBe(0);
  });

  it('colours zones from red to green around the mean', () => {
    expect(relativeColor(65)).toBe('#d73027');
    expect(relativeColor(135)).toBe('#1a9850');
    expect(relativeColor(null)).toBe('#9ca3af');
  });

  it('accepts up to 50 zones and needs a germination rate for a target stand', () => {
    const rates = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [String(i + 1), 1]));
    const ok = VraMapInput.safeParse({ zoningId: '01a14e4b-de8e-7024-a479-9d912166e332', title: 'M', type: 'fertilizing', inputs: [{ inputType: 'fertilizing', name: 'KAS', unit: 'kg/ha', rates }] });
    expect(ok.success).toBe(true);
    const bad = VraMapInput.safeParse({
      zoningId: '01a14e4b-de8e-7024-a479-9d912166e332',
      title: 'M',
      type: 'sowing',
      inputs: [{ inputType: 'sowing', unit: 'plants/ha', standardRate: 300_000, cropId: '01a14e4b-de8e-7024-a479-9d912166e332', rates: { '1': 1 } }],
    });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.message)).toEqual(['A target stand needs the germination rate']);
  });

  it('validates the bulk setup', () => {
    const parsed = BulkVraInput.parse({ type: 'fertilizing', title: '{field} N1', input: { unit: 'kg/ha', standardRate: 150, name: 'KAS' }, fields: [{ fieldId: '01a14e4b-de8e-7024-a479-9d912166e332' }] });
    expect(parsed).toMatchObject({ base: 'default', fallback: 'productivity', strategy: 'proportional', zoneCount: 5 });
  });
});

describe('relative yields of base zonings', () => {
  it('spreads a metric 0.8–1.2 (reference computeRelativeYields)', () => {
    const r = syntheticRelative([
      { key: 1, metric: 2.0, rank: 1 },
      { key: 2, metric: 3.0, rank: 2 },
      { key: 3, metric: 4.0, rank: 3 },
    ]);
    expect([...r.values()]).toEqual([0.8, 1, 1.2].map((v) => expect.closeTo(v, 10)));
    expect(syntheticRelative([{ key: 1, metric: 2, rank: 1 }, { key: 2, metric: 4, rank: 2 }], true).get(1)).toBeCloseTo(1.2, 10);
  });

  it('falls back to the zone order when a metric is missing, and gives a single zone 1', () => {
    const r = syntheticRelative([
      { key: 1, metric: null, rank: 1 },
      { key: 2, metric: 5, rank: 3 },
    ]);
    expect(r.get(1)).toBeCloseTo(0.8, 10);
    expect(r.get(2)).toBeCloseTo(1.2, 10);
    expect(syntheticRelative([{ key: 7, metric: null, rank: 1 }]).get(7)).toBe(1);
  });

  it('weights rate targets by area and averages nutrient targets plainly', () => {
    expect(weightedTargets([{ target: 100, areaHa: 3 }, { target: 200, areaHa: 1 }])).toEqual({ relative: [0.8, 1.6], mean: 125 });
    expect(plainTargets([{ target: 100 }, { target: 200 }])).toEqual({ relative: [100 / 150, 200 / 150], mean: 150 });
    expect(weightedTargets([{ target: 0, areaHa: 1 }]).mean).toBe(0);
  });
});

describe('uploaded zone files', () => {
  const feature = (geometry: Polygon, properties: Record<string, unknown>) => ({ type: 'Feature', geometry, properties });

  it('reads nutrient targets from GeoJSON, one zone per feature, skipping features without the target', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [feature(square(8), { target_n: 120 }), feature(square(8.01), { target_n: 80 }), feature(square(8.02), { target_p2o5: 30 })],
    };
    const r = parseGeojson(JSON.stringify(fc));
    expect(r.ok && { key: r.targetKey, targets: r.zones.map((z) => z.target), dropped: r.dropped }).toEqual({ key: 'target_n', targets: [120, 80], dropped: 1 });
  });

  it('groups a rate column by distinct rate, lowest first', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [feature(square(8), { RATE: 150, ZONE: 1 }), feature(square(8.01), { RATE: 100, ZONE: 2 }), feature(square(8.02), { RATE: 150, ZONE: 3 })],
    };
    const r = parseGeojson(JSON.stringify(fc));
    expect(r.ok && r.zones.map((z) => [z.target, z.geometries.length])).toEqual([
      [100, 1],
      [150, 2],
    ]);
  });

  it('reports what is wrong with a file', () => {
    expect(parseGeojson('{')).toEqual({ ok: false, code: 'not_json' });
    expect(parseGeojson('{"type":"Feature"}')).toEqual({ ok: false, code: 'not_geojson' });
    expect(parseGeojson('{"type":"FeatureCollection","features":[]}')).toEqual({ ok: false, code: 'empty' });
    const noRate = { type: 'FeatureCollection', features: [feature(square(8), { a: 1, b: 2 })] };
    expect(parseGeojson(JSON.stringify(noRate))).toEqual({ ok: false, code: 'no_target' });
    expect(zonesFromRated(Array.from({ length: 51 }, (_, i) => ({ rate: i, geometry: square(8) })))).toBe('too_many_rates');
  });

  it('reads a Shapefile written by our export, rate column included', () => {
    const shape = polygonShapefile(
      [
        { name: 'RATE', length: 14, decimals: 2 },
        { name: 'ZONE', length: 2, decimals: 0 },
        { name: 'UNIT', length: 12, decimals: 0, type: 'C' },
      ],
      [
        { geometry: multi(square(8)), values: { RATE: 140, ZONE: 1, UNIT: 'l/ha' } },
        { geometry: multi(square(8.01)), values: { RATE: 90.5, ZONE: 2, UNIT: 'l/ha' } },
      ],
    );
    const r = parseShapefile(shape.shp, shape.dbf, shape.prj.toString(), null);
    expect(r.ok && { unit: r.unit, targets: r.zones.map((z) => z.target) }).toEqual({ unit: 'l/ha', targets: [90.5, 140] });
    if (r.ok) expect(geometryAreaHa(r.zones[0].geometries[0])).toBeCloseTo(geometryAreaHa(square(8.01)), 3);
  });

  it('reprojects a UTM Shapefile to WGS 84', () => {
    const utm: MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[500000, 5800000], [500100, 5800000], [500100, 5800100], [500000, 5800100], [500000, 5800000]]]] };
    const shape = polygonShapefile([{ name: 'RATE', length: 8, decimals: 1 }], [{ geometry: utm, values: { RATE: 2 } }]);
    const prj = 'PROJCS["ETRS89 / UTM zone 32N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101]]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","25832"]]';
    const r = parseShapefile(shape.shp, shape.dbf, prj, null);
    if (!r.ok) throw new Error(r.code);
    const [lon, lat] = (r.zones[0].geometries[0] as MultiPolygon).coordinates[0][0][0];
    expect(lon).toBeCloseTo(9, 3);
    expect(lat).toBeGreaterThan(52.3);
    expect(geometryAreaHa(r.zones[0].geometries[0])).toBeCloseTo(1, 1);
  });

  it('reads an ISO-XML rate grid of treatment zone codes (type 1) and of values (type 2)', () => {
    const xml = (type: number) => `<?xml version="1.0"?><ISO11783_TaskData>
      <VPN A="VPN1" B="0" C="0.01" D="2" E="kg/ha"/>
      <TSK A="TSK1" B="N" G="1">
        <TZN A="1"><PDV A="0006" B="12000" E="VPN1"/></TZN>
        <TZN A="2"><PDV A="0006" B="9000" E="VPN1"/></TZN>
        <GRD A="52.0" B="10.0" C="0.0001" D="0.0001" E="3" F="2" G="GRD00001" I="${type}" J="1"/>
      </TSK></ISO11783_TaskData>`;
    const codes = Buffer.from([1, 1, 2, 2, 2, 1]);
    const t1 = parseIsoxmlGrid(xml(1), (name) => (name === 'GRD00001' ? codes : null));
    expect(t1.ok && { unit: t1.unit, zones: t1.zones.map((z) => [z.target, z.geometries.length]) }).toEqual({
      unit: 'kg/ha',
      zones: [
        [90, 2],
        [120, 2],
      ],
    });
    const values = Buffer.alloc(24);
    [12000, 12000, 9000, 9000, 9000, 9000].forEach((v, i) => values.writeInt32LE(v, i * 4));
    const t2 = parseIsoxmlGrid(xml(2), () => values);
    expect(t2.ok && t2.zones.map((z) => [z.target, z.geometries.length])).toEqual([
      [90, 2],
      [120, 1],
    ]);
    expect(parseIsoxmlGrid('<ISO11783_TaskData><TSK A="T"/></ISO11783_TaskData>', () => null)).toEqual({ ok: false, code: 'no_grid' });
  });
});

describe('batch ISO-XML', () => {
  it('writes one task per map, sharing farms and products', () => {
    const task = (field: string, farm: string, rate: number) => ({
      farm,
      field: { name: field, areaM2: 10_000, boundary: square(8) },
      task: `N ${field}`,
      inputs: [{ productName: 'KAS', unit: 'kg/ha' as const, standardRate: 150 }],
      zones: [{ zoneNo: 1, geometry: multi(square(8)), rates: [rate] }],
    });
    const xml = taskDataXmlMulti('Org', [task('A', 'Hof', 140), task('B', 'Hof', 160), task('C', 'Feld', 120)]);
    expect(xml.match(/<TSK /g)).toHaveLength(3);
    expect(xml.match(/<PFD /g)).toHaveLength(3);
    expect(xml.match(/<FRM /g)).toHaveLength(2);
    expect(xml.match(/<PDT /g)).toHaveLength(1);
    expect(xml).toContain('<TSK A="TSK2" B="N B" C="CTR1" D="FRM1" E="PFD2" G="1" I="2" J="0">');
    expect(xml).toContain('<PDV A="0006" B="16000" C="PDT1" E="VPN1"/>');
    expect(xml.indexOf('<PDT ')).toBeLessThan(xml.indexOf('<TSK '));
  });
});

// Keeps the zlib import used when debugging zip output by hand.
void inflateRawSync;
