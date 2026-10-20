/**
 * Reads a WFS GetFeature response (GML 3.2 / WFS 2.0, also GML 3.1 featureMember lists) into raw
 * parcels: the feature's scalar properties by local name, and its area geometry reprojected to
 * WGS 84. Ported from the reference's lib/cadastral/wfs.ts, with two deliberate differences: all
 * surfaces of a multi-part parcel and their holes are kept (the reference kept the first outer
 * ring only), and the reprojection is done here instead of with proj4.
 */
import type { MultiPolygon, Position } from 'geojson';
import { fromUtm, type UtmCrs } from './utm.js';
import { findAll, findFirst, parseXml, type XmlElement } from './xml.js';

export interface RawParcel {
  /** Scalar properties by local element name; the first occurrence wins. */
  properties: Record<string, string>;
  geometry: MultiPolygon;
}

export class WfsError extends Error {
  constructor(
    readonly kind: 'no_access' | 'unavailable' | 'error',
    message: string,
  ) {
    super(message);
    this.name = 'WfsError';
  }
}

const COORD_DECIMALS = 1e8;

/** Coordinates of a ring element in document order: posList, pos and GML 2 coordinates. */
function ringPositions(ring: XmlElement, crs: UtmCrs): Position[] {
  const raw: number[][] = [];
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      const local = c.local.toLowerCase();
      if (local === 'poslist') {
        const dim = Number(c.attrs.srsDimension ?? c.attrs.dimension ?? 2) || 2;
        const nums = c.text.trim().split(/\s+/).map(Number);
        for (let i = 0; i + 1 < nums.length; i += dim) raw.push([nums[i], nums[i + 1]]);
      } else if (local === 'pos') {
        const nums = c.text.trim().split(/\s+/).map(Number);
        if (nums.length >= 2) raw.push([nums[0], nums[1]]);
      } else if (local === 'coordinates') {
        for (const pair of c.text.trim().split(/\s+/)) {
          const [x, y] = pair.split(',').map(Number);
          raw.push([x, y]);
        }
      } else walk(c);
    }
  };
  walk(ring);
  const out: Position[] = [];
  for (const p of raw) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const [lon, lat] = fromUtm(p, crs);
    const q = [Math.round(lon * COORD_DECIMALS) / COORD_DECIMALS, Math.round(lat * COORD_DECIMALS) / COORD_DECIMALS];
    // Adjacent curve segments share their end point.
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length >= 3) {
    const [first, last] = [out[0], out[out.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : [];
}

/** All polygons of a feature (simple Polygon, Surface patches, MultiSurface members) with their holes. */
export function featureGeometry(feature: XmlElement, crs: UtmCrs): MultiPolygon | null {
  const polygons: Position[][][] = [];
  const surfaces = [...findAll(feature, 'Polygon'), ...findAll(feature, 'PolygonPatch')];
  for (const poly of surfaces) {
    const exterior = findFirst(poly, 'exterior');
    if (!exterior) continue;
    const outer = ringPositions(exterior, crs);
    if (!outer.length) continue;
    const holes = findAll(poly, 'interior').map((r) => ringPositions(r, crs)).filter((r) => r.length);
    polygons.push([outer, ...holes]);
  }
  return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
}

/** Scalar leaf values by local name, outside of geometry and envelope subtrees. */
export function featureProperties(feature: XmlElement): Record<string, string> {
  const props: Record<string, string> = {};
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      const isGml = c.name.startsWith('gml:');
      if (isGml && c.local !== 'identifier') continue;
      if (c.local === 'boundedBy') continue;
      if (c.children.length === 0) {
        const value = c.text.trim();
        if (value && props[c.local] === undefined) props[c.local] = value;
      } else walk(c);
    }
  };
  walk(feature);
  return props;
}

/** The features of a GetFeature response; throws a WfsError for an exception report. */
export function parseFeatureCollection(xml: string, crs: UtmCrs): RawParcel[] {
  const doc = parseXml(xml);
  const root = doc.children.find((c) => c.name !== '#document');
  if (!root) throw new WfsError('error', 'Empty response');
  if (root.local === 'ExceptionReport' || root.local === 'ServiceExceptionReport') {
    const text = findFirst(root, 'ExceptionText')?.text.trim() ?? findFirst(root, 'ServiceException')?.text.trim() ?? '';
    throw new WfsError('error', `Service exception: ${text.slice(0, 300)}`);
  }
  if (root.local !== 'FeatureCollection') throw new WfsError('error', `Unexpected response <${root.name}>`);
  const features: XmlElement[] = [];
  for (const c of root.children) {
    const local = c.local.toLowerCase();
    if (local === 'member' || local === 'featuremember' || local === 'featuremembers') features.push(...c.children);
  }
  const parcels: RawParcel[] = [];
  for (const f of features) {
    const geometry = featureGeometry(f, crs);
    if (geometry) parcels.push({ properties: featureProperties(f), geometry });
  }
  return parcels;
}
