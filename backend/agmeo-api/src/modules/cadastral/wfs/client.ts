/**
 * Server-side access to the states' cadastre WFS: builds GetFeature requests for a WGS 84 box,
 * caches responses (cadastral data changes rarely; one cached area serves every organization) and
 * limits concurrent requests so bulk syncs do not run into the services' rate limits.
 *
 * The HTTP layer (`WfsHttp`) is its own provider so tests can answer with recorded responses
 * (src/modules/cadastral/wfs/__fixtures__) instead of calling the services.
 */
import { Injectable, Logger } from '@nestjs/common';
import { parseFeatureCollection, WfsError } from './gml.js';
import { normalizeParcel, type NormalizedParcel } from './normalize.js';
import { type FederalStateConfig } from './states.js';
import { toUtm } from './utm.js';

export type BBox = { west: number; south: number; east: number; north: number };

const TIMEOUT_MS = 45_000;
const MAX_FEATURES = 5000;
/** Margin around the requested box in metres, so parcels touching its edge are complete. */
const BUFFER_M = 5;
const CACHE_SIZE = 400;
const CACHE_TTL_MS = 24 * 3600_000;
const MAX_CONCURRENT = 4;

@Injectable()
export class WfsHttp {
  /** GET a URL and return the body; network and HTTP failures become `unavailable`. */
  async get(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'agmeo-cadastral/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new WfsError('unavailable', (e as Error).message);
    }
    if (!res.ok) throw new WfsError('unavailable', `HTTP ${res.status} ${res.statusText}`);
    return res.text();
  }
}

/** GetFeature URL for the parcels in `bbox` (WGS 84), expressed in the state's UTM zone. */
export function getFeatureUrl(state: FederalStateConfig, bbox: BBox): string {
  const corners = [
    toUtm([bbox.west, bbox.south], state.crs),
    toUtm([bbox.west, bbox.north], state.crs),
    toUtm([bbox.east, bbox.south], state.crs),
    toUtm([bbox.east, bbox.north], state.crs),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const r = (v: number) => v.toFixed(1);
  const srs = `urn:ogc:def:crs:EPSG::${state.crs.split(':')[1]}`;
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: state.typeName,
    srsName: srs,
    count: String(MAX_FEATURES),
    bbox: `${r(Math.min(...xs) - BUFFER_M)},${r(Math.min(...ys) - BUFFER_M)},${r(Math.max(...xs) + BUFFER_M)},${r(Math.max(...ys) + BUFFER_M)},${srs}`,
  });
  return `${state.wfsUrl}?${params}`;
}

@Injectable()
export class CadastralClient {
  private readonly logger = new Logger(CadastralClient.name);
  // Insertion-ordered: the first key is the oldest entry.
  private readonly cache = new Map<string, { at: number; parcels: NormalizedParcel[] }>();
  private readonly inflight = new Map<string, Promise<NormalizedParcel[]>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly http: WfsHttp) {}

  /** Parcels of `state` touching `bbox`; throws WfsError. */
  async parcels(state: FederalStateConfig, bbox: BBox): Promise<NormalizedParcel[]> {
    if (state.reliability === 'blocked') throw new WfsError('no_access', state.coverageNote);
    const url = getFeatureUrl(state, bbox);
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.parcels;
    const running = this.inflight.get(url);
    if (running) return running;
    const request = this.fetchParcels(state, url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, request);
    return request;
  }

  private async fetchParcels(state: FederalStateConfig, url: string): Promise<NormalizedParcel[]> {
    await this.acquire();
    try {
      const xml = await this.http.get(url);
      const parcels = parseFeatureCollection(xml, state.crs).map((raw) => normalizeParcel(raw, state.schema));
      this.cache.delete(url);
      this.cache.set(url, { at: Date.now(), parcels });
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      return parcels;
    } catch (e) {
      this.logger.warn(`Cadastre ${state.code} failed: ${(e as Error).message}`);
      throw e instanceof WfsError ? e : new WfsError('error', (e as Error).message);
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.active < MAX_CONCURRENT) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}
