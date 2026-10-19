import type { WeatherDay } from '@agmeo/contracts';
import { addDays, assessDay, type CycleFacts, decide, nitrogenRule, type OperationFacts, type RuleInput, scoutingRule, timingRule, variableRateRule, type WeatherFacts } from './rules.js';

const TODAY = '2026-04-14';

function day(date: string, o: Partial<WeatherDay> = {}): WeatherDay {
  return {
    date,
    tempMinC: 5,
    tempMaxC: 16,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    windMaxKmh: 8,
    gustMaxKmh: 15,
    et0Mm: 2,
    weatherCode: 1,
    gdd: 5,
    ...o,
  };
}

function weather(overrides: Record<string, Partial<WeatherDay>> = {}, sprayDates = [TODAY, addDays(TODAY, 1), addDays(TODAY, 2)]): WeatherFacts {
  const mk = (offset: number) => {
    const d = addDays(TODAY, offset);
    return day(d, overrides[d]);
  };
  return {
    past: [-3, -2, -1].map(mk),
    daily: Array.from({ length: 10 }, (_, i) => mk(i)),
    sprayWindows: sprayDates.map((d) => ({ start: `${d}T07:00`, end: `${d}T12:00`, hours: 5 })),
  };
}

function op(o: Partial<OperationFacts> = {}): OperationFacts {
  return {
    id: 'op1',
    type: 'crop_protection',
    title: 'Fungizid',
    status: 'planned',
    plannedOn: TODAY,
    farmId: 'farm1',
    fields: [{ fieldId: 'field1', cropCycleId: 'cc1' }],
    hasVraMap: false,
    closedPeriod: null,
    psmDeviations: [],
    ...o,
  };
}

function cycle(o: Partial<CycleFacts> = {}): CycleFacts {
  return {
    id: 'cc1',
    fieldId: 'field1',
    farmId: 'farm1',
    cropName: 'Winterweizen',
    cropCategory: 'cereal',
    status: 'active',
    sowingDate: '2025-10-10',
    expectedHarvestDate: '2026-07-25',
    nitrateSensitiveZone: false,
    nNeedKgHa: 180,
    nRemainingKgHa: 0,
    ndvi: [],
    ...o,
  };
}

function input(o: Partial<RuleInput> = {}): RuleInput {
  return {
    today: TODAY,
    weatherByFarm: new Map([['farm1', weather()]]),
    operations: [],
    cycles: [],
    zoningByField: new Map(),
    completed: [],
    ...o,
  };
}

describe('assessDay', () => {
  it('uses the hourly spray windows within 72 hours', () => {
    const w = weather({}, [addDays(TODAY, 1)]);
    expect(assessDay('crop_protection', w, TODAY, TODAY).ok).toBe(false);
    const ok = assessDay('crop_protection', w, addDays(TODAY, 1), TODAY);
    expect(ok.ok).toBe(true);
    expect(ok.evidence[0].code).toBe('spray_window');
  });

  it('falls back to daily wind and rain beyond 72 hours', () => {
    const d = addDays(TODAY, 4);
    expect(assessDay('crop_protection', weather({ [d]: { windMaxKmh: 25 } }), d, TODAY).evidence[0].code).toBe('strong_wind');
    expect(assessDay('crop_protection', weather(), d, TODAY).ok).toBe(true);
  });

  it('blocks fertilization before heavy rain and on frozen ground', () => {
    const tomorrow = addDays(TODAY, 1);
    expect(assessDay('fertilization', weather({ [tomorrow]: { precipitationMm: 22 } }), TODAY, TODAY).evidence[0].code).toBe('heavy_rain_forecast');
    expect(assessDay('fertilization', weather({ [TODAY]: { tempMaxC: -1 } }), TODAY, TODAY).evidence[0].code).toBe('frozen_ground');
  });

  it('prefers fertilization before light rain', () => {
    const a = assessDay('fertilization', weather({ [addDays(TODAY, 2)]: { precipitationMm: 4 } }), TODAY, TODAY);
    expect(a.ok).toBe(true);
    expect(a.evidence.map((e) => e.code)).toContain('light_rain_after');
  });

  it('blocks tillage on wet soil after rain', () => {
    const a = assessDay('tillage', weather({ [addDays(TODAY, -1)]: { precipitationMm: 12 } }), TODAY, TODAY);
    expect(a.ok).toBe(false);
    expect(a.evidence[0].code).toBe('rain_before');
  });
});

describe('timingRule', () => {
  it('confirms planned spraying with a spray window', () => {
    const [d] = timingRule(input({ operations: [op()] }));
    expect(d.action).toBe('do_now');
    expect(d.windowFrom).toBe(TODAY);
    expect(d.confidence).toBe(0.9);
  });

  it('moves spraying to the next day with a spray window', () => {
    const [d] = timingRule(input({ operations: [op()], weatherByFarm: new Map([['farm1', weather({}, [addDays(TODAY, 2)])]]) }));
    expect(d.action).toBe('postpone');
    expect(d.windowFrom).toBe(addDays(TODAY, 2));
    expect(d.evidence.map((e) => e.code)).toEqual(['planned_on', 'no_spray_window', 'spray_window', 'forecast_lead_days']);
  });

  it('says nothing about suitable work more than two days ahead', () => {
    expect(timingRule(input({ operations: [op({ plannedOn: addDays(TODAY, 5) })] }))).toEqual([]);
  });

  it('catches up overdue work on the next suitable day', () => {
    const [d] = timingRule(input({ operations: [op({ type: 'fertilization', plannedOn: addDays(TODAY, -4) })] }));
    expect(d.action).toBe('catch_up');
    expect(d.windowFrom).toBe(TODAY);
    expect(d.priority).toBe('high');
    expect(d.evidence[1]).toEqual({ code: 'overdue_days', params: { days: 4 } });
  });

  it('ignores long stale plans', () => {
    expect(timingRule(input({ operations: [op({ plannedOn: addDays(TODAY, -60) })] }))).toEqual([]);
  });

  it('catches up without weather at lower confidence', () => {
    const [d] = timingRule(input({ operations: [op({ plannedOn: addDays(TODAY, -2) })], weatherByFarm: new Map([['farm1', null]]) }));
    expect(d.windowFrom).toBeNull();
    expect(d.confidence).toBe(0.5);
    expect(d.evidence.at(-1)!.code).toBe('weather_unavailable');
  });
});

