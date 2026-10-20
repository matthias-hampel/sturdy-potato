/**
 * The three projections the radar needs, instead of proj4 (which the reference uses):
 *
 * - RADOLAN (RY): north polar stereographic, true scale at 60° N, central meridian 10° E, on a
 *   sphere of radius 6 370 040 m (`+proj=stere +lat_0=90 +lat_ts=60 +lon_0=10 +a=6370040 +b=6370040`).
 * - DE1200 (RV): the same projection on the WGS84 ellipsoid (`… +ellps=WGS84`).
 * - Web Mercator (EPSG:3857).
 *
 * proj4 applies no datum shift between these definitions (none of them names a datum), so plain
 * projection formulas reproduce it. Polar stereographic after Snyder, Map Projections — A Working
 * Manual (1987), eq. 21-33 ff. (variant with a standard parallel).
 */

const DEG = Math.PI / 180;

export interface Projection {
  /** Longitude, latitude in degrees → projected metres. */
  forward(lon: number, lat: number): [number, number];
  /** Projected metres → longitude, latitude in degrees. */
  inverse(x: number, y: number): [number, number];
}

/** North polar stereographic with true scale at `latTs`; `e` = 0 for a sphere of radius `a`. */
export function polarStereographic({ a, e, latTs, lon0 }: { a: number; e: number; latTs: number; lon0: number }): Projection {
  const phiC = latTs * DEG;
  const sinC = Math.sin(phiC);
  const t = (phi: number) => {
    const s = Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - e * s) / (1 + e * s), e / 2);
  };
  const mc = Math.cos(phiC) / Math.sqrt(1 - e * e * sinC * sinC);
  // ρ = k·t
  const k = (a * mc) / t(phiC);
  return {
    forward(lon, lat) {
      const lam = (lon - lon0) * DEG;
      const rho = k * t(lat * DEG);
      return [rho * Math.sin(lam), -rho * Math.cos(lam)];
    },
    inverse(x, y) {
      const ts = Math.hypot(x, y) / k;
      let phi = Math.PI / 2 - 2 * Math.atan(ts);
      if (e > 0) {
        for (let i = 0; i < 15; i++) {
          const s = Math.sin(phi);
          const next = Math.PI / 2 - 2 * Math.atan(ts * Math.pow((1 - e * s) / (1 + e * s), e / 2));
          const done = Math.abs(next - phi) < 1e-12;
          phi = next;
          if (done) break;
        }
      }
      return [lon0 + Math.atan2(x, -y) / DEG, phi / DEG];
    },
  };
}

const WGS84_F = 1 / 298.257223563;

/** RADOLAN sphere (RY). */
export const RADOLAN = polarStereographic({ a: 6_370_040, e: 0, latTs: 60, lon0: 10 });
/** DE1200 composite grid (RV): WGS84 ellipsoid. */
export const DE1200 = polarStereographic({ a: 6_378_137, e: Math.sqrt(2 * WGS84_F - WGS84_F * WGS84_F), latTs: 60, lon0: 10 });

const R_MERC = 6_378_137;

export const WEB_MERCATOR: Projection = {
  forward: (lon, lat) => [R_MERC * lon * DEG, R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))],
  inverse: (x, y) => [x / R_MERC / DEG, (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) / DEG],
};
