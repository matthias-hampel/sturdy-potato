/**
 * Which Bundesland a farm reports in, which fertilization reports that state takes, when they are
 * due and where the file goes.
 *
 * Ported from agmeo `src/lib/cadastral/router.ts` (federalStateFromFlikPrefix),
 * `src/lib/federalExport/{region,formats,deadlines}.ts` and the fertilizer-reports `formatCatalog.ts`.
 * The farm's stored federal state takes the place of agmeo's org override; there is no
 * Regierungsbezirk / centroid fallback.
 */
import { FEDERAL_EXPORT_FORMATS, FEDERAL_STATES, type ExportUploadGuide, type FederalExportFormat, type FederalState } from '@agmeo/contracts';
import { FORMAT_STATES } from './harmonie/index.js';

/** Every German FLIK starts with DE + the two state letters (DENILI… → NI). */
export function federalStateFromFlikPrefix(flik: string | null | undefined): FederalState | null {
  if (!flik || flik.length < 4) return null;
  const stripped = flik.toUpperCase().startsWith('DE') ? flik.slice(2) : flik;
  const candidate = stripped.slice(0, 2).toUpperCase();
  return (FEDERAL_STATES as readonly string[]).includes(candidate) ? (candidate as FederalState) : null;
}

/** Below this share of FLIK-bearing fields a FLIK majority is not trusted. */
const FLIK_COVERAGE_THRESHOLD = 0.5;

export interface FertilizerReportRegion {
  federalState: FederalState | null;
  source: 'farm' | 'flik' | null;
  flikCoverage: number;
}

/** Stored farm state → FLIK majority (if at least half of the fields carry a state FLIK) → unknown. */
export function resolveFertilizerReportRegion(stored: FederalState | null | undefined, fliks: (string | null)[]): FertilizerReportRegion {
  const states = fliks.map(federalStateFromFlikPrefix);
  const withState = states.filter((s) => s != null).length;
  const flikCoverage = fliks.length > 0 ? withState / fliks.length : 0;
  if (stored) return { federalState: stored, source: 'farm', flikCoverage };
  if (flikCoverage >= FLIK_COVERAGE_THRESHOLD) {
    const votes = new Map<FederalState, number>();
    for (const s of states) if (s) votes.set(s, (votes.get(s) ?? 0) + 1);
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (winner) return { federalState: winner, source: 'flik', flikCoverage };
  }
  return { federalState: null, source: null, flikCoverage };
}

/** The formats a state files, in display order (the mandatory Meldungen first, the import helper last). */
export function formatsForState(state: string | null): FederalExportFormat[] {
  if (!state) return [];
  return FEDERAL_EXPORT_FORMATS.filter((format) => FORMAT_STATES[format].includes(state));
}

// ---------------------------------------------------------------------------
// Deadlines (Europe/Berlin)
// ---------------------------------------------------------------------------

const berlinParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const berlinWallClock = (instant: Date) => {
  const parts = berlinParts.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), asUtc: Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) };
};

/** The instant at which the given Berlin wall-clock date starts (or ends, at 23:59:59). */
export function berlinDate(year: number, month: number, day: number, endOfDay = false): Date {
  const wallClock = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  const offset = berlinWallClock(new Date(wallClock)).asUtc - wallClock;
  return new Date(wallClock - offset);
}

/** ENNI Erlass "testweise Anpassung": Düngejahre 2025 and 2026 are due 30 June instead of 31 March. */
const ENNI_EXTENDED_YEARS = [2025, 2026];

/** Reporting deadline (Berlin, end of day) for Düngejahr `reportYear`; null for webBESyD (no Meldepflicht). */
export function getReportDeadline(format: FederalExportFormat, reportYear: number): Date | null {
  const next = reportYear + 1;
  switch (format) {
    case 'enni':
      return ENNI_EXTENDED_YEARS.includes(reportYear) ? berlinDate(next, 6, 30, true) : berlinDate(next, 3, 31, true);
    case 'endo':
      return berlinDate(next, 3, 31, true);
    case 'st':
      return berlinDate(next, 4, 30, true);
    case 'besyd':
      return null;
  }
}

/** The Düngejahr whose Meldung is open: until June the previous year, from July the current one. */
export function defaultReportYear(now = new Date()): number {
  const { year, month } = berlinWallClock(now);
  return month <= 6 ? year - 1 : year;
}

// ---------------------------------------------------------------------------
// Upload guide
// ---------------------------------------------------------------------------

export const UPLOAD_GUIDES: Record<FederalExportFormat, ExportUploadGuide> = {
  enni: {
    fileType: 'xml',
    portalUrl: 'https://www2.meldeprogramm-niedersachsen.de/ENNI_LWKNDS_PR/Anmeldung.xhtml',
    hotline: '0441 801-660',
    contactEmail: 'enni@lwk-niedersachsen.de',
  },
  endo: { fileType: 'xml', portalUrl: 'https://www.endo-sh.de', hotline: '04347 704-777', contactEmail: 'endo-sh@llnl.landsh.de' },
  st: { fileType: 'zip', email: 'duengung@llg.sachsen-anhalt.de', hotline: '03471 334 206', contactEmail: 'duengung@llg.sachsen-anhalt.de' },
  besyd: { fileType: 'zip', portalUrl: 'https://www.landwirtschaft.sachsen.de/webbesyd.html' },
};

/** webBESyD has one login per Land; Sachsen goes through the LfULG landing page. */
const BESYD_PORTAL_BY_STATE: Partial<Record<FederalState, string>> = {
  BB: 'https://www.landwirtschaft.sachsen.de/webbesyd/bb',
  ST: 'https://www.landwirtschaft.sachsen.de/webbesyd/st',
};

export function uploadGuide(format: FederalExportFormat, state: FederalState | null): ExportUploadGuide {
  const guide = UPLOAD_GUIDES[format];
  const portal = format === 'besyd' && state ? BESYD_PORTAL_BY_STATE[state] : undefined;
  return portal ? { ...guide, portalUrl: portal } : { ...guide };
}

/** Kind of an archived export from its file name (`ENNI_…`, `ENDO_…`, `BESyD_…`, `ST_…`, `agrarantrag-…`). */
export function exportFormatFromFileName(name: string): FederalExportFormat | 'agrarantrag' | null {
  const lower = name.toLowerCase();
  if (lower.startsWith('agrarantrag')) return 'agrarantrag';
  const prefix = lower.split('_')[0];
  return (FEDERAL_EXPORT_FORMATS as readonly string[]).includes(prefix) ? (prefix as FederalExportFormat) : null;
}
