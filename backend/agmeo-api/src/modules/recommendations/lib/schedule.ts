/**
 * When the worker recalculates recommendations: once a day per organization with open crop
 * cycles, early in the morning local time, and shortly after changes to the calendar or crops.
 * Pure functions, so the decisions are testable without a database or clock.
 */

export interface DailySchedule {
  /** Local wall-clock time of the daily run, 'HH:MM'. */
  at: string;
  /** IANA time zone the run time is in, e.g. 'Europe/Berlin'. */
  timeZone: string;
}

export interface OrgRunState {
  organizationId: string;
  /** Planned or active main crop cycles on active fields. */
  openCycles: number;
  /** Latest recommendation run of any kind (daily, after changes or by a user). */
  lastRunAt: Date | null;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Calendar date ('YYYY-MM-DD') of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** The instant the wall clock in `timeZone` shows `hhmm` on `date`; a time in the spring gap moves forward. */
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  // The second pass corrects the offset when the first guess is on the other side of a DST switch.
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/** Rejects a malformed run time or unknown time zone, which would otherwise make every tick due. */
export function assertDailySchedule(schedule: DailySchedule): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at)) throw new Error(`Daily run time must be HH:MM, got '${schedule.at}'`);
  localDate(new Date(), schedule.timeZone); // RangeError for an unknown zone
}

/** Today's (local) run time. */
export function dailySlot(now: Date, schedule: DailySchedule): Date {
  return zonedInstant(localDate(now, schedule.timeZone), schedule.at, schedule.timeZone);
}

/**
 * Organizations due for the daily run: with open crop cycles, once today's run time has
 * passed, and not recalculated since. A worker that was down catches up later the same day;
 * a missed day is not repeated. `retryAt` holds organizations whose last attempt failed.
 */
export function dueForDailyRun(orgs: OrgRunState[], now: Date, schedule: DailySchedule, retryAt: ReadonlyMap<string, number> = new Map()): string[] {
  const slot = dailySlot(now, schedule);
  if (now < slot) return [];
  return orgs
    .filter((o) => o.openCycles > 0)
    .filter((o) => !o.lastRunAt || o.lastRunAt < slot)
    .filter((o) => (retryAt.get(o.organizationId) ?? 0) <= now.getTime())
    .map((o) => o.organizationId);
}

// ---------------------------------------------------------------------------
// Recalculation after changes
// ---------------------------------------------------------------------------

/** Domain events whose aggregates feed the rule set (NATS subjects under agmeo.events). */
export const RECALCULATING_EVENTS = ['operation', 'crop_cycle'] as const;

export function recalculates(eventType: string): boolean {
  return RECALCULATING_EVENTS.some((prefix) => eventType.startsWith(`${prefix}.`));
}

export interface PendingChange {
  firstAt: number;
  lastAt: number;
}

export interface Debounce {
  /** Recalculate once no further change arrived for this long … */
  quietMs: number;
  /** … or at the latest this long after the first change, during a long burst of edits. */
  maxWaitMs: number;
}

export function noteChange(pending: Map<string, PendingChange>, orgId: string, at: number): void {
  pending.set(orgId, { firstAt: pending.get(orgId)?.firstAt ?? at, lastAt: at });
}

/** Organizations whose changes have settled (or waited long enough) to recalculate now. */
export function dueAfterChanges(pending: ReadonlyMap<string, PendingChange>, now: number, debounce: Debounce): string[] {
  return [...pending]
    .filter(([, p]) => now - p.lastAt >= debounce.quietMs || now - p.firstAt >= debounce.maxWaitMs)
    .sort(([, a], [, b]) => a.firstAt - b.firstAt)
    .map(([orgId]) => orgId);
}
