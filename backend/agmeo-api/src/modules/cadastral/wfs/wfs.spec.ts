/**
 * The cadastre WFS client against responses recorded from the state services on 2026-10-19
 * (see __fixtures__): parsing, reprojection, normalization, routing and the request it builds.
 */
import { readFileSync } from 'node:fs';
import { CadastralClient, getFeatureUrl, WfsHttp } from './client.js';
import { parseFeatureCollection, WfsError } from './gml.js';
import { decodeKennzeichen, geodesicAreaM2, normalizeParcel } from './normalize.js';
import { federalStateAt, federalStateFromFlik, resolveFederalState, resolveFederalStates } from './router.js';
import { FEDERAL_STATES, type FederalStateCode } from './states.js';
import { fromUtm, toUtm } from './utm.js';
import { parseXml } from './xml.js';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.xml`, import.meta.url), 'utf8');
const parcelsOf = (code: FederalStateCode, file: string) => {
  const s = FEDERAL_STATES[code];
  return parseFeatureCollection(fixture(file), s.crs).map((r) => normalizeParcel(r, s.schema));
};

describe('UTM', () => {
  // Reference values from PostGIS ST_Transform.
  const cases: [number, number, 'EPSG:25832' | 'EPSG:25833', number, number][] = [
    [9.93, 51.5, 'EPSG:25832', 564553.214, 5705839.191],
    [11.03, 50.98, 'EPSG:25832', 642499.362, 5649562.45],
    [13.4, 52.52, 'EPSG:25833', 391440.032, 5820079.667],
    [14.9, 51.2, 'EPSG:25833', 493013.251, 5672070.778],
    [6.0, 50.8, 'EPSG:25832', 288606.859, 5631875.03],
    [13.0, 48.0, 'EPSG:25832', 798356.818, 5324045.786],
  ];
  it.each(cases)('projects %f,%f to %s', (lon, lat, crs, e, n) => {
    const [x, y] = toUtm([lon, lat], crs);
    expect(Math.abs(x - e)).toBeLessThan(0.01);
    expect(Math.abs(y - n)).toBeLessThan(0.01);
    const [lon2, lat2] = fromUtm([e, n], crs);
    expect(Math.abs(lon2 - lon)).toBeLessThan(1e-7);
    expect(Math.abs(lat2 - lat)).toBeLessThan(1e-7);
  });
});

describe('XML reader', () => {
  it('reads elements, attributes, entities, CDATA and skips comments', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a:x b="1 &amp; 2" c=\'>\'><y>t &lt;3</y><z/><![CDATA[<raw>]]></a:x>')
    const x = doc.children[0]
    expect(x).toMatchObject({ name: 'a:x', local: 'x', attrs: { b: '1 & 2', c: '>' }, text: '<raw>' })
    expect(x.children.map((c) => [c.local, c.text])).toEqual([['y', 't <3'], ['z', '']])
  })
})

describe('federal state routing (ported from router.test.ts)', () => {
  it.each([
    [9.93, 51.5, 'NI'], // Reinshof / Göttingen, not TH
    [9.9, 51.83, 'NI'], // Hoppensen
    [11.03, 50.98, 'TH'], // Erfurt
    [9.99, 53.55, 'HH'], // city state over NI/SH
    [13.4, 52.52, 'BE'], // city state over BB
    [8.8, 53.08, 'HB'], // city state over NI
  ])('routes %f,%f to %s', (lon, lat, code) => {
    expect(federalStateAt(lon, lat)).toBe(code)
  })
  it('prefers the state letters of a FLIK over the position', () => {
    expect(resolveFederalState(11.03, 50.98, 'DENILI1234567890')?.code).toBe('NI')
    // A farm's own field number is no FLIK.
    expect(federalStateFromFlik('NW 12')).toBeNull()
    expect(resolveFederalState(11.03, 50.98, 'NW 12')?.code).toBe('TH')
  })
  it('knows no state outside Germany', () => {
    expect(resolveFederalState(2.35, 48.85)).toBeNull()
  })
})

describe('Flurstückskennzeichen', () => {
  it('decodes Land, Gemarkung, Flur, Zähler and Nenner', () => {
    expect(decodeKennzeichen('036520015000210001__')).toEqual({ districtCode: '036520', sector: '15', numerator: '21', denominator: '1' })
    expect(decodeKennzeichen('145648___00037____00')).toEqual({ districtCode: '145648', sector: null, numerator: '37', denominator: null })
    expect(decodeKennzeichen('11000182000486____')).toEqual({ districtCode: '110001', sector: '820', numerator: '486', denominator: null })
    expect(decodeKennzeichen('foo')).toBeNull()
  })
})

describe('recorded WFS responses', () => {
  it('INSPIRE (Niedersachsen): reference, label, official area, plausible geometry', () => {
    const [p] = parcelsOf('NI', 'ni')
    expect(p).toMatchObject({ officialId: '036520015000210001__', label: 'Gmk. 036520 Flur 15 21/1', sector: '15', numerator: '21', denominator: '1', areaM2: 75240 })
    // Reprojected outline matches the official area (spherical area: within 1 %).
    expect(Math.abs(geodesicAreaM2(p.geometry) / 75240 - 1)).toBeLessThan(0.01)
    const [lon, lat] = p.geometry.coordinates[0][0][0]
    expect(lon).toBeCloseTo(9.93, 1)
    expect(lat).toBeCloseTo(51.5, 1)
  })

  it('INSPIRE curve boundaries (Hamburg) and surface patches (Hessen)', () => {
    const hh = parcelsOf('HH', 'hh')
    expect(hh).toHaveLength(2)
    for (const p of hh) {
      const ring = p.geometry.coordinates[0][0]
      expect(ring[0]).toEqual(ring[ring.length - 1])
      expect(Math.abs(geodesicAreaM2(p.geometry) / p.areaM2 - 1)).toBeLessThan(0.01)
    }
    const he = parcelsOf('HE', 'he')
    expect(he[0]).toMatchObject({ officialId: '06138901000419______', areaM2: 7777 })
    expect(Math.abs(geodesicAreaM2(he[0].geometry) / 7777 - 1)).toBeLessThan(0.01)
  })

  it('AdV simplified (Thüringen): Gemarkung, "Flur 1" prefix, number, holes', () => {
    const th = parcelsOf('TH', 'th')
    expect(th).toHaveLength(3)
    const withHole = th.find((p) => p.geometry.coordinates[0].length > 1)
    expect(withHole).toBeDefined()
    const erfurt = th.find((p) => p.officialId === '160102001001020012__')
    if (erfurt) expect(erfurt).toMatchObject({ district: 'Erfurt-Nord', sector: '1', numerator: '102', denominator: '12', label: 'Erfurt-Nord Flur 1 102/12' })
    for (const p of th) expect(Math.abs(geodesicAreaM2(p.geometry) / p.areaM2 - 1)).toBeLessThan(0.01)
  })

  it('AdV simplified (Sachsen): the Flur inside the Gemarkung name', () => {
    const [p] = parcelsOf('SN', 'sn')
    expect(p).toMatchObject({ officialId: '145648___00037____00', district: 'Schkorlopp', sector: '5', numerator: '37', denominator: null, areaM2: 17720, label: 'Schkorlopp Flur 5 37' })
  })

  it('Bremen (deegree app schema) and Rheinland-Pfalz', () => {
    const [hb] = parcelsOf('HB', 'hb')
    expect(hb).toMatchObject({ officialId: '043351351000160001__', district: 'VR 351', sector: '351', numerator: '16', denominator: '1', areaM2: 20324 })
    const [rp] = parcelsOf('RP', 'rp')
    expect(rp.officialId).toBeTruthy()
    expect(rp.areaM2).toBeGreaterThan(0)
  })

  it('Berlin local schema', () => {
    const [p] = parcelsOf('BE', 'be')
    expect(p).toMatchObject({ officialId: '11000182000486____', district: 'Mitte', sector: '820', numerator: '486', denominator: null, areaM2: 161, label: 'Mitte Flur 820 486' })
  })

  it('reports service exceptions and empty collections', () => {
    const report = '<?xml version="1.0"?><ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Exception exceptionCode="InvalidParameterValue"><ows:ExceptionText>bad bbox</ows:ExceptionText></ows:Exception></ows:ExceptionReport>'
    expect(() => parseFeatureCollection(report, 'EPSG:25832')).toThrow(WfsError)
    expect(() => parseFeatureCollection(report, 'EPSG:25832')).toThrow(/bad bbox/)
    expect(parseFeatureCollection('<wfs:FeatureCollection numberReturned="0"/>', 'EPSG:25833')).toEqual([])
  })
})

describe('client', () => {
  const ni = FEDERAL_STATES.NI
  const bbox = { west: 9.928, south: 51.499, east: 9.932, north: 51.501 }

  it('asks for the box in the state CRS with a margin', () => {
    const url = new URL(getFeatureUrl(ni, bbox))
    expect(url.origin + url.pathname).toBe(ni.wfsUrl)
    expect(url.searchParams.get('typeNames')).toBe('cp:CadastralParcel')
    expect(url.searchParams.get('srsName')).toBe('urn:ogc:def:crs:EPSG::25832')
    const [minx, miny, maxx, maxy] = url.searchParams.get('bbox')!.split(',').map(Number)
    const [x, y] = toUtm([9.93, 51.5], 'EPSG:25832')
    expect(minx).toBeLessThan(x)
    expect(maxx).toBeGreaterThan(x)
    expect(miny).toBeLessThan(y)
    expect(maxy).toBeGreaterThan(y)
  })

  it('caches responses and refuses blocked states without a request', async () => {
    const calls: string[] = []
    const http = { get: async (url: string) => (calls.push(url), fixture('ni')) } as WfsHttp
    const client = new CadastralClient(http)
    const first = await client.parcels(ni, bbox)
    const second = await client.parcels(ni, bbox)
    expect(first).toHaveLength(3)
    expect(second).toBe(first)
    expect(calls).toHaveLength(1)
    await expect(client.parcels(FEDERAL_STATES.BY, bbox)).rejects.toMatchObject({ kind: 'no_access' })
    expect(calls).toHaveLength(1)
  })

  it('passes on unavailable services', async () => {
    const client = new CadastralClient({ get: async () => { throw new WfsError('unavailable', 'HTTP 503') } } as unknown as WfsHttp)
    await expect(client.parcels(ni, bbox)).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('overlapping state extents', () => {
  it('lists every state that may hold a point, most likely first', () => {
    // South of Göttingen lies in the extents of both Hessen and Niedersachsen.
    const codes = resolveFederalStates(9.908, 51.463).map((s) => s.code)
    expect(codes).toEqual(expect.arrayContaining(['HE', 'NI']))
    expect(resolveFederalStates(9.99, 53.55)[0].code).toBe('HH')
    expect(resolveFederalStates(9.908, 51.463, 'DENILI0000000001')[0].code).toBe('NI')
  })
})
