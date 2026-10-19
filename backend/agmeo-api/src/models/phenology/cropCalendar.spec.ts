/**
 * Ported from AGVOLUTION/agmeo src/lib/phenology/cropCalendar.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { allSupportedCrops, cropsWithoutSowingHarvesting } from '../crops.js';
import { getHarvestYearDateSpan } from '../harvestYear.js';
import { kcFromBbch } from '../irrigation/waterBalance.js';
import {
  buildCalendarBbchMap,
  getDefaultHarvestDate,
  getDefaultSowingDate,
  getPreSeasonKc,
} from './cropCalendar.js';

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    dates.push(new Date(t).toISOString().split('T')[0]);
  }
  return dates;
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().split('T')[0];

/**
 * Completeness. The table's type already rejects a missing crop at build time;
 * these assert the parts a type cannot: that the exclusion list matches the one
 * the rest of the app uses, and that every entry is a usable date.
 */
describe('crop calendar completeness', () => {
  const HARVEST_YEAR = 2026;
  const cropsWithCalendar = allSupportedCrops.filter(
    (crop) => !cropsWithoutSowingHarvesting.includes(crop),
  );

  it('covers every crop that is sown and harvested', () => {
    const uncovered = cropsWithCalendar.filter(
      (crop) => getDefaultSowingDate(crop, HARVEST_YEAR) === null,
    );
    expect(uncovered).toEqual([]);
    // Guard against the list shrinking to nothing by accident
    expect(cropsWithCalendar.length).toBe(
      allSupportedCrops.length - cropsWithoutSowingHarvesting.length,
    );
  });

  it('has no entry for the crops without sowing or harvest', () => {
    for (const crop of cropsWithoutSowingHarvesting) {
      expect(getDefaultSowingDate(crop, HARVEST_YEAR)).toBeNull();
      expect(getDefaultHarvestDate(crop, HARVEST_YEAR)).toBeNull();
      expect(getPreSeasonKc(crop)).toBeNull();
    }
  });

  it.each(
    allSupportedCrops.filter(
      (crop) => !cropsWithoutSowingHarvesting.includes(crop),
    ),
  )('%s has a usable season', (crop) => {
    const sowing = getDefaultSowingDate(crop, HARVEST_YEAR)!;
    const harvest = getDefaultHarvestDate(crop, HARVEST_YEAR)!;
    // Real calendar days, not e.g. February 30th
    expect(sowing).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${sowing}T00:00:00Z`).toISOString().split('T')[0]).toBe(
      sowing,
    );
    expect(harvest > sowing).toBe(true);
    // FAO-56 stage lengths: long enough to be a season, short enough to be one
    const days = (Date.parse(harvest) - Date.parse(sowing)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(60);
    expect(days).toBeLessThanOrEqual(400);
  });

  /**
   * The invariant that the deleted `crop.includes("winter")` heuristic broke:
   * an autumn-sown crop belongs to the *following* harvest year. `spelt`,
   * `ryeWholePlantSilage` and every cover crop failed this, by up to 229 days.
   */
  it.each(
    allSupportedCrops.filter(
      (crop) => !cropsWithoutSowingHarvesting.includes(crop),
    ),
  )('%s is sown and harvested inside its harvest year span', (crop) => {
    const span = getHarvestYearDateSpan(HARVEST_YEAR);
    const sowing = new Date(
      `${getDefaultSowingDate(crop, HARVEST_YEAR)!}T00:00:00Z`,
    );
    const harvest = new Date(
      `${getDefaultHarvestDate(crop, HARVEST_YEAR)!}T00:00:00Z`,
    );
    // Span bounds are local midnights; compare on the date only
    const startsAfter = sowing.getTime() >= span.start.getTime() - 86_400_000;
    const endsBefore = harvest.getTime() <= span.end.getTime() + 86_400_000;
    expect({ crop, startsAfter, endsBefore }).toEqual({
      crop,
      startsAfter: true,
      endsBefore: true,
    });
  });
});

describe('getDefaultSowingDate', () => {
  it('returns the harvest-year date for spring crops', () => {
    expect(getDefaultSowingDate('potatoTableLate', 2026)).toBe('2026-04-25');
    expect(getDefaultSowingDate('silageMaize', 2026)).toBe('2026-04-25');
  });

  it("returns the previous-year date for winter crops (incl. non-'winter*' names)", () => {
    expect(getDefaultSowingDate('winterWheat', 2026)).toBe('2025-10-10');
    expect(getDefaultSowingDate('canola', 2026)).toBe('2025-08-25');
    expect(getDefaultSowingDate('spelt', 2026)).toBe('2025-10-15');
    expect(getDefaultSowingDate('ryeWholePlantSilage', 2026)).toBe(
      '2025-10-01',
    );
  });

  it('returns null for crops without a calendar entry', () => {
    expect(getDefaultSowingDate('landscapeFeature', 2026)).toBeNull();
    expect(getDefaultSowingDate('nonProductiveArea', 2026)).toBeNull();
  });
});

describe('getDefaultHarvestDate', () => {
  it('adds the FAO-56 stage lengths to the sowing anchor', () => {
    // winter wheat 2026: sown 2025-10-10, stages 30+140+40+30 = 240 days
    expect(getDefaultHarvestDate('winterWheat', 2026)).toBe('2026-06-07');
    // silage maize 2026: sown 2026-04-25, stages 20+35+40+10 = 105 days
    expect(getDefaultHarvestDate('silageMaize', 2026)).toBe('2026-08-08');
  });

  it('allocates a cover crop to the harvest year of the main crop it precedes', () => {
    // Sown August 2026 → harvest year 2027, per getHarvestYearDateSpan and isSecondaryOf
    expect(getDefaultSowingDate('mustardIntercrop', 2027)).toBe('2026-08-15');
    expect(getDefaultHarvestDate('mustardIntercrop', 2027)).toBe('2026-12-13');
  });

  it('stays after the sowing date for autumn-sown catch crops', () => {
    const sowing = getDefaultSowingDate('mustardIntercrop', 2026)!;
    const harvest = getDefaultHarvestDate('mustardIntercrop', 2026)!;
    expect(sowing).toBe('2025-08-15');
    expect(harvest > sowing).toBe(true);
  });

  it('returns null for crops without a calendar entry', () => {
    expect(getDefaultHarvestDate('landscapeFeature', 2026)).toBeNull();
  });
});

describe('getPreSeasonKc', () => {
  it('gives perennials dormant cover and annuals bare soil', () => {
    expect(getPreSeasonKc('alfalfa')).toBe(0.4);
    expect(getPreSeasonKc('permanentGrasslandWiltedSilage')).toBe(0.4);
    expect(getPreSeasonKc('potatoTableLate')).toBeNull();
    expect(getPreSeasonKc('winterWheat')).toBeNull();
  });
});

describe('buildCalendarBbchMap', () => {
  const SOWING = '2026-04-25';
  const TODAY = '2026-10-01';
  const dates = dateRange('2025-12-01', '2026-10-15');

  it('reproduces the FAO-56 Kc trapezoid for potato (25/30/45/30, Kc 0.4/1.15/0.75)', () => {
    const map = buildCalendarBbchMap(dates, 'potatoTableLate', SOWING, TODAY)!;
    const kcAt = (offset: number) =>
      kcFromBbch(map.get(addDays(SOWING, offset))!, 'potatoTableLate');

    // L_ini: flat Kc_ini
    expect(kcAt(0)).toBe(0.4);
    expect(kcAt(24)).toBe(0.4);
    // L_dev: monotone ramp Kc_ini → Kc_mid
    const ramp = [kcAt(25), kcAt(40), kcAt(54)];
    expect(ramp[0]).toBeGreaterThanOrEqual(0.4);
    expect(ramp[1]).toBeGreaterThan(ramp[0]);
    expect(ramp[2]).toBeGreaterThan(ramp[1]);
    // L_mid: flat Kc_mid (day 55..99)
    expect(kcAt(55)).toBe(1.15);
    expect(kcAt(99)).toBe(1.15);
    // L_late: ramp down to Kc_end at day 130+
    expect(kcAt(115)).toBeLessThan(1.15);
    expect(kcAt(115)).toBeGreaterThan(0.75);
    expect(kcAt(130)).toBe(0.75);
    expect(kcAt(150)).toBe(0.75);
  });

  it('emits no entries before sowing and none after today', () => {
    const map = buildCalendarBbchMap(dates, 'potatoTableLate', SOWING, TODAY)!;
    expect(map.get('2026-04-24')).toBeUndefined();
    expect(map.get('2026-03-01')).toBeUndefined();
    expect(map.get(TODAY)).toBeDefined();
    expect(map.get('2026-10-02')).toBeUndefined();
  });

  it('returns null for crops without a calendar entry', () => {
    expect(
      buildCalendarBbchMap(dates, 'landscapeFeature', SOWING, TODAY),
    ).toBeNull();
  });
});
