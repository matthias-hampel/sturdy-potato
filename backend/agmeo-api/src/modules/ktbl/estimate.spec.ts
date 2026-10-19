/**
 * Combined estimator (agmeo `src/lib/ktbl/index.ts`): grid values (V2) with a crop or crop group,
 * the CROSS formula (V1) otherwise. Expected values are cells of data/ktbl/actionCostsDataGrouped.json.
 */
import { estimateActionCosts as estimateV1 } from './action-cost-estimator.js';
import { estimateActionCosts, estimateKtbl } from './estimate.js';

const PLOWING = 'PLOWING__RP7_1000';

describe('estimateKtbl', () => {
  it('reads the grid at a grid point (the README example: plowing, winter wheat, 10 ha, 5 km, 120 kW)', () => {
    const { costs, method } = estimateKtbl(PLOWING, { crop: 'winterWheat', fieldSizeHa: 10, distanceKm: 5, mechKw: 120 });
    expect(method).toBe('grid');
    expect(costs).toEqual({ hours: 1.03, diesel: 15.92, depreciation: 14, interest: 4.12, miscellaneous: 2.0399999999999996, repairs: 19.7, materials: 13.53, services: 0 });
  });

  it('takes the crop group directly', () => {
    expect(estimateKtbl(PLOWING, { group: 'cereals' })).toEqual(estimateKtbl(PLOWING, { crop: 'winterWheat' }));
  });

  it('interpolates between grid field sizes', () => {
    const at10 = estimateKtbl(PLOWING, { group: 'cereals', fieldSizeHa: 10 }).costs;
    const at15 = estimateKtbl(PLOWING, { group: 'cereals', fieldSizeHa: 15 }).costs;
    const at20 = estimateKtbl(PLOWING, { group: 'cereals', fieldSizeHa: 20 }).costs;
    expect(at20.hours).toBeCloseTo(0.98, 10);
    expect(at15.hours).toBeCloseTo((at10.hours + at20.hours) / 2, 10);
    expect(at15.diesel).toBeCloseTo((15.92 + 15.66) / 2, 10);
  });

  it('uses the formula without crop, with a soil type and for loading fertilizer by amount', () => {
    expect(estimateKtbl(PLOWING)).toEqual({ costs: estimateV1(PLOWING), method: 'formula' });
    expect(estimateKtbl(PLOWING, { group: 'cereals', soilType: 'HS' }).method).toBe('formula');
    expect(estimateKtbl('LOADING_FERTILIZER__WLS_1000', { crop: 'canola', productAmountKgHa: 300 }).method).toBe('formula');
  });

  it('maps FQNs without own data onto their neighbouring variant', () => {
    expect(estimateKtbl('PLANTING__CRPF24_1000', { group: 'maize' })).toEqual(estimateKtbl('PLANTING__CRPF24_1500', { group: 'maize' }));
  });

  it('returns zeros for an unknown FQN', () => {
    expect(estimateActionCosts('NONEXISTENT__FQN_1000', { crop: 'winterWheat' })).toEqual({
      hours: 0, diesel: 0, depreciation: 0, interest: 0, miscellaneous: 0, repairs: 0, materials: 0, services: 0,
    });
  });
});
