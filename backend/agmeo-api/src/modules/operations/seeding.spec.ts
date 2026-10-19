// Ported from the reference's lib/seeding/rate.test.ts.
import {
  DEFAULT_GERMINATION_RATE,
  distributeTotalSeedKg,
  grainsPerM2FromKgHa,
  grainsPerM2FromPlants,
  kgHaFromGrainsPerM2,
  plantsPerM2FromGrains,
  seedPackagesForGrains,
  seedPackagesForStand,
} from '@agmeo/contracts';

/** Winter wheat: 320 plants/m², TKG 45 g. */
const PLANTS_PER_M2 = 320;
const TKG_G = 45;

describe('grains and plants', () => {
  it('drills more grains than the stand it is aiming for', () => {
    const grains = grainsPerM2FromPlants(PLANTS_PER_M2, DEFAULT_GERMINATION_RATE);
    expect(grains).toBeGreaterThan(PLANTS_PER_M2);
    expect(grains).toBeCloseTo(340.43, 2);
  });

  it('is a round trip, so the two directions cannot drift apart', () => {
    const grains = grainsPerM2FromPlants(PLANTS_PER_M2, DEFAULT_GERMINATION_RATE);
    expect(plantsPerM2FromGrains(grains, DEFAULT_GERMINATION_RATE)).toBeCloseTo(PLANTS_PER_M2, 10);
  });

  it('changes nothing at 100 % germination — every grain stands', () => {
    expect(grainsPerM2FromPlants(PLANTS_PER_M2, 100)).toBe(PLANTS_PER_M2);
    expect(plantsPerM2FromGrains(PLANTS_PER_M2, 100)).toBe(PLANTS_PER_M2);
  });

  it('costs 6 % of the crop when the germination leg is skipped', () => {
    const drilled = grainsPerM2FromPlants(PLANTS_PER_M2, DEFAULT_GERMINATION_RATE)!;
    const shortfall = (drilled - PLANTS_PER_M2) / drilled;
    expect(shortfall).toBeCloseTo(1 - DEFAULT_GERMINATION_RATE / 100, 10);
    expect(shortfall).toBeGreaterThan(0.05);
  });
});

describe('grains and weight', () => {
  it('weighs a drill setting', () => {
    // 340.43 grains/m² × 10 000 m²/ha × 45 g / 1 000 000 = 153.19 kg/ha
    const grains = grainsPerM2FromPlants(PLANTS_PER_M2, DEFAULT_GERMINATION_RATE);
    expect(kgHaFromGrainsPerM2(grains, TKG_G)).toBeCloseTo(153.19, 2);
  });

  it('is a round trip', () => {
    const kgHa = kgHaFromGrainsPerM2(400, TKG_G);
    expect(grainsPerM2FromKgHa(kgHa, TKG_G)).toBeCloseTo(400, 10);
  });

  it('scales with the thousand-grain weight, not with germination', () => {
    expect(kgHaFromGrainsPerM2(400, 50)!).toBeGreaterThan(kgHaFromGrainsPerM2(400, 45)!);
  });
});

describe('missing inputs', () => {
  it('says nothing rather than nought when a factor is absent', () => {
    expect(kgHaFromGrainsPerM2(400, null)).toBeNull();
    expect(grainsPerM2FromKgHa(null, TKG_G)).toBeNull();
    expect(grainsPerM2FromPlants(PLANTS_PER_M2, null)).toBeNull();
    expect(plantsPerM2FromGrains(null, DEFAULT_GERMINATION_RATE)).toBeNull();
  });

  it('treats a zero divisor as missing instead of dividing by it', () => {
    expect(grainsPerM2FromPlants(PLANTS_PER_M2, 0)).toBeNull();
    expect(grainsPerM2FromKgHa(150, 0)).toBeNull();
  });
});

describe('distributeTotalSeedKg', () => {
  it('spends the whole total over the fields it is given', () => {
    const areas = [12.5, 7.5, 20];
    const rate = distributeTotalSeedKg(4500, areas)!;
    expect(rate).toBeCloseTo(112.5, 10);
    expect(areas.reduce((sum, area) => sum + rate * area, 0)).toBeCloseTo(4500, 10);
  });

  it('gives every field the same rate, whatever its size', () => {
    expect(distributeTotalSeedKg(1000, [10, 10])).toBe(distributeTotalSeedKg(1000, [15, 5]));
  });

  it('ignores an area that is not one', () => {
    expect(distributeTotalSeedKg(1000, [10, 0, -5])).toBeCloseTo(100, 10);
  });

  it('says nothing for an empty selection or no total', () => {
    expect(distributeTotalSeedKg(1000, [])).toBeNull();
    expect(distributeTotalSeedKg(null, [10])).toBeNull();
    expect(distributeTotalSeedKg(1000, [0])).toBeNull();
  });
});

describe('seedPackagesForStand', () => {
  // Maize: 9 plants/m² to stand, 94 % germination, 50 000 grains per package.
  const MAIZE_PACKAGE = 50_000;

  it('orders for what the drill puts down, not for the stand', () => {
    const forStand = seedPackagesForStand(9, DEFAULT_GERMINATION_RATE, 10, MAIZE_PACKAGE)!;
    const ifGerminationWereIgnored = (9 * 10_000 * 10) / MAIZE_PACKAGE;
    expect(forStand).toBeGreaterThan(ifGerminationWereIgnored);
    expect(forStand).toBeCloseTo(19.149, 3);
  });

  it('scales with the area', () => {
    expect(seedPackagesForStand(9, DEFAULT_GERMINATION_RATE, 20, MAIZE_PACKAGE)).toBeCloseTo(2 * seedPackagesForStand(9, DEFAULT_GERMINATION_RATE, 10, MAIZE_PACKAGE)!, 10);
  });

  it('counts a drill setting directly', () => {
    expect(seedPackagesForGrains(10, 10, MAIZE_PACKAGE)).toBeCloseTo(20, 10);
  });

  it('says nothing without a stand, a package size or an area', () => {
    expect(seedPackagesForStand(null, DEFAULT_GERMINATION_RATE, 10, MAIZE_PACKAGE)).toBeNull();
    expect(seedPackagesForStand(9, DEFAULT_GERMINATION_RATE, 10, 0)).toBeNull();
    expect(seedPackagesForStand(9, DEFAULT_GERMINATION_RATE, 0, MAIZE_PACKAGE)).toBeNull();
  });
});
