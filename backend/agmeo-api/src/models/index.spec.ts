import {
  bbchCalibration,
  computeDiseaseRisk,
  computeFieldConditionBars,
  computeFieldWaterBalance,
  computePhenology,
} from './index.js';
import { evaluateFieldsForMachine } from './trafficability/index.js';
import { projectFieldTrafficability } from './trafficability/rows.js';
import type { WeatherDay, WeatherTimeseries } from './types.js';
import { addDaysUtc } from './dates.js';

const TODAY = '2026-06-10';

function day(i: number): WeatherDay {
  const tempMean = 14 + 6 * Math.sin(i / 9);
  return {
    tempMin: tempMean - 5,
    tempMax: tempMean + 5,
    tempMean,
    precipitation: i % 6 === 0 ? 6 : 0,
    humidityMin: 45,
    humidityMax: 90,
    humidityMean: 70,
    dewPointMin: 5,
    dewPointMax: 10,
    dewPointMean: 8,
    windSpeedMax: 12,
    windSpeedMean: 3,
    windGustsMax: 22,
    windGustsMean: 15,
    et0: 3,
    soilTemp0to7cm: 12,
    soilTemp7to28cm: 11,
    soilMoisture0to7cm: 0.3,
    soilMoisture7to28cm: 0.32,
  };
}

/** Daily weather from `from` through TODAY + 14 days. */
function season(from: string): WeatherTimeseries {
  const out: WeatherTimeseries = {};
  for (
    let i = 0, d = from;
    d <= addDaysUtc(TODAY, 14);
    i++, d = addDaysUtc(d, 1)
  ) {
    out[d] = day(i);
  }
  return out;
}

const weather = season('2025-09-01');
const texture = { clay: 20, silt: 60, sand: 20, soc: 1.5, bd: 1.4 };