describe('nitrogenRule', () => {
  it('recommends planning fertilization for a remaining N need', () => {
    const [d] = nitrogenRule(input({ cycles: [cycle({ nRemainingKgHa: 70 })] }));
    expect(d.action).toBe('plan_operation');
    expect(d.priority).toBe('high');
    expect(d.windowFrom).toBe(TODAY);
  });

  it('stays quiet when fertilization is already planned', () => {
    const planned = op({ type: 'fertilization', plannedOn: addDays(TODAY, 10) });
    expect(nitrogenRule(input({ cycles: [cycle({ nRemainingKgHa: 70 })], operations: [planned] }))).toEqual([]);
  });

  it('stays quiet in the closed period', () => {
    expect(nitrogenRule(input({ today: '2026-11-10', cycles: [cycle({ nRemainingKgHa: 70 })] }))).toEqual([]);
  });

  it('flags planned fertilization above the need', () => {
    const planned = op({ type: 'fertilization', plannedOn: addDays(TODAY, 10) });
    const [d] = nitrogenRule(input({ cycles: [cycle({ nRemainingKgHa: -30 })], operations: [planned] }));
    expect(d.kind).toBe('compliance');
    expect(d.operationId).toBe('op1');
  });
});

describe('scoutingRule', () => {
  const ndvi = (before: number, after: number) => [
    { date: addDays(TODAY, -12), mean: before, p10: before - 0.05, p90: before + 0.05 },
    { date: addDays(TODAY, -2), mean: after, p10: after - 0.2, p90: after + 0.1 },
  ];

  it('recommends a field walk after an NDVI drop, starting in the weak zones', () => {
    const zoning = { zones: [{ zoneNo: 1, relativeProductivity: 82 }, { zoneNo: 2, relativeProductivity: 100 }, { zoneNo: 3, relativeProductivity: 115 }] };
    const [d] = scoutingRule(input({ cycles: [cycle({ ndvi: ndvi(0.72, 0.55) })], zoningByField: new Map([['field1', zoning]]) }));
    expect(d.action).toBe('inspect');
    expect(d.priority).toBe('high');
    expect(d.zoneNos).toEqual([1]);
    expect(d.key).toBe(`scout:cc1:${addDays(TODAY, -2)}`);
  });

  it('ignores the drop after a recorded inspection', () => {
    const completed = [{ fieldId: 'field1', type: 'inspection' as const, date: addDays(TODAY, -1) }];
    expect(scoutingRule(input({ cycles: [cycle({ ndvi: ndvi(0.72, 0.55) })], completed }))).toEqual([]);
  });

  it('ignores the drop close to harvest', () => {
    expect(scoutingRule(input({ cycles: [cycle({ ndvi: ndvi(0.72, 0.55), expectedHarvestDate: addDays(TODAY, 10) })] }))).toEqual([]);
  });

  it('flags a field far below the same crop elsewhere', () => {
    const at = (id: string, mean: number) => cycle({ id, fieldId: `f-${id}`, ndvi: [{ date: addDays(TODAY, -3), mean, p10: null, p90: null }] });
    const out = scoutingRule(input({ cycles: [at('a', 0.4), at('b', 0.7), at('c', 0.72), at('d', 0.68)] }));
    expect(out.map((d) => d.cropCycleId)).toEqual(['a']);
    expect(out[0].evidence[0].code).toBe('ndvi_below_peers');
  });
});

describe('variableRateRule', () => {
  it('suggests zone rates for planned fertilization on a zoned field', () => {
    const zoning = { zones: [{ zoneNo: 1, relativeProductivity: 80 }, { zoneNo: 2, relativeProductivity: 100 }, { zoneNo: 3, relativeProductivity: 118 }] };
    const [d] = variableRateRule(input({ operations: [op({ type: 'fertilization', plannedOn: addDays(TODAY, 5) })], zoningByField: new Map([['field1', zoning]]) }));
    expect(d.action).toBe('create_vra_map');
    expect(d.evidence[1].params).toEqual({ zoneCount: 3, minPct: 80, maxPct: 118 });
  });

  it('skips operations that already have zone rates', () => {
    const zoning = { zones: [{ zoneNo: 1, relativeProductivity: 80 }, { zoneNo: 2, relativeProductivity: 100 }, { zoneNo: 3, relativeProductivity: 118 }] };
    expect(variableRateRule(input({ operations: [op({ type: 'fertilization', hasVraMap: true })], zoningByField: new Map([['field1', zoning]]) }))).toEqual([]);
  });
});

describe('decide', () => {
  it('puts compliance conflicts first', () => {
    const closed = op({ id: 'op2', type: 'fertilization', closedPeriod: { date: TODAY, from: '10-01', to: '01-31', rule: 'DüV §6 Abs. 8' } });
    const out = decide(input({ operations: [op(), closed] }));
    expect(out[0].key).toBe('closed:op2');
  });
});
