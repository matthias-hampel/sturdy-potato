/**
 * Coordinate systems of yield-map exports, offline and without proj4.
 *
 * Harvest-monitor exports in Central Europe come in a handful of systems, all of them either
 * geographic or Transverse Mercator: WGS 84 / ETRS89 lon/lat, UTM (ETRS89 or WGS 84, also with
 * the zone prefix "zE-N"), Gauss-Krüger on the Bessel ellipsoid (DHDN, with its 7-parameter
 * shift), the Polish CS92/CS2000 grids and, rarely, Web Mercator. Transverse Mercator is
 * computed with Krüger's series (6th order, sub-millimetre within a zone).
 *
 * Resolution order (as in the reference app): the EPSG code the .prj declares, then the WKT's
 * own Transverse Mercator parameters, then a range heuristic on the coordinates. Anything left
 * unresolved is an error, never a silent guess.
 */

export interface Ellipsoid {
  a: number;
  /** Inverse flattening. */
  rf: number;
}

export const GRS80: Ellipsoid = { a: 6_378_137, rf: 298.257222101 };
export const WGS84: Ellipsoid = { a: 6_378_137, rf: 298.257223563 };
export const BESSEL: Ellipsoid = { a: 6_377_397.155, rf: 299.1528128 };

/** Position-vector 7-parameter shift to WGS 84 (proj's towgs84): metres, arc seconds, ppm. */
export type ToWgs84 = [number, number, number, number, number, number, number];
const DHDN_TO_WGS84: ToWgs84 = [598.1, 73.7, 418.2, 0.202, 0.045, -2.455, 6.7];

export interface TmParams {
  ellipsoid: Ellipsoid;
  lon0: number;
  lat0: number;
  k0: number;
  x0: number;
  y0: number;
  towgs84?: ToWgs84;
}

export type CrsDef =
  | { kind: 'geographic'; towgs84?: ToWgs84; ellipsoid?: Ellipsoid }
  | { kind: 'mercator' }
  | ({ kind: 'tm' } & TmParams);

export interface ResolvedCrs {
  def: CrsDef;
  /** "EPSG:25832" when known. */
  epsg: string | null;
  source: 'prj' | 'prj-wkt' | 'detected' | 'assumed4326';
}

export class UnsupportedCrsError extends Error {}

const DEG = Math.PI / 180;

const utm = (zone: number, ellipsoid: Ellipsoid, south = false, prefix = false): CrsDef => ({
  kind: 'tm',
  ellipsoid,
  lon0: zone * 6 - 183,
  lat0: 0,
  k0: 0.9996,
  x0: prefix ? zone * 1_000_000 + 500_000 : 500_000,
  y0: south ? 10_000_000 : 0,
});
const gk = (zone: number): CrsDef => ({ kind: 'tm', ellipsoid: BESSEL, lon0: zone * 3, lat0: 0, k0: 1, x0: zone * 1_000_000 + 500_000, y0: 0, towgs84: DHDN_TO_WGS84 });