describe('model entry points (rewrite crop codes)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  it('computes the four condition bars for a field', () => {
    const balance = computeFieldWaterBalance({
      cropCode: 'winter_wheat',
      latitude: 52,
      year: 2026,
      sowingDate: '2025-10-10',
      weather,
      fieldTexture: texture,
      today: TODAY,
    });
    const bars = computeFieldConditionBars({
      cropCode: 'winter_wheat',
      weather,
      soilTexture: 'uL',
      sowingDate: '2025-10-10',
      waterBalance: balance.rootZone.days,
      awcMm: balance.rootZone.awcMm,
    });
    for (const bar of [
      bars.spraying,
      bars.sowing,
      bars.weatherRisk,
      bars.trafficability!,
    ]) {
      expect(bar).toHaveLength(14);
      expect(bar[0].date).toBe(TODAY);
      expect(
        bar.every((d) => d.value !== null && d.value >= 0 && d.value <= 3),
      ).toBe(true);
    }
  });

  it('runs GDD and the ESM BBCH model since sowing for winter wheat', () => {
    const result = computePhenology({
      cropCode: 'winter_wheat',
      weather,
      sowingDate: '2025-10-10',
      harvestYear: 2026,
      latitude: 52,
      today: TODAY,
    });
    expect(result.crop).toBe('winterWheat');
    expect(result.bbchSource).toBe('model');
    expect(result.gdd).toBeGreaterThan(1000);
    expect(result.currentBbch).toBeGreaterThan(30);
    expect(result.dailyBbch!.has(addDaysUtc(TODAY, 1))).toBe(false);
  });

  it('falls back to the crop calendar curve and default sowing date', () => {
    const result = computePhenology({
      cropCode: 'potatoes',
      weather,
      sowingDate: null,
      harvestYear: 2026,
      latitude: 52,
      today: TODAY,
    });
    expect(result.sowingDate).toBe('2026-04-25');
    expect(result.bbchSource).toBe('calendar');
    expect(result.currentBbch).toBeGreaterThan(0);
  });

  it('shifts the model BBCH through a farmer observation', () => {
    const base = { cropCode: 'winter_wheat', weather, sowingDate: '2025-10-10', harvestYear: 2026, latitude: 52 };
    const raw = computePhenology({ ...base, today: TODAY });
    const observed = raw.currentBbch! - 8;
    const cal = bbchCalibration({ ...base, date: TODAY, observedBbch: observed });
    expect(cal).toMatchObject({ ok: true, modelBbch: raw.currentBbch });
    if (!cal.ok) return;
    expect(cal.bdOffset).toBeLessThan(0);
    const shifted = computePhenology({ ...base, today: TODAY, calibrations: [{ observedBbch: observed, bdOffset: cal.bdOffset }] });
    expect(shifted.calibrated).toBe(true);
    expect(Math.abs(shifted.currentBbch! - observed)).toBeLessThanOrEqual(1);
    // The offset ramps in from sowing: early stages stay close to the raw model.
    const early = addDaysUtc('2025-10-10', 10);
    expect(Math.abs(shifted.dailyBbch!.get(early)! - raw.dailyBbch!.get(early)!)).toBeLessThanOrEqual(1);
  });

  it('refuses calibrations the model cannot place', () => {
    const base = { weather, sowingDate: '2025-10-10', harvestYear: 2026, latitude: 52, observedBbch: 30 };
    expect(bbchCalibration({ ...base, cropCode: 'potatoes', date: TODAY })).toEqual({ ok: false, reason: 'unsupported_crop' });
    expect(bbchCalibration({ ...base, cropCode: 'winter_wheat', date: '2025-09-01' })).toEqual({ ok: false, reason: 'date_out_of_range' });
  });

  it('returns empty phenology for an unmapped crop', () => {
    const result = computePhenology({
      cropCode: null,
      weather,
      sowingDate: null,
      harvestYear: 2026,
      latitude: 52,
      today: TODAY,
    });
    expect(result).toMatchObject({ crop: null, gdd: null, dailyBbch: null });
  });

  it('feeds the topsoil balance into trafficability for a machine', () => {
    const { rootZone, topsoil } = computeFieldWaterBalance({
      cropCode: 'silage_maize',
      latitude: 52,
      year: 2026,
      sowingDate: null,
      weather,
      fieldTexture: texture,
      withTopsoilBalance: true,
      today: TODAY,
    });
    expect(rootZone.rootDepthM).toBe(1.7);
    expect(rootZone.recommendation.status).not.toBe('missing_data');
    expect(topsoil!.rootDepthM).toBe(0.3);

    const delta = projectFieldTrafficability(
      topsoil!.days,
      topsoil!.soilTypeKa5,
      TODAY,
    )!;
    expect(delta.forecast).toHaveLength(7);
    const [{ result }] = evaluateFieldsForMachine({
      fields: [delta],
      machine: {
        operatingMassKg: 9000,
        frontAxleFraction: 0.4,
        frontTyre: { widthM: 0.54, recommendedPressureKpa: 120 },
        rearTyre: { widthM: 0.65, recommendedPressureKpa: 120 },
      },
      frontInflationKpa: 120,
      rearInflationKpa: 120,
      dayOffset: 0,
    });
    expect(['good', 'caution', 'risk', 'unsafe']).toContain(result.band);
    expect(result.sci).toBeGreaterThan(0);
  });

  it('collapses ISIP disease risk only for crops ISIP models', () => {
    const disease = {
      '2026-05-02': { brownRust: 1 as const, septoriaTritici: 3 as const },
      '2026-05-01': { netBlotch: 2 as const },
    };
    expect(computeDiseaseRisk(disease, 'winter_wheat')).toEqual([
      { date: '2026-05-01', value: 0 },
      { date: '2026-05-02', value: 3 },
    ]);
    expect(computeDiseaseRisk(disease, 'winter_barley')).toEqual([
      { date: '2026-05-01', value: 2 },
      { date: '2026-05-02', value: 0 },
    ]);
    expect(computeDiseaseRisk(disease, 'potatoes')).toBeNull();
  });
});
