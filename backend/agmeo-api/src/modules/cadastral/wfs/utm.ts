/**
 * ETRS89 / UTM (EPSG:25832, EPSG:25833) ↔ WGS 84 longitude/latitude, the two reference systems the
 * German cadastre services answer in. Krüger series to third order (sub-centimetre within a zone and
 * well beyond); ETRS89 and WGS 84 are treated as identical, as everywhere in the app.
 */
const A_AXIS = 6378137;
const F = 1 / 298.257222101; // GRS80
const K0 = 0.9996;
const E0 = 500_000;

const n = F / (2 - F);
const A = (A_AXIS / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
const ALPHA = [n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
const BETA = [n / 2 - (2 / 3) * n ** 2 + (37 / 96) * n ** 3, (1 / 48) * n ** 2 + (1 / 15) * n ** 3, (17 / 480) * n ** 3];
const DELTA = [2 * n - (2 / 3) * n ** 2 - 2 * n ** 3, (7 / 3) * n ** 2 - (8 / 5) * n ** 3, (56 / 15) * n ** 3];
const TWO_ROOT_N = (2 * Math.sqrt(n)) / (1 + n);
const RAD = Math.PI / 180;

export type UtmCrs = 'EPSG:25832' | 'EPSG:25833';

const ZONES: Record<UtmCrs, number> = { 'EPSG:25832': 32, 'EPSG:25833': 33 };
const centralMeridian = (crs: UtmCrs) => (ZONES[crs] * 6 - 183) * RAD;

export const isUtmCrs = (crs: string): crs is UtmCrs => crs in ZONES;

/** [lon, lat] in degrees → [easting, northing] in metres. */
export function toUtm([lon, lat]: [number, number] | number[], crs: UtmCrs): [number, number] {
  const phi = lat * RAD;
  const dLambda = lon * RAD - centralMeridian(crs);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - TWO_ROOT_N * Math.atanh(TWO_ROOT_N * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(dLambda));
  const eta = Math.atanh(Math.sin(dLambda) / Math.sqrt(1 + t * t));
  let e = eta;
  let nn = xi;
  for (let j = 1; j <= 3; j++) {
    e += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    nn += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [E0 + K0 * A * e, K0 * A * nn];
}

/** [easting, northing] in metres → [lon, lat] in degrees. */
export function fromUtm([easting, northing]: [number, number] | number[], crs: UtmCrs): [number, number] {
  const xi = northing / (K0 * A);
  const eta = (easting - E0) / (K0 * A);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lambda = centralMeridian(crs) + Math.atan(Math.sinh(eta1) / Math.cos(xi1));
  return [lambda / RAD, phi / RAD];
}