/** The systems known by code. */
export function crsByEpsg(code: number): CrsDef | null {
  if (code === 4326 || code === 4258) return { kind: 'geographic' };
  if (code === 3857 || code === 900913) return { kind: 'mercator' };
  if (code >= 25828 && code <= 25838) return utm(code - 25800, GRS80);
  if (code === 3044 || code === 3045) return utm(code - 3012, GRS80);
  if (code >= 32601 && code <= 32660) return utm(code - 32600, WGS84);
  if (code >= 32701 && code <= 32760) return utm(code - 32700, WGS84, true);
  if (code === 4647) return utm(32, GRS80, false, true);
  if (code === 5650) return utm(33, GRS80, false, true);
  if (code >= 31466 && code <= 31469) return gk(code - 31464);
  if (code === 2180) return { kind: 'tm', ellipsoid: GRS80, lon0: 19, lat0: 0, k0: 0.9993, x0: 500_000, y0: -5_300_000 };
  if (code >= 2176 && code <= 2179) {
    const zone = code - 2171;
    return { kind: 'tm', ellipsoid: GRS80, lon0: zone * 3, lat0: 0, k0: 0.999923, x0: zone * 1e6 + 500_000, y0: 0 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transverse Mercator (Krüger series)
// ---------------------------------------------------------------------------

interface TmCoefficients {
  e: number;
  A: number;
  alpha: number[];
  beta: number[];
  delta: number[];
}

const coefficientCache = new Map<Ellipsoid, TmCoefficients>();

function coefficients(ell: Ellipsoid): TmCoefficients {
  const cached = coefficientCache.get(ell);
  if (cached) return cached;
  const f = 1 / ell.rf;
  const n = f / (2 - f);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const n5 = n4 * n;
  const n6 = n5 * n;
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    0,
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
    (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
    (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
    (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
    (212378941 / 319334400) * n6,
  ];
  const beta = [
    0,
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
    (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
    (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
    (4583 / 161280) * n5 - (108847 / 3991680) * n6,
    (20648693 / 638668800) * n6,
  ];
  // Conformal latitude → geodetic latitude.
  const delta = [
    0,
    2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4 + (26 / 45) * n5 - (2854 / 675) * n6,
    (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4 + (2704 / 315) * n5 + (2323 / 945) * n6,
    (56 / 15) * n3 - (136 / 35) * n4 - (1262 / 105) * n5 + (73814 / 2835) * n6,
    (4279 / 630) * n4 - (332 / 35) * n5 - (399572 / 14175) * n6,
    (4174 / 315) * n5 - (144838 / 6237) * n6,
    (601676 / 22275) * n6,
  ];
  const e = Math.sqrt(f * (2 - f));
  const c = { e, A, alpha, beta, delta };
  coefficientCache.set(ell, c);
  return c;
}

/** Geodetic lon/lat (degrees, on the projection's ellipsoid) → easting/northing. */
export function tmForward(p: TmParams, lon: number, lat: number): [number, number] {
  const { e, A, alpha } = coefficients(p.ellipsoid);
  const phi = lat * DEG;
  const lambda = (lon - p.lon0) * DEG;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 6; j++) {
    xi += alpha[j] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += alpha[j] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const m0 = p.lat0 === 0 ? 0 : meridianArc(p, p.lat0);
  return [p.x0 + p.k0 * A * eta, p.y0 + p.k0 * (A * xi - m0)];
}

/** Easting/northing → geodetic lon/lat (degrees, on the projection's ellipsoid). */
export function tmInverse(p: TmParams, x: number, y: number): [number, number] {
  const { A, beta, delta } = coefficients(p.ellipsoid);
  const m0 = p.lat0 === 0 ? 0 : meridianArc(p, p.lat0);
  const xi = ((y - p.y0) / p.k0 + m0) / A;
  const eta = (x - p.x0) / (p.k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 6; j++) {
    xiP -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 6; j++) phi += delta[j] * Math.sin(2 * j * chi);
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return [p.lon0 + lambda / DEG, phi / DEG];
}

/** Meridian arc from the equator (only for a false origin away from the equator). */
function meridianArc(p: TmParams, lat0: number): number {
  const [, y] = tmForward({ ...p, lat0: 0, x0: 0, y0: 0, k0: 1 }, p.lon0, lat0);
  return y;
}

// ---------------------------------------------------------------------------
// Datum shift (Helmert, position vector)
// ---------------------------------------------------------------------------

function toEcef(ell: Ellipsoid, lon: number, lat: number): [number, number, number] {
  const f = 1 / ell.rf;
  const e2 = f * (2 - f);
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const N = ell.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [N * Math.cos(phi) * Math.cos(lambda), N * Math.cos(phi) * Math.sin(lambda), N * (1 - e2) * Math.sin(phi)];
}

function fromEcef(ell: Ellipsoid, x: number, y: number, z: number): [number, number] {
  const f = 1 / ell.rf;
  const e2 = f * (2 - f);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const N = ell.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * N * Math.sin(phi), p);
  }
  return [Math.atan2(y, x) / DEG, phi / DEG];
}

/** lon/lat on `ell` → WGS 84 lon/lat with the given shift. */
export function shiftToWgs84(ell: Ellipsoid, shift: ToWgs84, lon: number, lat: number): [number, number] {
  const [x, y, z] = toEcef(ell, lon, lat);
  const [dx, dy, dz, rxS, ryS, rzS, ppm] = shift;
  const rad = DEG / 3600;
  const rx = rxS * rad;
  const ry = ryS * rad;
  const rz = rzS * rad;
  const s = 1 + ppm * 1e-6;
  const X = dx + s * (x - rz * y + ry * z);
  const Y = dy + s * (rz * x + y - rx * z);
  const Z = dz + s * (-ry * x + rx * y + z);
  return fromEcef(WGS84, X, Y, Z);
}

/** Inverse of shiftToWgs84 (by fixed-point iteration; the shift is a few hundred metres). */
export function shiftFromWgs84(ell: Ellipsoid, shift: ToWgs84, lon: number, lat: number): [number, number] {
  let guess: [number, number] = [lon, lat];
  for (let i = 0; i < 4; i++) {
    const [l, p] = shiftToWgs84(ell, shift, guess[0], guess[1]);
    guess = [guess[0] + (lon - l), guess[1] + (lat - p)];
  }
  return guess;
}

// ---------------------------------------------------------------------------
// Transformers
// ---------------------------------------------------------------------------

const R_MERC = 6_378_137;

/** Converter from the CRS to WGS 84 lon/lat; null when it already is lon/lat. */
export function toLonLat(def: CrsDef): ((x: number, y: number) => [number, number]) | null {
  if (def.kind === 'geographic') {
    if (!def.towgs84 || !def.ellipsoid) return null;
    const { ellipsoid, towgs84 } = def;
    return (x, y) => shiftToWgs84(ellipsoid, towgs84, x, y);
  }
  if (def.kind === 'mercator') return (x, y) => [x / R_MERC / DEG, (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) / DEG];
  return (x, y) => {
    const [lon, lat] = tmInverse(def, x, y);
    return def.towgs84 ? shiftToWgs84(def.ellipsoid, def.towgs84, lon, lat) : [lon, lat];
  };
}

/** Converter from WGS 84 lon/lat to the CRS. */
export function fromLonLat(def: CrsDef): (lon: number, lat: number) => [number, number] {
  if (def.kind === 'geographic') return (lon, lat) => [lon, lat];
  if (def.kind === 'mercator') return (lon, lat) => [lon * DEG * R_MERC, Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) * R_MERC];
  return (lon, lat) => {
    const [l, p] = def.towgs84 ? shiftFromWgs84(def.ellipsoid, def.towgs84, lon, lat) : [lon, lat];
    return tmForward(def, l, p);
  };
}

// ---------------------------------------------------------------------------
// WKT and detection
// ---------------------------------------------------------------------------

/** The EPSG code of the outermost AUTHORITY/ID of a WKT1/WKT2 string. */
export function epsgFromWkt(wkt: string): number | null {
  // The last AUTHORITY of a WKT1 string belongs to the outermost CRS.
  const wkt1 = [...wkt.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  const wkt2 = [...wkt.matchAll(/\bID\s*\[\s*"EPSG"\s*,\s*(\d+)\s*\]/gi)];
  const last = [...wkt1, ...wkt2].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).at(-1);
  if (last) return Number(last[1]);
  // ESRI .prj files carry no authority; their names are well-known.
  const name = wkt.match(/^\s*(?:PROJCS|PROJCRS)\s*\[\s*"([^"]+)"/i)?.[1] ?? '';
  const utmName = name.match(/(ETRS_?1989|ETRS89|WGS_?1984|WGS 84)[_ /]+UTM[_ ]+zone[_ ]+(\d+)([NS])/i);
  if (utmName) {
    const zone = Number(utmName[2]);
    if (/ETRS/i.test(utmName[1])) return 25800 + zone;
    return (utmName[3].toUpperCase() === 'S' ? 32700 : 32600) + zone;
  }
  const gkName = name.match(/DHDN.*(?:Gauss|GK).*?(\d)\s*$/i) ?? name.match(/DHDN.*Zone[_ ]+(\d)/i);
  if (gkName) return 31464 + Number(gkName[1]);
  if (/^\s*GEOGCS\s*\[\s*"(GCS_WGS_1984|WGS 84|WGS84)"/i.test(wkt)) return 4326;
  if (/^\s*GEOGCS\s*\[\s*"(GCS_ETRS_1989|ETRS89)"/i.test(wkt)) return 4258;
  return null;
}

/** Transverse Mercator parameters read from a WKT1 PROJCS, when it is one. */
export function tmFromWkt(wkt: string): CrsDef | null {
  if (!/^\s*PROJCS/i.test(wkt)) return null;
  if (!/PROJECTION\s*\[\s*"(Transverse_Mercator|Gauss_Kruger)"/i.test(wkt)) return null;
  const spheroid = wkt.match(/SPHEROID\s*\[\s*"[^"]*"\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!spheroid) return null;
  const param = (name: string, fallback: number) => {
    const m = wkt.match(new RegExp(`PARAMETER\\s*\\[\\s*"${name}"\\s*,\\s*(-?[\\d.eE+-]+)`, 'i'));
    return m ? Number(m[1]) : fallback;
  };
  // In a WKT1 PROJCS the last UNIT is the linear unit; only metres are supported.
  const unit = [...wkt.matchAll(/UNIT\s*\[\s*"[^"]*"\s*,\s*([\d.eE+-]+)/gi)].at(-1);
  if (unit && Math.abs(Number(unit[1]) - 1) > 1e-9) return null;
  const towgs = wkt.match(/TOWGS84\s*\[([^\]]+)\]/i)?.[1].split(',').map(Number);
  const ellipsoid = { a: Number(spheroid[1]), rf: Number(spheroid[2]) };
  const isBessel = Math.abs(ellipsoid.a - BESSEL.a) < 1e-2;
  const shift: ToWgs84 | undefined =
    towgs && towgs.length >= 3 && towgs.some((v) => v !== 0)
      ? ([...towgs, 0, 0, 0, 0].slice(0, 7) as ToWgs84)
      : isBessel
        ? DHDN_TO_WGS84
        : undefined;
  return {
    kind: 'tm',
    ellipsoid: isBessel ? BESSEL : Math.abs(ellipsoid.rf - GRS80.rf) < 1e-6 ? GRS80 : Math.abs(ellipsoid.rf - WGS84.rf) < 1e-6 ? WGS84 : ellipsoid,
    lon0: param('central_meridian', 0),
    lat0: param('latitude_of_origin', 0),
    k0: param('scale_factor', 1),
    x0: param('false_easting', 0),
    y0: param('false_northing', 0),
    towgs84: shift,
  };
}

const LON_LIMIT = 180.5;
const LAT_LIMIT = 90.5;
export const looksLikeLonLat = (coords: [number, number][]): boolean =>
  coords.length > 0 && coords.every(([x, y]) => Math.abs(x) <= LON_LIMIT && Math.abs(y) <= LAT_LIMIT);

/** Germany to Poland, generous margins. */
const CENTRAL_EUROPE = { minLon: 4, maxLon: 25, minLat: 46, maxLat: 56 };

/**
 * The likely CRS of projected coordinates without a .prj: Gauss-Krüger and prefixed UTM carry
 * their zone in the easting; plain UTM is placed in the zone nearest to `near` (the field the
 * map belongs to), else zone 32, the most common one in Germany.
 */
export function detectCrs(sample: [number, number][], near?: [number, number] | null): number | null {
  if (!sample.length) return null;
  const xs = sample.map((p) => p[0]);
  const ys = sample.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (minY < 5_000_000 || maxY > 6_300_000) return null;
  for (const zone of [2, 3, 4, 5]) {
    if (minX >= zone * 1e6 + 300_000 && maxX <= zone * 1e6 + 800_000) return 31464 + zone;
  }
  if (minX >= 32_100_000 && maxX <= 32_900_000) return 4647;
  if (minX >= 33_100_000 && maxX <= 33_900_000) return 5650;
  if (minX < 100_000 || maxX > 900_000) return null;
  const candidates = [25832, 25833, 25834, 25835, 25831];
  const centre: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  let best: { code: number; distance: number } | null = null;
  for (const code of candidates) {
    const [lon, lat] = toLonLat(crsByEpsg(code)!)!(centre[0], centre[1]);
    if (lon < CENTRAL_EUROPE.minLon || lon > CENTRAL_EUROPE.maxLon || lat < CENTRAL_EUROPE.minLat || lat > CENTRAL_EUROPE.maxLat) continue;
    if (!near) return code;
    const distance = Math.hypot((lon - near[0]) * Math.cos(lat * DEG), lat - near[1]);
    if (!best || distance < best.distance) best = { code, distance };
  }
  return best?.code ?? null;
}

/**
 * The CRS of a shapefile set. `sample` is a handful of raw coordinates from the set; `near`
 * the lon/lat the map is expected at (the field), used only to choose between UTM zones.
 */
export function resolveCrs(prjWkt: string | null, sample: [number, number][], near?: [number, number] | null): ResolvedCrs {
  if (prjWkt?.trim()) {
    const code = epsgFromWkt(prjWkt);
    if (code) {
      const def = crsByEpsg(code);
      if (def) return { def, epsg: `EPSG:${code}`, source: 'prj' };
    }
    const tm = tmFromWkt(prjWkt);
    if (tm) return { def: tm, epsg: code ? `EPSG:${code}` : null, source: 'prj-wkt' };
    const name = prjWkt.match(/^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]+)"/i)?.[1] ?? 'unknown';
    throw new UnsupportedCrsError(
      `Unsupported coordinate system "${name}"${code ? ` (EPSG:${code})` : ''} — re-export the yield map in WGS84 / EPSG:4326`,
    );
  }
  if (looksLikeLonLat(sample)) return { def: { kind: 'geographic' }, epsg: 'EPSG:4326', source: 'assumed4326' };
  const detected = detectCrs(sample, near);
  if (detected) return { def: crsByEpsg(detected)!, epsg: `EPSG:${detected}`, source: 'detected' };
  const [x, y] = sample[0] ?? [NaN, NaN];
  throw new UnsupportedCrsError(
    `Coordinates are not WGS84 (first point ${x}, ${y}) and the export carries no .prj — re-export the yield map in WGS84 / EPSG:4326`,
  );
}

/** WGS 84 / UTM zone of a lon/lat — the grid the satellite pipeline uses for a field. */
export function utmEpsg(lon: number, lat: number): number {
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  return (lat >= 0 ? 32600 : 32700) + zone;
}
