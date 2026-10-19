import { calibrationHashOfSpec, groupOffsetBatches, meanOffset, modelMedianNearest, type OffsetRow, parseFaoMaturity, resolveCalibration } from './calibration.js';

describe('calibrationHashOfSpec', () => {
  it('is deterministic and differs by spec + source', () => {
    const a = calibrationHashOfSpec({ offset: 0.05 }, 'variety:v1:2025');
    const b = calibrationHashOfSpec({ offset: 0.05 }, 'variety:v1:2025');
    const c = calibrationHashOfSpec({ offset: 0.06 }, 'variety:v1:2025');
    const d = calibrationHashOfSpec({ measured_dm: 0.3, measured_at: '2025-08-20' }, 'field:f1:2025');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toHaveLength(32);
  });
});

describe('resolveCalibration', () => {
  const measurement = { id: 'm1', measurementDate: '2026-08-20', measuredDm: 0.29 };
  const varietyOffset = { id: 'o1', varietyId: 'v1', offset: -0.02 };

  it('prefers the cycle’s own measurement (field mode) over the variety offset', () => {
    const r = resolveCalibration({ cropCycleId: 'c1', harvestYear: 2026, measurement, varietyOffset });
    expect(r).toMatchObject({ kind: 'measurement', spec: { measured_dm: 0.29, measured_at: '2026-08-20' } });
  });

  it('falls back to the variety offset, then to none', () => {
    expect(resolveCalibration({ cropCycleId: 'c1', harvestYear: 2026, measurement: null, varietyOffset })).toMatchObject({ kind: 'variety_offset', spec: { offset: -0.02 } });
    expect(resolveCalibration({ cropCycleId: 'c1', harvestYear: 2026, measurement: null, varietyOffset: null })).toBeNull();
  });

  it('changes the hash when a new offset row replaces an equal one (re-apply busts the cache)', () => {
    const a = resolveCalibration({ cropCycleId: 'c1', harvestYear: 2026, measurement: null, varietyOffset });
    const b = resolveCalibration({ cropCycleId: 'c1', harvestYear: 2026, measurement: null, varietyOffset: { ...varietyOffset, id: 'o2' } });
    expect(a!.hash).not.toBe(b!.hash);
  });
});

describe('modelMedianNearest', () => {
  const daily = [
    { date: '2026-09-01', median: 0.28 },
    { date: '2026-09-02', median: 0.29 },
    { date: '2026-09-03', median: 0.3 },
  ];
  it('picks the day nearest the measurement and clamps outside the window', () => {
    expect(modelMedianNearest(daily, '2026-09-02')).toBe(0.29);
    expect(modelMedianNearest(daily, '2026-08-20')).toBe(0.28);
    expect(modelMedianNearest(daily, '2026-09-30')).toBe(0.3);
    expect(modelMedianNearest([], '2026-09-30')).toBeNull();
  });
});

describe('meanOffset', () => {
  it('averages the pool and is null without points', () => {
    expect(meanOffset([-0.02, -0.04])).toBeCloseTo(-0.03, 10);
    expect(meanOffset([])).toBeNull();
  });
});

describe('parseFaoMaturity', () => {
  it('reads BSL-style texts and plain numbers', () => {
    expect(parseFaoMaturity('S 250')).toBe(250);
    expect(parseFaoMaturity('K220')).toBe(220);
    expect(parseFaoMaturity('230,5')).toBe(231);
    expect(parseFaoMaturity(240)).toBe(240);
    expect(parseFaoMaturity('mittelfrüh')).toBeNull();
    expect(parseFaoMaturity(null)).toBeNull();
  });
});

describe('groupOffsetBatches', () => {
  const row = (overrides: Partial<OffsetRow>): OffsetRow => ({
    id: 'row-1',
    varietyId: 'v1',
    variety: 'Amaroc',
    offset: -0.02,
    suggestedOffset: -0.021,
    basisCount: 12,
    basisFrom: '2026-08-01',
    basisTo: '2026-08-31',
    comment: null,
    appliedBy: 'Anna',
    appliedAt: '2026-09-01T10:00:00.000Z',
    supersededAt: null,
    ...overrides,
  });

  it('groups rows applied together into one batch', () => {
    const batches = groupOffsetBatches([row({ id: 'a', varietyId: 'v1', variety: 'Amaroc' }), row({ id: 'b', varietyId: 'v2', variety: 'Benedictio' }), row({ id: 'c', varietyId: 'v3', variety: 'Corasano' })]);
    expect(batches).toHaveLength(1);
    expect(batches[0].varieties.map((v) => v.rowId)).toEqual(['a', 'b', 'c']);
    expect(batches[0].offset).toBe(-0.02);
  });

  it('splits by offset value, user and apply time', () => {
    const batches = groupOffsetBatches([
      row({ id: 'a', varietyId: 'v1' }),
      row({ id: 'b', varietyId: 'v2', offset: -0.03 }),
      row({ id: 'c', varietyId: 'v3', appliedBy: 'Ben' }),
      row({ id: 'd', varietyId: 'v4', appliedAt: '2026-09-02T10:00:00.000Z' }),
    ]);
    expect(batches).toHaveLength(4);
  });

  it('splits a partially revoked batch by status', () => {
    const batches = groupOffsetBatches([row({ id: 'a', varietyId: 'v1' }), row({ id: 'b', varietyId: 'v2', supersededAt: '2026-09-05T08:00:00.000Z' })]);
    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.supersededAt === null)?.varieties.map((v) => v.rowId)).toEqual(['a']);
    expect(batches.find((b) => b.supersededAt !== null)?.varieties.map((v) => v.rowId)).toEqual(['b']);
  });

  it('sorts varieties by name inside a batch and batches by appliedAt desc', () => {
    const batches = groupOffsetBatches([
      row({ id: 'old', varietyId: 'v9', variety: 'Zeta', appliedAt: '2026-08-20T10:00:00.000Z' }),
      row({ id: 'b', varietyId: 'v2', variety: 'Benedictio' }),
      row({ id: 'a', varietyId: 'v1', variety: 'Amaroc' }),
      // Null variety name falls back to the varietyId for ordering.
      row({ id: 'c', varietyId: 'AAA-id', variety: null }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].varieties.map((v) => v.rowId)).toEqual(['c', 'a', 'b']);
    expect(batches[1].varieties.map((v) => v.rowId)).toEqual(['old']);
  });

  it('returns an empty list for no rows', () => {
    expect(groupOffsetBatches([])).toEqual([]);
  });
});
