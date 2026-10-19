import { Injectable, Logger } from '@nestjs/common';
import type { GeocodeHit, GeocodeReverseQuery, GeocodeSearchQuery } from '@agmeo/contracts';
import type { z } from 'zod';
import { config } from '../../config.js';
import { DomainError } from '../../core/errors.js';
import { type PhotonFeature, SEARCH_LAYERS, toHits } from './photon.js';

type SearchQuery = z.output<typeof GeocodeSearchQuery>;
type ReverseQuery = z.output<typeof GeocodeReverseQuery>;

const CACHE_SIZE = 2000;
const CACHE_TTL_MS = 24 * 3600_000;
/** Reverse geocoding only names an address this close to the clicked point. */
const REVERSE_RADIUS_KM = 1;

/**
 * Address search and reverse geocoding via Photon (OpenStreetMap data, no API key). The public
 * instance at photon.komoot.io is for fair use only; set PHOTON_URL to a self-hosted one for more load.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  // Insertion-ordered, so the first key is the oldest entry.
  private readonly cache = new Map<string, { at: number; hits: GeocodeHit[] }>();

  search(q: SearchQuery): Promise<GeocodeHit[]> {
    const params = new URLSearchParams({ q: q.q, limit: String(q.limit) });
    if (q.lang) params.set('lang', q.lang);
    if (q.country) params.set('countrycode', q.country);
    if (q.lat != null && q.lng != null) {
      // ~1 km grid, so nearby map centres share a cached response.
      params.set('lat', q.lat.toFixed(2));
      params.set('lon', q.lng.toFixed(2));
    }
    for (const layer of SEARCH_LAYERS) params.append('layer', layer);
    return this.fetch(`/api?${params}`);
  }

  async reverse(q: ReverseQuery): Promise<GeocodeHit | null> {
    const params = new URLSearchParams({ lat: q.lat.toFixed(5), lon: q.lng.toFixed(5), limit: '1', radius: String(REVERSE_RADIUS_KM) });
    if (q.lang) params.set('lang', q.lang);
    params.append('layer', 'house');
    params.append('layer', 'street');
    const [hit] = await this.fetch(`/reverse?${params}`);
    return hit ?? null;
  }

  private async fetch(path: string): Promise<GeocodeHit[]> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.hits;
    try {
      const res = await fetch(`${config.geocoding.photonUrl}${path}`, {
        headers: { 'user-agent': config.geocoding.userAgent },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Photon responded ${res.status}`);
      const data = (await res.json()) as { features: PhotonFeature[] };
      const hits = toHits(data.features);
      this.cache.delete(path);
      this.cache.set(path, { at: Date.now(), hits });
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      return hits;
    } catch (e) {
      this.logger.warn(`Geocoding failed: ${(e as Error).message}`);
      if (hit) return hit.hits;
      throw new DomainError(503, 'geocoding_unavailable', 'The address search is currently unavailable');
    }
  }
}
