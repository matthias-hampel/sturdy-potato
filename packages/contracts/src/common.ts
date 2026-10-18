import { z } from 'zod';

export const id = z.uuid();
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true });

export const name = z.string().trim().min(1).max(200);
export const shortText = z.string().trim().max(200).nullish();
export const longText = z.string().trim().max(5000).nullish();
export const amount = z.number().finite().nonnegative().max(1e10);
export const positive = z.number().finite().positive().max(1e10);
export const countryCode = z.string().length(2).toUpperCase();
export const currencyCode = z.string().length(3).toUpperCase();

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

/** Error body returned by the API for every non-2xx response. */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Ref {
  id: string;
  name: string;
}
