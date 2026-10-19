import {
  assertDailySchedule,
  dailySlot,
  dueAfterChanges,
  dueForDailyRun,
  localDate,
  noteChange,
  type OrgRunState,
  type PendingChange,
  recalculates,
  zonedInstant,
} from './schedule.js';

const BERLIN = { at: '05:00', timeZone: 'Europe/Berlin' };

function org(id: string, o: Partial<OrgRunState> = {}): OrgRunState {
  return { organizationId: id, openCycles: 3, lastRunAt: null, ...o };
}

describe('zoned run time', () => {
  it('converts Berlin wall-clock time to UTC in summer and winter', () => {
    expect(zonedInstant('2026-07-01', '05:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(zonedInstant('2026-12-01', '05:00', 'Europe/Berlin').toISOString()).toBe('2026-12-01T04:00:00.000Z');
  });

  it('handles the days of the DST switches', () => {
    expect(zonedInstant('2026-03-29', '05:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T03:00:00.000Z');
    expect(zonedInstant('2026-10-25', '05:00', 'Europe/Berlin').toISOString()).toBe('2026-10-25T04:00:00.000Z');
    // 02:30 does not exist on 29 March; the run moves into the next hour instead of failing.
    expect(zonedInstant('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('takes the local date, not the UTC date', () => {
    // 23:30 UTC on 18 October is already 19 October in Berlin.
    expect(localDate(new Date('2026-10-18T23:30:00Z'), 'Europe/Berlin')).toBe('2026-10-19');
    expect(dailySlot(new Date('2026-10-18T23:30:00Z'), BERLIN).toISOString()).toBe('2026-10-19T03:00:00.000Z');
  });

  it('rejects a malformed time or unknown zone', () => {
    expect(() => assertDailySchedule({ at: '5:00', timeZone: 'Europe/Berlin' })).toThrow(/HH:MM/);
    expect(() => assertDailySchedule({ at: '24:00', timeZone: 'Europe/Berlin' })).toThrow(/HH:MM/);
    expect(() => assertDailySchedule({ at: '05:00', timeZone: 'Mars/Olympus' })).toThrow(RangeError);
    expect(() => assertDailySchedule(BERLIN)).not.toThrow();
  });
});

describe('daily run', () => {
  // 05:00 in Berlin on 19 October 2026 (CEST) is 03:00 UTC.
  const before = new Date('2026-10-19T02:59:00Z');
  const after = new Date('2026-10-19T03:05:00Z');

  it('runs nothing before the local run time', () => {
    expect(dueForDailyRun([org('a')], before, BERLIN)).toEqual([]);
  });

  it('runs organizations with open crop cycles once the run time has passed', () => {
    expect(dueForDailyRun([org('a'), org('b', { openCycles: 0 })], after, BERLIN)).toEqual(['a']);
  });

  it('skips organizations already recalculated since today’s run time', () => {
    const orgs = [
      org('daily-done', { lastRunAt: new Date('2026-10-19T03:01:00Z') }),
      org('yesterday', { lastRunAt: new Date('2026-10-18T03:01:00Z') }),
      org('user-before-5', { lastRunAt: new Date('2026-10-19T02:30:00Z') }),
    ];
    expect(dueForDailyRun(orgs, after, BERLIN)).toEqual(['yesterday', 'user-before-5']);
  });

  it('catches up later the same day after a worker outage', () => {
    expect(dueForDailyRun([org('a', { lastRunAt: new Date('2026-10-18T03:01:00Z') })], new Date('2026-10-19T14:00:00Z'), BERLIN)).toEqual(['a']);
  });

  it('waits before retrying an organization that failed', () => {
    const retryAt = new Map([['a', after.getTime() + 60_000]]);
    expect(dueForDailyRun([org('a'), org('b')], after, BERLIN, retryAt)).toEqual(['b']);
    expect(dueForDailyRun([org('a'), org('b')], new Date(after.getTime() + 60_000), BERLIN, retryAt)).toEqual(['a', 'b']);
  });

  it('follows the winter offset after the clocks go back', () => {
    // 05:00 CET on 26 October is 04:00 UTC: at 03:30 UTC it is only 04:30 in Berlin.
    expect(dueForDailyRun([org('a')], new Date('2026-10-26T03:30:00Z'), BERLIN)).toEqual([]);
    expect(dueForDailyRun([org('a')], new Date('2026-10-26T04:00:00Z'), BERLIN)).toEqual(['a']);
  });
});

describe('recalculation after changes', () => {
  const debounce = { quietMs: 120_000, maxWaitMs: 900_000 };

  it('reacts to operation and crop cycle events only', () => {
    expect(recalculates('operation.planned')).toBe(true);
    expect(recalculates('operation.completed')).toBe(true);
    expect(recalculates('crop_cycle.deleted')).toBe(true);
    expect(recalculates('task.created')).toBe(false);
    expect(recalculates('operations.weird')).toBe(false);
  });

  it('waits for a quiet period after the last change', () => {
    const pending = new Map<string, PendingChange>();
    noteChange(pending, 'a', 0);
    noteChange(pending, 'a', 60_000);
    expect(dueAfterChanges(pending, 150_000, debounce)).toEqual([]);
    expect(dueAfterChanges(pending, 180_000, debounce)).toEqual(['a']);
    expect(pending.get('a')).toEqual({ firstAt: 0, lastAt: 60_000 });
  });

  it('does not postpone forever during a long burst of edits', () => {
    const pending = new Map<string, PendingChange>();
    for (let t = 0; t <= 900_000; t += 60_000) noteChange(pending, 'a', t);
    expect(dueAfterChanges(pending, 900_000, debounce)).toEqual(['a']);
  });

  it('handles organizations independently, oldest change first', () => {
    const pending = new Map<string, PendingChange>();
    noteChange(pending, 'late', 100_000);
    noteChange(pending, 'early', 0);
    noteChange(pending, 'busy', 50_000);
    noteChange(pending, 'busy', 200_000);
    expect(dueAfterChanges(pending, 230_000, debounce)).toEqual(['early', 'late']);
  });
});
