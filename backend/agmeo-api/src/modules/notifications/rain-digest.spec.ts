import { buildRainDigest, decideDigest, type DigestInputRow } from './rain-digest.js';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

describe('decideDigest (ported from the reference)', () => {
  it('waits for the morning', () => {
    expect(decideDigest({ localMinutes: at('06:15'), total: 10, fresh: 10 })).toBe('not-yet');
  });

  it('sends once the weather is fresh enough', () => {
    expect(decideDigest({ localMinutes: at('06:30'), total: 10, fresh: 9 })).toBe('send');
    expect(decideDigest({ localMinutes: at('06:30'), total: 10, fresh: 8 })).toBe('wait-for-weather');
  });

  it('sends late at the deadline whatever the freshness', () => {
    expect(decideDigest({ localMinutes: at('09:29'), total: 10, fresh: 0 })).toBe('wait-for-weather');
    expect(decideDigest({ localMinutes: at('09:30'), total: 10, fresh: 0 })).toBe('send-late');
    expect(decideDigest({ localMinutes: at('09:30'), total: 10, fresh: 10 })).toBe('send');
  });

  it('skips the day after noon or without fields', () => {
    expect(decideDigest({ localMinutes: at('12:00'), total: 10, fresh: 10 })).toBe('skip-day');
    expect(decideDigest({ localMinutes: at('07:00'), total: 0, fresh: 0 })).toBe('skip-day');
  });
});

const fresh = new Date('2026-09-27T03:10:00Z');
const cutoff = new Date('2026-09-27T02:00:00Z');
const row = (name: string, mm: number | null, over: Partial<DigestInputRow> = {}): DigestInputRow => ({
  fieldId: `f-${name}`,
  farmId: 'farm-a',
  name,
  areaHa: 10,
  crop: 'Winterweizen',
  precipMm: mm,
  refreshedAt: fresh,
  ...over,
});
const opts = { system: 'metric' as const, freshCutoff: cutoff, farmIds: null };

describe('buildRainDigest (ported from the reference)', () => {
  it('ranks driest and wettest, counts fields above the threshold', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => row(name, i * 2.4));
    const digest = buildRainDigest(rows, opts)!;
    expect(digest.totalFields).toBe(7);
    expect(digest.rainedFields).toBe(6);
    expect(digest.least.map((f) => f.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(digest.most.map((f) => f.name)).toEqual(['G', 'F', 'E', 'D', 'C']);
    expect(digest.most[0].precipMm).toBe(14.4);
    expect(digest.stale).toBe(false);
  });

  it('uses the imperial threshold (a tenth of an inch) for imperial orgs', () => {
    const rows = [row('A', 2), row('B', 3)];
    expect(buildRainDigest(rows, { ...opts, system: 'imperial' })?.rainedFields).toBe(1);
    expect(buildRainDigest(rows, opts)?.rainedFields).toBe(2);
  });

  it('breaks ties by name and leaves rows without coverage out', () => {
    const digest = buildRainDigest([row('Zeta', 1), row('Alpha', 1), row('Gap', null)], opts)!;
    expect(digest.totalFields).toBe(2);
    expect(digest.least.map((f) => f.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('is stale when the oldest update predates this morning', () => {
    const digest = buildRainDigest([row('A', 1), row('B', 1, { refreshedAt: new Date('2026-09-26T03:00:00Z') })], opts)!;
    expect(digest.stale).toBe(true);
    expect(digest.dataAsOf?.toISOString()).toBe('2026-09-26T03:00:00.000Z');
  });

  it('limits the fields to the farms a member may see', () => {
    const rows = [row('A', 1), row('B', 5, { farmId: 'farm-b' })];
    expect(buildRainDigest(rows, { ...opts, farmIds: ['farm-b'] })?.most.map((f) => f.name)).toEqual(['B']);
    expect(buildRainDigest(rows, { ...opts, farmIds: [] })).toBeNull();
  });

  it('is null without any usable row', () => {
    expect(buildRainDigest([row('A', null)], opts)).toBeNull();
    expect(buildRainDigest([], opts)).toBeNull();
  });
});

describe('isoWeekKey', () => {
  it('numbers weeks after ISO 8601', async () => {
    const { isoWeekKey } = await import('./digest.jobs.js');
    expect(isoWeekKey(new Date('2026-10-19T06:00:00Z'))).toBe('2026-W43');
    expect(isoWeekKey(new Date('2027-01-01T06:00:00Z'))).toBe('2026-W53');
  });
});
