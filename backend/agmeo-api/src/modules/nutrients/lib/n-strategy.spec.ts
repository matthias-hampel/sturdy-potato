import { defaultSplits, nextDoseDate, planDoses } from './n-strategy.js';

describe('fertilization strategies', () => {
  it('splits evenly with the remainder on the first dose', () => {
    expect(defaultSplits(1)).toEqual([100]);
    expect(defaultSplits(2)).toEqual([50, 50]);
    expect(defaultSplits(3)).toEqual([34, 33, 33]);
  });

  it('turns the need into kg N and product rates per dose', () => {
    // Calcium ammonium nitrate: 27 % N → 0.27 kg N per kg.
    const doses = planDoses(150, [30, 70], () => 0.27);
    expect(doses).toEqual([
      { index: 0, pct: 30, kgN: 45, rate: 166.7 },
      { index: 1, pct: 70, kgN: 105, rate: 388.9 },
    ]);
  });

  it('plans nothing below zero and no rate for a product without N', () => {
    expect(planDoses(-20, [100], () => 0.27)).toEqual([{ index: 0, pct: 100, kgN: 0, rate: 0 }]);
    expect(planDoses(100, [50, 50], (i) => (i === 0 ? null : 0.46))[0].rate).toBeNull();
  });

  it('plans the next dose a month later, at the end of a shorter month', () => {
    expect(nextDoseDate('2027-03-15')).toBe('2027-04-15');
    expect(nextDoseDate('2027-01-31')).toBe('2027-02-28');
    expect(nextDoseDate('2026-12-10')).toBe('2027-01-10');
  });
});
