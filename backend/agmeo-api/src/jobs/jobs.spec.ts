import { retryDelayMs } from './runner.js';
import { slotStart } from './scheduler.js';

describe('schedule slots', () => {
  it('aligns daily slots to UTC midnight plus the offset', () => {
    const daily = { kind: 'x', everyMinutes: 1440, offsetMinutes: 180 };
    expect(slotStart(daily, new Date('2026-10-18T05:00:00Z')).toISOString()).toBe('2026-10-18T03:00:00.000Z');
    // Before today's offset the slot is still yesterday's.
    expect(slotStart(daily, new Date('2026-10-18T02:59:00Z')).toISOString()).toBe('2026-10-17T03:00:00.000Z');
  });

  it('gives every moment within a slot the same start', () => {
    const hourly = { kind: 'x', everyMinutes: 60 };
    const a = slotStart(hourly, new Date('2026-10-18T10:00:00Z'));
    const b = slotStart(hourly, new Date('2026-10-18T10:59:59Z'));
    expect(a.getTime()).toBe(b.getTime());
    expect(slotStart(hourly, new Date('2026-10-18T11:00:00Z')).getTime()).toBe(a.getTime() + 3600_000);
  });
});

describe('retry backoff', () => {
  it('doubles from 30 seconds and stops at six hours', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(5)).toBe(480_000);
    expect(retryDelayMs(30)).toBe(6 * 3600_000);
  });
});
