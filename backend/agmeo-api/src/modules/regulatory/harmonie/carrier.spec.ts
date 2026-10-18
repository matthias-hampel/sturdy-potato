/**
 * resolveCarrier — the single conversion from a recorded application to the
 * carrier unit the exports file. convTtoCbm is m³ per t (inverse density).
 */
import { CarrierResolutionError, resolveCarrier } from './shared/carrier.js';

const slurry = {
  n: 4.2,
  nh4: 2.5,
  p2o5: 1.8,
  k2o: 5.2,
  mgo: 0.6,
  convTtoCbm: 0.95,
  kgNper100L: null,
};
const manure = {
  n: 5.5,
  nh4: 0.8,
  p2o5: 3,
  k2o: 6,
  mgo: 1.2,
  convTtoCbm: 1.4,
  kgNper100L: null,
};
const npk = {
  n: 12,
  nh4: null,
  p2o5: 12,
  k2o: 17,
  mgo: null,
  convTtoCbm: null,
  kgNper100L: null,
};
const ahl = {
  n: 28,
  nh4: null,
  p2o5: 0,
  k2o: null,
  mgo: null,
  convTtoCbm: 0.781,
  kgNper100L: 35.8,
};

describe('resolveCarrier — Wirtschaftsdünger', () => {
  test('slurry in m³/ha stays kg / cbm with raw kg/m³ contents', () => {
    const r = resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 'cbm_ha', 25);
    expect(r.carrierUnit).toBe('kg / cbm');
    expect(r.carrierAmountPerHa).toBe(25);
    expect(r.nPerCarrierUnit).toBe(4.2);
    expect(r.nKgPerHa).toBeCloseTo(105);
    expect(r.nh4KgPerHa).toBeCloseTo(62.5);
    expect(r.p2o5KgPerHa).toBeCloseTo(45);
    expect(r.k2oKgPerHa).toBeCloseTo(130);
  });

  test('slurry recorded in t/ha is converted to m³ by MULTIPLYING with convTtoCbm', () => {
    const r = resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 't_ha', 20);
    expect(r.carrierAmountPerHa).toBeCloseTo(19);
    expect(r.nKgPerHa).toBeCloseTo(19 * 4.2);
  });

  test('units as written by the import API (kg/ha, m³/ha) resolve like their canonical form', () => {
    expect(
      resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 'm³/ha', 35),
    ).toEqual(
      resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 'cbm_ha', 35),
    );
    expect(resolveCarrier(npk, 'MINERALDUENGER', false, 'kg/ha', 100)).toEqual(
      resolveCarrier(npk, 'MINERALDUENGER', false, 'kg_ha', 100),
    );
    expect(() =>
      resolveCarrier(npk, 'MINERALDUENGER', false, 'pieces/ha', 1),
    ).toThrow(CarrierResolutionError);
  });

  test('litres and hectolitres', () => {
    expect(
      resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 'l_ha', 25000)
        .carrierAmountPerHa,
    ).toBe(25);
    expect(
      resolveCarrier(slurry, 'WIRTSCHAFTSDUENGER', false, 'hl_ha', 250)
        .carrierAmountPerHa,
    ).toBe(25);
  });

  test('solid manure is documented per tonne: contents kg/m³ × convTtoCbm', () => {
    const r = resolveCarrier(manure, 'WIRTSCHAFTSDUENGER', true, 't_ha', 20);
    expect(r.carrierUnit).toBe('kg / t');
    expect(r.carrierAmountPerHa).toBe(20);
    expect(r.nPerCarrierUnit).toBeCloseTo(5.5 * 1.4);
    expect(r.nKgPerHa).toBeCloseTo(154);
  });

  test('manure recorded in m³ is converted to tonnes via ÷ convTtoCbm', () => {
    const r = resolveCarrier(manure, 'WIRTSCHAFTSDUENGER', true, 'cbm_ha', 14);
    expect(r.carrierAmountPerHa).toBeCloseTo(10);
    expect(r.nKgPerHa).toBeCloseTo(10 * 5.5 * 1.4);
  });

  test('unknown density falls back to 1 t/m³', () => {
    const r = resolveCarrier(
      { ...manure, convTtoCbm: null },
      'WIRTSCHAFTSDUENGER',
      true,
      't_ha',
      10,
    );
    expect(r.nPerCarrierUnit).toBe(5.5);
    expect(r.nKgPerHa).toBe(55);
  });
});

describe('resolveCarrier — Mineraldünger', () => {
  test('kg, dt and t per ha all end up in dt with % contents', () => {
    expect(
      resolveCarrier(npk, 'MINERALDUENGER', false, 'kg_ha', 200),
    ).toMatchObject({
      carrierUnit: 'kg / dt',
      carrierAmountPerHa: 2,
      nPerCarrierUnit: 12,
      nKgPerHa: 24,
      p2o5KgPerHa: 24,
      k2oKgPerHa: 34,
    });
    expect(
      resolveCarrier(npk, 'MINERALDUENGER', false, 'dt_ha', 2).nKgPerHa,
    ).toBe(24);
    expect(
      resolveCarrier(npk, 'MINERALDUENGER', false, 't_ha', 0.2).nKgPerHa,
    ).toBeCloseTo(24);
  });

  test('liquid with kg N/100 l is documented per hl', () => {
    const r = resolveCarrier(ahl, 'MINERALDUENGER', false, 'l_ha', 200);
    expect(r.carrierUnit).toBe('kg / hl');
    expect(r.carrierAmountPerHa).toBe(2);
    expect(r.nPerCarrierUnit).toBe(35.8);
    expect(r.nKgPerHa).toBeCloseTo(71.6);
    // 0 % P2O5 × (100 l × 1.28 kg/l) → 0 kg/hl
    expect(r.p2o5PerCarrierUnit).toBe(0);
  });

  test('liquid without kg N/100 l is converted to dt through its density', () => {
    const r = resolveCarrier(
      { ...ahl, kgNper100L: null },
      'MINERALDUENGER',
      false,
      'l_ha',
      200,
    );
    expect(r.carrierUnit).toBe('kg / dt');
    // 200 l × 1.28 kg/l = 256 kg = 2.56 dt
    expect(r.carrierAmountPerHa).toBeCloseTo(2.5608, 3);
    expect(r.nKgPerHa).toBeCloseTo(2.5608 * 28, 2);
  });

  test('volume unit without any density information fails loud', () => {
    expect(() =>
      resolveCarrier(npk, 'MINERALDUENGER', false, 'l_ha', 100),
    ).toThrow(CarrierResolutionError);
  });

  test('unknown unit fails loud', () => {
    expect(() =>
      resolveCarrier(npk, 'MINERALDUENGER', false, 'pieces_ha', 1),
    ).toThrow(/unsupported/);
  });
});
