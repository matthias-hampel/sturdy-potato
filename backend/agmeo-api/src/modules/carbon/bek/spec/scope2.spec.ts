// Ported from agmeo src/lib/co2calculator/tests/scope2.test.ts.
import {
  computeScope2Row,
  SCOPE2_KINDS,
  SCOPE2_PARAMETER_ID_BY_KIND,
  scope2ParameterDetails,
} from '../scope2.js';

describe('computeScope2Row', () => {
  test('0 kWh → 0 kg CO2e for every kind', () => {
    for (const kind of SCOPE2_KINDS) {
      expect(computeScope2Row(kind, 0).kgCo2e).toBe(0);
    }
  });

  test('kgCo2e = kwh * parameter.value', () => {
    for (const kind of SCOPE2_KINDS) {
      const p = scope2ParameterDetails(kind);
      expect(computeScope2Row(kind, 1000).kgCo2e).toBeCloseTo(
        1000 * p.value,
        6,
      );
    }
  });

  test('returns matching parameter snapshot', () => {
    const row = computeScope2Row('electricityGrid', 1000);
    expect(row.parameter.id).toBe(SCOPE2_PARAMETER_ID_BY_KIND.electricityGrid);
    expect(row.parameter.value).toBeGreaterThan(0);
    expect(row.parameter.source).toBeTruthy();
  });
});

describe('scope2ParameterDetails', () => {
  test('every kind resolves to a parameter with non-empty fields', () => {
    for (const kind of SCOPE2_KINDS) {
      const p = scope2ParameterDetails(kind);
      expect(p.id).toBe(SCOPE2_PARAMETER_ID_BY_KIND[kind]);
      expect(p.name).toBeTruthy();
      expect(p.unit).toBeTruthy();
      expect(p.source).toBeTruthy();
      expect(typeof p.value).toBe('number');
    }
  });
});
