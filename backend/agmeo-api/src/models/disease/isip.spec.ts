import { collapseDiseaseRisk } from './diseaseRisk.js';
import { isWithinIsipSeason, parseISIPResponse, type ISIPResponse } from './isip.js';

const response = (variables: ISIPResponse['nodes']['result']['variables']): ISIPResponse => ({ nodes: { result: { variables } } });

describe('ISIP response', () => {
  it('keeps the diseases of the crop, clamped to 0..3, per day', () => {
    const parsed = parseISIPResponse(
      response({
        date: { data: ['2026-04-01', '2026-04-02'] },
        'brown rust': { data: [1, 4] },
        'yellow rust': { data: [0, -1] },
        'net blotch': { data: [3, 3] }, // a barley disease: not for wheat
        'septoria tritici': { data: [2] },
      }),
      'winter wheat',
    );
    expect(Object.fromEntries(parsed)).toEqual({
      '2026-04-01': { brownRust: 1, yellowRust: 0, septoriaTritici: 2 },
      '2026-04-02': { brownRust: 3, yellowRust: 0 },
    });
    expect(collapseDiseaseRisk(Object.fromEntries(parsed), 'winterWheat')).toEqual([
      { date: '2026-04-01', value: 2 },
      { date: '2026-04-02', value: 3 },
    ]);
  });

  it('is empty without dates or variables', () => {
    expect(parseISIPResponse(response({}), 'winter barley').size).toBe(0);
    expect(parseISIPResponse({} as ISIPResponse, 'winter barley').size).toBe(0);
  });
});

describe('ISIP season', () => {
  it('starts per crop and ends on June 30', () => {
    expect(isWithinIsipSeason('2026-02-15', 'winter barley')).toBe(true);
    expect(isWithinIsipSeason('2026-02-15', 'winter wheat')).toBe(false);
    expect(isWithinIsipSeason('2026-03-01', 'winter wheat')).toBe(true);
    expect(isWithinIsipSeason('2026-04-19', 'summer barley')).toBe(false);
    expect(isWithinIsipSeason('2026-04-20', 'summer barley')).toBe(true);
    expect(isWithinIsipSeason('2026-06-30', 'winter rye')).toBe(true);
    expect(isWithinIsipSeason('2026-07-01', 'winter rye')).toBe(false);
  });
});
