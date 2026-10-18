import { CO2E_FACTOR_SET, operationEmissions } from './co2e.js';

describe('CO2e of operations', () => {
  it('counts diesel combustion and machinery per litre', () => {
    expect(operationEmissions({ inputs: [], dieselL: 10 })).toEqual({ diesel: 30.13, machinery: 8.85 });
    expect(CO2E_FACTOR_SET).toMatch(/^DE-BEK/);
  });

  it('counts mineral N: direct and indirect N2O, production', () => {
    // 100 kg N as CAN: N2O direct 100 × 0.01225 × 44/28 × 273 = 525.5; indirect 100 × 0.01 × 0.01 × … = 4.29.
    const e = operationEmissions({ inputs: [{ category: 'fertilizer', baseUnit: 'kg', totalQuantity: 370.37, product: { nPct: 27, fertilizerType: 'can' } }], dieselL: 0 });
    expect(e.n2o_direct).toBeCloseTo(525.5, 0);
    expect(e.n2o_indirect).toBeCloseTo(4.29, 1);
    expect(e.fertilizer_supply).toBeCloseTo(352, 0);
    expect(e.lime_urea_co2).toBeUndefined();
  });

  it('adds urea CO2 and higher NH3 losses for urea', () => {
    const e = operationEmissions({ inputs: [{ category: 'fertilizer', baseUnit: 'kg', totalQuantity: 217.39, product: { nPct: 46, fertilizerType: 'urea' } }], dieselL: 0 });
    expect(e.lime_urea_co2).toBeCloseTo(157, 0);
    expect(e.n2o_indirect).toBeCloseTo(54.9, 0);
  });

  it('uses ammonium losses by technique for slurry and no production emissions', () => {
    const slurry = { category: 'fertilizer', baseUnit: 'm3' as const, totalQuantity: 25, product: { nPct: 0.4, nh4NPct: 0.2, fertilizerType: 'cattle_slurry' as const } };
    const broadcast = operationEmissions({ inputs: [slurry], dieselL: 0, technique: 'broadcast' });
    const injected = operationEmissions({ inputs: [slurry], dieselL: 0, technique: 'injection' });
    expect(broadcast.fertilizer_supply).toBeUndefined();
    expect(broadcast.n2o_indirect!).toBeGreaterThan(injected.n2o_indirect!);
  });

  it('counts plant protection products and seed', () => {
    expect(operationEmissions({ inputs: [{ category: 'crop_protection', baseUnit: 'l', totalQuantity: 10, product: { fertilizerType: null } }], dieselL: 0 }).plant_protection).toBeCloseTo(38.8, 1);
    expect(operationEmissions({ inputs: [{ category: 'seed', baseUnit: 'kg', totalQuantity: 180, product: { fertilizerType: null } }], dieselL: 0 }).seed).toBe(90);
  });
});
