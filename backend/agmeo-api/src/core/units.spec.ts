import { DIMENSIONS, displayUnit, resolveMeasurementSystem, toCanonical, toDisplay } from '@agmeo/contracts';

// Unit conversions live in contracts (shared with the web app); they are tested here
// because the API package has the test runner.
describe('measurement systems', () => {
  it('is metric by default and imperial for US farms on auto', () => {
    expect(resolveMeasurementSystem('auto', 'DE')).toBe('metric');
    expect(resolveMeasurementSystem('auto', 'us')).toBe('imperial');
    expect(resolveMeasurementSystem('metric', 'US')).toBe('metric');
    expect(resolveMeasurementSystem('imperial', 'DE')).toBe('imperial');
  });

  it('converts the common agronomic units', () => {
    expect(toDisplay(1, 'area', 'imperial')).toBeCloseTo(2.4710538, 6);
    expect(toDisplay(100, 'massRate', 'imperial')).toBeCloseTo(89.2179, 3);
    expect(toDisplay(25.4, 'precipDepth', 'imperial')).toBeCloseTo(1, 10);
    expect(toDisplay(0, 'temperature', 'imperial')).toBeCloseTo(32, 10);
    expect(toDisplay(100, 'temperature', 'imperial')).toBeCloseTo(212, 10);
    expect(toDisplay(10, 'gdd', 'imperial')).toBeCloseTo(18, 10);
  });

  it('quotes yields per crop', () => {
    expect(displayUnit('yieldMass', 'imperial', { crop: 'winter_wheat' }).id).toBe('buPerAc');
    // 1 t/ha of wheat (60 lb/bu) ≈ 14.87 bu/ac
    expect(toDisplay(1, 'yieldMass', 'imperial', { crop: 'winter_wheat' })).toBeCloseTo(14.87, 2);
    expect(displayUnit('yieldMass', 'imperial', { crop: 'potatoes' }).id).toBe('cwtPerAc');
    expect(displayUnit('yieldMass', 'imperial').id).toBe('shortTonPerAc');
  });

  it('round-trips every dimension', () => {
    for (const d of DIMENSIONS) {
      expect(toCanonical(toDisplay(12.345, d, 'imperial'), d, 'imperial')).toBeCloseTo(12.345, 9);
      expect(toDisplay(12.345, d, 'metric')).toBe(12.345);
    }
  });
});
