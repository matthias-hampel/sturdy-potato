import { estimateNDenitrification, estimateNLoss, estimateNMineralization, estimateNMinSpring, fieldNEstimates, lufaToSoilClass, nDifference } from './estimates.js';
import { getDefaultNResidual } from './nitrogen.js';

describe('agmeo N estimates (reference lib/farmalyzer/nitrogen.ts)', () => {
  it('classes the LUFA soil types as the reference does', () => {
    expect(['S', 'lS'].map(lufaToSoilClass)).toEqual(['light', 'light']);
    expect(['sU', 'ssL', 'lU', 'sL', 'uL', 'L'].map(lufaToSoilClass)).toEqual(Array(6).fill('medium'));
    expect(['utL', 'tL', 'T'].map(lufaToSoilClass)).toEqual(['heavy', 'heavy', 'heavy']);
    expect(lufaToSoilClass(null)).toBe('medium');
  });

  it('reads spring mineralisation from the humus bands', () => {
    expect(estimateNMinSpring('light', 1.5)).toBe(5);
    expect(estimateNMinSpring('medium', 2)).toBe(12);
    expect(estimateNMinSpring('heavy', 3)).toBe(25);
    expect(estimateNMinSpring('medium', 8)).toBe(30);
    expect(estimateNMinSpring('heavy', 12)).toBe(50);
  });

  it('estimates losses, denitrification and mineralisation per class', () => {
    expect(['light', 'medium', 'heavy'].map((c) => estimateNLoss(c as 'light'))).toEqual([35, 25, 15]);
    expect(['light', 'medium', 'heavy'].map((c) => estimateNDenitrification(c as 'light'))).toEqual([10, 12, 10]);
    expect(estimateNMineralization('medium', 3)).toBe(45);
  });

  it('defaults to a medium soil with 2 % humus and no residual N without a crop', () => {
    expect(fieldNEstimates(null, null, null)).toEqual({ nMin: 35, nMinSpring: 12, nLeaching: 13, nResidual: 0 });
    expect(fieldNEstimates('S', 1, 'winterWheat')).toEqual({ nMin: 25, nMinSpring: 5, nLeaching: 25, nResidual: getDefaultNResidual('winterWheat') });
  });

  it('balances demand against supply and losses', () => {
    // 200 − round(35 + 12 + 10) + 13 + 20 = 176
    expect(nDifference({ nDemand: 200, nMin: 35, nMinSpring: 12, deductions: 10, nLeaching: 13, nResidual: 20 })).toBe(176);
  });
});
