import { addDays, defaultDateInSeason, nextRotationPosition, stepDate } from './dates.js';

const season2027 = { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' };
const calendar2027 = { harvestYear: 2027, startDate: '2027-01-01', endDate: '2027-12-31' };

describe('crop default dates in a season', () => {
  it('puts autumn sowing in the year before the harvest year for harvest-to-harvest seasons', () => {
    expect(defaultDateInSeason('10-10', season2027)).toBe('2026-10-10');
    expect(defaultDateInSeason('07-25', season2027)).toBe('2027-07-25');
    expect(defaultDateInSeason('04-25', season2027)).toBe('2027-04-25');
  });

  it('falls back to the year before for winter crops when the season has no such day', () => {
    const short = { harvestYear: 2027, startDate: '2027-02-01', endDate: '2027-09-30' };
    expect(defaultDateInSeason('10-10', short, true)).toBe('2026-10-10');
    expect(defaultDateInSeason('10-10', short, false)).toBe('2027-10-10');
  });

  it('finds the day inside calendar-year seasons', () => {
    expect(defaultDateInSeason('10-10', calendar2027)).toBe('2027-10-10');
  });

  it('handles 29 February in common years', () => {
    expect(defaultDateInSeason('02-29', season2027)).toBe('2027-02-28');
  });
});

describe('template step dates', () => {
  const dates = { sowing: '2026-10-10', harvest: '2027-07-25', seasonStart: '2026-08-01' };
  it('counts offsets from the anchor', () => {
    expect(stepDate('sowing', -14, dates)).toBe('2026-09-26');
    expect(stepDate('harvest', 0, dates)).toBe('2027-07-25');
    expect(stepDate('season_start', 31, dates)).toBe('2026-09-01');
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
  });

  it('has no date without an anchor', () => {
    expect(stepDate('harvest', 5, { ...dates, harvest: null })).toBeNull();
  });
});

describe('next crop of a rotation', () => {
  const entries = [
    { position: 0, cropId: 'rape', templateId: null },
    { position: 1, cropId: 'wheat', templateId: 'ww-a' },
    { position: 2, cropId: 'wheat', templateId: 'ww-b' },
    { position: 3, cropId: 'barley', templateId: null },
  ];

  it('follows last season’s crop and wraps round', () => {
    expect(nextRotationPosition(entries, { cropId: 'rape', templateId: null }, 2027, 2020)).toBe(1);
    expect(nextRotationPosition(entries, { cropId: 'barley', templateId: null }, 2027, 2020)).toBe(0);
  });

  it('tells repeated crops apart by template', () => {
    expect(nextRotationPosition(entries, { cropId: 'wheat', templateId: 'ww-b' }, 2027, 2020)).toBe(3);
    expect(nextRotationPosition(entries, { cropId: 'wheat', templateId: null }, 2027, 2020)).toBe(2);
  });

  it('counts from the start year without a matching crop', () => {
    expect(nextRotationPosition(entries, null, 2027, 2027)).toBe(0);
    expect(nextRotationPosition(entries, { cropId: 'maize', templateId: null }, 2029, 2027)).toBe(2);
  });
});
