import { z } from 'zod';
import { LatLng, countryCode } from './common.js';

const lang = z.enum(['de', 'en', 'fr']).optional();

export const GeocodeSearchQuery = z.object({
  q: z.string().trim().min(3).max(200),
  /** Only addresses in this country, e.g. the farm's country. */
  country: countryCode.optional(),
  /** Prefer hits near this point, e.g. the current map centre. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lang,
  limit: z.coerce.number().int().min(1).max(10).default(6),
});
export type GeocodeSearchQuery = z.input<typeof GeocodeSearchQuery>;

export const GeocodeReverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  lang,
});
export type GeocodeReverseQuery = z.input<typeof GeocodeReverseQuery>;

/** An address or place found by the geocoder (OpenStreetMap data via Photon). */
export interface GeocodeHit {
  id: string;
  /** First line: a named place or street and house number. */
  title: string;
  /** Second line: postcode, place and region. */
  detail: string | null;
  /** Postal address for the address field, e.g. "Lehmkuhlenweg 5, 37133 Friedland". */
  address: string;
  location: LatLng;
  kind: 'house' | 'street' | 'place';
  countryCode: string | null;
}
