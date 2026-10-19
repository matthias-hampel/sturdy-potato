/**
 * Which federal state's cadastre to ask for a place (ported from the reference's
 * lib/cadastral/router.ts). The FLIK wins when known — every German FLIK starts with "DE" and the
 * two state letters (DENILI… → NI). Otherwise the point is matched against the states' extents;
 * where extents overlap, a city state enclosed by another state wins, then the state the point
 * lies deepest inside.
 */
import { FEDERAL_STATE_CODES, FEDERAL_STATES, type FederalStateCode, type FederalStateConfig } from './states.js';

/**
 * The state letters of a FLIK. Unlike the reference, the "DE" prefix is required: a field's
 * identifier may also be the farm's own number ("NW 12"), which must not pick a state.
 */
export function federalStateFromFlik(flik: string | null | undefined): FederalStateCode | null {
  const upper = flik?.trim().toUpperCase() ?? '';
  if (upper.length < 6 || !upper.startsWith('DE')) return null;
  const candidate = upper.slice(2, 4);
  return (FEDERAL_STATE_CODES as readonly string[]).includes(candidate) ? (candidate as FederalStateCode) : null;
}

const encloses = (outer: FederalStateConfig, inner: FederalStateConfig) =>
  inner !== outer && inner.bbox[0] >= outer.bbox[0] && inner.bbox[2] <= outer.bbox[2] && inner.bbox[1] >= outer.bbox[1] && inner.bbox[3] <= outer.bbox[3];

export function federalStateAt(lon: number, lat: number): FederalStateCode | null {
  const candidates = Object.values(FEDERAL_STATES).filter((s) => lon >= s.bbox[0] && lon <= s.bbox[2] && lat >= s.bbox[1] && lat <= s.bbox[3]);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].code;
  const enclosed = candidates.filter((a) => candidates.some((b) => encloses(b, a)));
  const pool = enclosed.length > 0 ? enclosed : candidates;
  const margin = (s: FederalStateConfig) =>
    Math.min(
      (lon - s.bbox[0]) / (s.bbox[2] - s.bbox[0]),
      (s.bbox[2] - lon) / (s.bbox[2] - s.bbox[0]),
      (lat - s.bbox[1]) / (s.bbox[3] - s.bbox[1]),
      (s.bbox[3] - lat) / (s.bbox[3] - s.bbox[1]),
    );
  return [...pool].sort((a, b) => margin(b) - margin(a))[0].code;
}

/** The state for a point, preferring the state letters of a FLIK. */
export function resolveFederalState(lon: number, lat: number, flik?: string | null): FederalStateConfig | null {
  const code = federalStateFromFlik(flik) ?? federalStateAt(lon, lat);
  return code ? FEDERAL_STATES[code] : null;
}
