/**
 * Ported from AGVOLUTION/agmeo src/lib/timezone.ts — IANA wall-clock arithmetic, unchanged.
 */

/**
 * IANA time-zone arithmetic on top of `Intl` — the repo has no tz library and
 * `localParts` (src/lib/chat/schedules.ts) already reads wall clocks this way.
 * These are its inverse: a wall-clock time in a zone → the UTC instant.
 */

/** Whether `Intl` knows the zone (IANA names and `Etc/GMT±N`). */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Building an Intl.DateTimeFormat costs ~40 µs, formatting with one ~2 µs. The hourly
// weather readers convert ~500 instants × 4 offsets per field, so a fresh formatter per
// call made the fields overview spend 20 s here for a 108-field farm.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes east of UTC that `tz` observes at the instant `at` (DST-aware). */
export function utcOffsetMinutes(at: Date, tz: string): number {
  let formatter = offsetFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });
    offsetFormatters.set(tz, formatter);
  }
  const parts = formatter.formatToParts(at);
  const name =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT", "GMT+2", "GMT-03:30"
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!match) throw new Error(`Unexpected offset name: ${name}`);
  if (!match[1]) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

/**
 * "2026-09-26T06:00" (or "2026-09-26T06:00:00") read as a wall clock in `tz` → UTC instant.
 * Two passes resolve the offset on DST days; the repeated autumn hour resolves to its first
 * occurrence, the missing spring hour to the instant the clock jumps to.
 */
export function zonedWallClockToUtc(isoLocal: string, tz: string): Date {
  const naive = Date.parse(
    `${isoLocal.length === 16 ? `${isoLocal}:00` : isoLocal}Z`,
  );
  if (Number.isNaN(naive))
    throw new Error(`Not a wall-clock timestamp: ${isoLocal}`);
  // The offsets in force half a day before and after cover both sides of any DST switch.
  const probe = 12 * 60 * 60_000;
  const candidates = [naive - probe, naive + probe].map(
    (at) => naive - utcOffsetMinutes(new Date(at), tz) * 60_000,
  );
  // A candidate is real when the zone's offset at that instant maps it back onto the wall clock.
  const valid = candidates.filter(
    (utc) => utc + utcOffsetMinutes(new Date(utc), tz) * 60_000 === naive,
  );
  return new Date(Math.min(...(valid.length > 0 ? valid : candidates)));
}

/** localDayBoundary("2026-09-26", "06:00", "Europe/Berlin") → 2026-09-26T04:00:00Z */
export function localDayBoundary(
  localDate: string,
  hhmm: string,
  tz: string,
): Date {
  return zonedWallClockToUtc(`${localDate}T${hhmm}`, tz);
}
