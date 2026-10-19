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

/**
 * States whose extent contains the point, most likely first: enclosed city states, then the state
 * the point lies deepest inside. Extents overlap widely (Göttingen lies in both the NI and the HE
 * box), so callers try the next state when the first one's service finds nothing there.
 */
export function federalStatesAt(lon: number, lat: number): FederalStateCode[] {
  const candidates = Object.values(FEDERAL_STATES).filter((s) => lon >= s.bbox[0] && lon <= s.bbox[2] && lat >= s.bbox[1] && lat <= s.bbox[3]);
  const margin = (s: FederalStateConfig) =>
    Math.min(
      (lon - s.bbox[0]) / (s.bbox[2] - s.bbox[0]),
      (s.bbox[2] - lon) / (s.bbox[2] - s.bbox[0]),
      (lat - s.bbox[1]) / (s.bbox[3] - s.bbox[1]),
      (s.bbox[3] - lat) / (s.bbox[3] - s.bbox[1]),
    );
  const enclosed = (a: FederalStateConfig) => candidates.some((b) => encloses(b, a));
  return [...candidates].sort((a, b) => Number(enclosed(b)) - Number(enclosed(a)) || margin(b) - margin(a)).map((s) => s.code);
}

export function federalStateAt(lon: number, lat: number): FederalStateCode | null {
  return federalStatesAt(lon, lat)[0] ?? null;
}

/** The state for a point, preferring the state letters of a FLIK. */
export function resolveFederalState(lon: number, lat: number, flik?: string | null): FederalStateConfig | null {
  return resolveFederalStates(lon, lat, flik)[0] ?? null;
}

/** All states that may hold a point's parcels, most likely first (the FLIK's state leads). */
export function resolveFederalStates(lon: number, lat: number, flik?: string | null): FederalStateConfig[] {
  const fromFlik = federalStateFromFlik(flik);
  const codes = [...(fromFlik ? [fromFlik] : []), ...federalStatesAt(lon, lat).filter((c) => c !== fromFlik)];
  return codes.map((c) => FEDERAL_STATES[c]);
}
