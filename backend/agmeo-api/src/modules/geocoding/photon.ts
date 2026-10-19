import type { GeocodeHit } from '@agmeo/contracts';

/** A feature of Photon's GeoJSON response (OpenStreetMap data). */
export interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type: string;
    osm_id: number;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    locality?: string;
    county?: string;
    state?: string;
    countrycode?: string;
  };
}

/** Layers worth offering for a farm address; leaves out counties, states and countries. */
export const SEARCH_LAYERS = ['house', 'street', 'locality', 'district', 'city'];

const join = (sep: string, ...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(sep);

/** German-style postal address and display lines of a Photon feature. */
export function toHit(f: PhotonFeature): GeocodeHit {
  const p = f.properties;
  const kind = p.type === 'house' ? 'house' : p.type === 'street' ? 'street' : 'place';
  const town = p.city ?? p.locality ?? p.district ?? p.county;
  const streetLine = kind === 'street' ? p.name : p.street ? join(' ', p.street, p.housenumber) : undefined;
  // A named house (farmyard, shop) is still addressed by its street; a named village by itself.
  const placeName = kind === 'place' && p.name !== town ? p.name : undefined;
  const townLine = join(' ', p.postcode, town) || undefined;
  const address = join(', ', streetLine ?? placeName ?? (kind === 'house' ? p.name : undefined), townLine) || p.name || '';
  const title = p.name ?? streetLine ?? townLine ?? address;
  const district = p.district !== town && p.district !== p.name ? p.district : undefined;
  return {
    id: `${p.osm_type}${p.osm_id}`,
    title,
    detail: join(', ', title !== streetLine && streetLine, title !== townLine && townLine, district, p.state) || null,
    address,
    location: { lat: round(f.geometry.coordinates[1]), lng: round(f.geometry.coordinates[0]) },
    kind,
    countryCode: p.countrycode ?? null,
  };
}

/** Hits without the duplicates OpenStreetMap has for one place (e.g. a village node and its boundary). */
export function toHits(features: PhotonFeature[]): GeocodeHit[] {
  const seen = new Set<string>();
  const hits: GeocodeHit[] = [];
  for (const f of features) {
    const hit = toHit(f);
    const key = `${hit.title}|${hit.detail}`;
    if (!hit.address || seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }
  return hits;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
