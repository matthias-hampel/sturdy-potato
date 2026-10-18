import { contentToPct, grainsForPlants, grainsPerM2, nutrientKgPerHa, seedKgPerHa, sumNutrients } from '@agmeo/contracts';
import { type ApprovalFacts, checkApplication, checkSeries, earliestHarvest, parseBbch } from './psm-checks.js';

const approval: ApprovalFacts = {
  awgId: '025662-00/00-001',
  approvalEndsOn: '2027-12-31',
  useUpUntil: null,
  bbchFrom: 25,
  bbchTo: 61,
  maxApplications: 2,
  minIntervalDays: 14,
  doseMax: 1,
  doseUnitLabel: 'l/ha',
  waitingDays: 35,
};

describe('plant-protection approval checks', () => {
  it('passes an application within the approval', () => {
    expect(checkApplication({ operationId: 'a', date: '2027-05-10', dose: 1, bbch: 39 }, approval, { harvestDate: '2027-07-25', harvestRecorded: false })).toEqual([])
  });

  it('flags dose, stage and waiting period', () => {
    const codes = checkApplication({ operationId: 'a', date: '2027-07-01', dose: 1.25, bbch: 69 }, approval, { harvestDate: '2027-07-20', harvestRecorded: true }).map((f) => [f.code, f.severity]);
    expect(codes).toEqual([['dose_above_max', 'deviation'], ['bbch_outside_window', 'deviation'], ['harvest_before_waiting_period', 'deviation']]);
  });

  it('counts the use-up period, not the approval end', () => {
    const ended = { ...approval, approvalEndsOn: '2026-06-30', useUpUntil: '2027-12-31' };
    expect(checkApplication({ operationId: 'a', date: '2027-05-10', dose: 1, bbch: 39 }, ended)).toEqual([]);
    expect(checkApplication({ operationId: 'a', date: '2028-01-02', dose: 1, bbch: 39 }, ended)[0]).toMatchObject({ code: 'approval_expired', params: { limit: '2027-12-31' } });
  });

  it('only notes a planned harvest inside the waiting period', () => {
    expect(checkApplication({ operationId: 'a', date: '2027-07-01', dose: 1, bbch: 59 }, approval, { harvestDate: '2027-07-20' })[0]).toMatchObject({ code: 'harvest_before_waiting_period', severity: 'notice', params: { earliest: '2027-08-05' } });
  });

  it('checks the number and spacing of applications on one crop', () => {
    const apps = [
      { operationId: 'a', date: '2027-04-10', dose: 1, bbch: 31 },
      { operationId: 'b', date: '2027-04-20', dose: 1, bbch: 32 },
      { operationId: 'c', date: '2027-05-20', dose: 1, bbch: 49 },
    ];
    expect(checkSeries(apps, approval).map((f) => [f.code, f.operationId])).toEqual([['too_many_applications', 'c'], ['interval_too_short', 'b']]);
  });

  it('reads BBCH text and dates the earliest harvest', () => {
    expect(parseBbch('BBCH 31-32')).toBe(32);
    expect(parseBbch('')).toBeNull();
    expect(earliestHarvest('2027-05-10', 35)).toBe('2027-06-14');
    expect(earliestHarvest('2027-05-10', null)).toBeNull();
  });
});

describe('nutrients from product and rate', () => {
  it('works for mineral fertilizers by mass and by volume', () => {
    expect(nutrientKgPerHa({ nPct: 27 }, 200, 'kg')).toMatchObject({ n: 54, p2o5: null, densityAssumed: false });
    // AHL 28: density 1.28 t/m³, 100 l/ha → 35.84 kg N.
    expect(nutrientKgPerHa({ nPct: 28, densityTM3: 1.28 }, 100, 'l').n).toBe(35.84);
    // Without a density a mineral volume cannot be converted.
    expect(nutrientKgPerHa({ nPct: 28 }, 100, 'l').n).toBeNull();
  });

  it('works for organic fertilizers, assuming 1 t/m³ when no density is recorded', () => {
    // Cattle slurry 4.0 kg N/m³ at 1.0 t/m³ = 0.4 %.
    expect(contentToPct(4, 'kg_m3', 1)).toBe(0.4);
    expect(contentToPct(5.5, 'kg_t')).toBe(0.55);
    const slurry = { nPct: 0.4, nh4NPct: 0.2, p2o5Pct: 0.17, fertilizerType: 'cattle_slurry' as const };
    expect(nutrientKgPerHa(slurry, 25, 'm3')).toMatchObject({ n: 100, nh4N: 50, p2o5: 42.5, densityAssumed: true });
    expect(nutrientKgPerHa({ ...slurry, densityTM3: 1.02 }, 25, 'm3')).toMatchObject({ n: 102, densityAssumed: false });
    expect(nutrientKgPerHa({ nPct: 0.65 }, 20, 't').n).toBe(130);
  });

  it('sums lines per nutrient', () => {
    const a = nutrientKgPerHa({ nPct: 27 }, 200, 'kg');
    const b = nutrientKgPerHa({ nPct: 18, p2o5Pct: 46 }, 100, 'kg');
    expect(sumNutrients([a, b])).toMatchObject({ n: 72, p2o5: 46, k2o: null });
  });
});

describe('seed rates', () => {
  it('converts plants, grains and kg', () => {
    expect(grainsForPlants(282, 94)).toBeCloseTo(300);
    expect(seedKgPerHa(300, 48)).toBe(144);
    expect(grainsPerM2(144, 48)).toBe(300);
  });
});
