/**
 * Maps the raw properties of the three German cadastre schemas onto one parcel shape (ported from
 * the reference's lib/cadastral/normalize.ts). Beyond the reference, the 20-character
 * Flurstückskennzeichen is decoded where a service gives no separate Gemarkung/Flur/number, so
 * INSPIRE parcels get a sector (Flur) and parcel number too.
 */
import type { MultiPolygon, Position } from 'geojson';
import type { RawParcel } from './gml.js';
import type { CadastralSchema } from './states.js';

export interface NormalizedParcel {
  /** Flurstückskennzeichen (or the service's own identifier). */
  officialId: string | null;
  label: string | null;
  /** Gemarkung name, or its number where the service gives no name. */
  district: string | null;
  /** Flur. */
  sector: string | null;
  /** Flurstücksnummer: Zähler / Nenner. */
  numerator: string | null;
  denominator: string | null;
  /** Official area (amtliche Fläche) in m², else computed from the geometry. */
  areaM2: number;
  geometry: MultiPolygon;
}

const get = (props: Record<string, string>, ...keys: string[]): string | null => {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) lower[k.toLowerCase()] = v;
  for (const k of keys) {
    const v = lower[k.toLowerCase()]?.trim();
    if (v) return v;
  }
  return null;
};

const R = 6378137;
const RAD = Math.PI / 180;
const ringArea = (ring: Position[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i];
    const [l2, p2] = ring[i + 1];
    sum += (l2 - l1) * RAD * (2 + Math.sin(p1 * RAD) + Math.sin(p2 * RAD));
  }
  return Math.abs((sum * R * R) / 2);
};

/** Area of a WGS 84 multipolygon in m² (spherical approximation, as turf's area). */
export function geodesicAreaM2(g: MultiPolygon): number {
  return g.coordinates.reduce((s, [outer, ...holes]) => s + ringArea(outer) - holes.reduce((h, r) => h + ringArea(r), 0), 0);
}

const stripNumber = (s: string) => s.replace(/_/g, '').replace(/^0+(?=\d)/, '');

/**
 * Decodes an AdV Flurstückskennzeichen: Land (2) + Gemarkung (4) + Flur (3) + Zähler (5) +
 * Nenner (4) [+ Folge (2)], blanks written as "_" or leading zeros.
 */
export function decodeKennzeichen(id: string | null): { districtCode: string; sector: string | null; numerator: string | null; denominator: string | null } | null {
  if (!id || !/^\d{6}[\d_]{12}/.test(id)) return null;
  const part = (from: number, to: number) => stripNumber(id.slice(from, to)) || null;
  const denominator = part(14, 18);
  return { districtCode: id.slice(0, 6), sector: part(6, 9), numerator: part(9, 14), denominator: denominator === '0' ? null : denominator };
}

const parcelNumber = (zae: string | null, nen: string | null) => (zae ? (nen ? `${zae}/${nen}` : zae) : null);
const joinLabel = (district: string | null, sector: string | null, number: string | null) =>
  [district, sector ? `Flur ${sector}` : null, number].filter(Boolean).join(' ') || null;
const officialArea = (raw: string | null, g: MultiPolygon) => {
  const n = raw ? Number(raw.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Math.round(geodesicAreaM2(g));
};

function inspireCp(raw: RawParcel): NormalizedParcel {
  const p = raw.properties;
  let id = get(p, 'nationalCadastralReference', 'localId');
  if (id?.startsWith('CadastralParcel_')) id = id.slice('CadastralParcel_'.length);
  const decoded = decodeKennzeichen(id);
  const number = get(p, 'label') ?? parcelNumber(decoded?.numerator ?? null, decoded?.denominator ?? null);
  const district = decoded ? `Gmk. ${decoded.districtCode}` : null;
  return {
    officialId: id,
    label: joinLabel(district, decoded?.sector ?? null, number) ?? id,
    district,
    sector: decoded?.sector ?? null,
    numerator: decoded?.numerator ?? null,
    denominator: decoded?.denominator ?? null,
    areaM2: officialArea(get(p, 'areaValue'), raw.geometry),
    geometry: raw.geometry,
  };
}

function advAve(raw: RawParcel): NormalizedParcel {
  const p = raw.properties;
  const id = get(p, 'flstkennz');
  const decoded = decodeKennzeichen(id);
  let district = get(p, 'gemarkung');
  let sector = get(p, 'flur');
  // Rheinland-Pfalz and Thüringen write the Flur as "Flur 3"; Sachsen puts it into the Gemarkung name.
  if (sector?.toLowerCase().startsWith('flur ')) sector = sector.slice(5).trim();
  const inName = district?.match(/^(.*?)\s+Flur\s+(\S+)$/i);
  if (inName) {
    district = inName[1];
    sector ??= inName[2];
  }
  sector ??= decoded?.sector ?? null;
  const zae = get(p, 'flstnrzae') ?? decoded?.numerator ?? null;
  const nen = get(p, 'flstnrnen') ?? decoded?.denominator ?? null;
  return {
    officialId: id,
    label: joinLabel(district, sector, parcelNumber(zae, nen)) ?? id,
    district,
    sector,
    numerator: zae,
    denominator: nen,
    areaM2: officialArea(get(p, 'amtlflsfl', 'flaeche'), raw.geometry),
    geometry: raw.geometry,
  };
}

function beLocal(raw: RawParcel): NormalizedParcel {
  const p = raw.properties;
  const id = get(p, 'fsko');
  const district = get(p, 'namgmk') ?? get(p, 'gmk');
  const sector = get(p, 'fln');
  const zae = get(p, 'zae');
  const nen = get(p, 'nen');
  return {
    officialId: id,
    label: joinLabel(district, sector, parcelNumber(zae, nen)) ?? id,
    district,
    sector,
    numerator: zae,
    denominator: nen,
    areaM2: officialArea(get(p, 'afl'), raw.geometry),
    geometry: raw.geometry,
  };
}

export function normalizeParcel(raw: RawParcel, schema: CadastralSchema): NormalizedParcel {
  switch (schema) {
    case 'inspire_cp':
      return inspireCp(raw);
    case 'adv_ave':
      return advAve(raw);
    case 'be_local':
      return beLocal(raw);
  }
}
