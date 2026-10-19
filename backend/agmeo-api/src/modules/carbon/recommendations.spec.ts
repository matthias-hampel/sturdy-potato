import { carbonSavingScenarios } from '@agmeo/contracts';
import PARAMS from './bek/parameters.js';
import {
  type CarbonInputLine,
  operationEmissionsPerHa,
  sumEmissions,
} from './emissions.js';
import { hasStraw, operationMeasures, strawMeasure } from './recommendations.js';

const fert = (
  type: string,
  nPct: number,
  rate: number,
  extra: Partial<CarbonInputLine['product']> = {},
): CarbonInputLine => ({
  ratePerHa: rate,
  product: {
    name: type,
    category: 'fertilizer',
    baseUnit: 'kg',
    fertilizerType: type as never,
    nPct,
    ...extra,
  },
});
const op = (
  inputs: CarbonInputLine[],
  incorporationHours: number | null = null,
) => ({
  type: 'fertilization',
  dieselLPerHa: 0,
  incorporationHours,
  inputs,
});

describe('emission recommendations (reference sanityChecker)', () => {
  it('prices a urea with inhibitor from a green-technology plant by the lower production factor', () => {
    const urea = fert('urea_inhibitor', 46, 200);
    const [m] = operationMeasures(op([urea]), 'winter_wheat', 2026);
    expect(m.type).toBe('mineralBlueFertilizer');
    expect(m.productName).toBe('urea_inhibitor');
    // 92 kg N/ha: only the production factor of the urea N changes (pb1a).
    expect(m.savedKgPerHa).toBeCloseTo(
      92 * (PARAMS.ef.supplyUrea - PARAMS.ef.supplyGreenFertilizer),
      1,
    );
    expect(m.savedKgPerHa).toBeGreaterThan(0);
    // A liquid product uses the liquid factor.
    const liquid = fert('urea_inhibitor', 28, 300, { baseUnit: 'l', densityTM3: 1.28 });
    const [l] = operationMeasures(op([liquid]), 'winter_wheat', 2026);
    expect(l.savedKgPerHa).toBeCloseTo(
      300 * 1.28 * 0.28 * (PARAMS.ef.supplyUrea - PARAMS.ef.supplyGreenFertilizerLiquid),
      0,
    );
  });

  it('recommends nothing for fertilizers without a green counterpart', () => {
    expect(operationMeasures(op([fert('can', 27, 300)]), 'winter_wheat')).toEqual([]);
    expect(operationMeasures(op([fert('urea', 46, 200)]), 'winter_wheat')).toEqual([]);
  });

  it('prices working in organic fertilizer within the hour instead of after four hours', () => {
    const slurry = fert('cattle_slurry', 0.4, 25_000, { nh4NPct: 0.2 });
    const [m] = operationMeasures(op([slurry], 4), 'winter_wheat', 2026);
    expect(m.type).toBe('incorporation');
    const before = sumEmissions(operationEmissionsPerHa(op([slurry], 4), 'winterWheat', 2026).byId);
    const after = sumEmissions(operationEmissionsPerHa(op([slurry], 1), 'winterWheat', 2026).byId);
    expect(m.savedKgPerHa).toBeCloseTo(before - after, 1);
    expect(m.savedKgPerHa).toBeGreaterThan(0);
    // Already within the hour, or not worked in at all (top dressing): nothing to recommend.
    expect(operationMeasures(op([slurry], 1), 'winter_wheat')).toEqual([]);
    expect(operationMeasures(op([slurry], null), 'winter_wheat')).toEqual([]);
  });

  it('prices leaving the straw on the field for harvested cereals', () => {
    expect(hasStraw('winter_wheat')).toBe(true);
    expect(hasStraw('silage_maize')).toBe(false);
    const wheat = { cropCode: 'winter_wheat', crop: 'winterWheat' as const, yieldTHa: 8, strawRemoved: true, nLastYearKgHa: 0 };
    const m = strawMeasure(wheat, 2026)!;
    expect(m.type).toBe('restStraw');
    expect(m.savedKgPerHa).toBeGreaterThan(0);
    expect(strawMeasure({ ...wheat, strawRemoved: false }, 2026)).toBeNull();
    expect(strawMeasure({ ...wheat, yieldTHa: null }, 2026)).toBeNull();
    expect(strawMeasure({ ...wheat, cropCode: 'silage_maize', crop: 'silageMaize' }, 2026)).toBeNull();
  });

  it('builds the reduction scenarios like the reference chart', () => {
    const s = carbonSavingScenarios(10_000, [
      { key: 'a', savedKg: 1500 },
      { key: 'b', savedKg: 800 },
      { key: 'c', savedKg: 300 },
    ]);
    // 0 %, 10 %, 20 % and the maximum (26 %); 30 % is out of reach.
    expect(s.map((x) => x.share)).toEqual([0, 0.1, 0.2, null]);
    expect(s[1].measures).toEqual([{ key: 'a', savedKg: 1500, countedKg: 1000 }]);
    expect(s[2].measures.map((m) => [m.key, m.countedKg])).toEqual([
      ['a', 1500],
      ['b', 500],
    ]);
    expect(s[3]).toMatchObject({ savedKg: 2600, remainingKg: 7400 });
    expect(s[3].measures.every((m) => m.countedKg === m.savedKg)).toBe(true);
    expect(carbonSavingScenarios(0, [])).toEqual([{ share: 0, savedKg: 0, remainingKg: 0, measures: [] }]);
  });
});
