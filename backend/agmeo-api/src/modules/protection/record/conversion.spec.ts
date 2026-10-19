import { checkConversion, CONVERSION_WARN_DAYS, CONVERSION_WINDOW_DAYS, type PlannedPass } from './conversion.js';

const pass = (operationId: string, date: string | null): PlannedPass => ({ operationId, passId: operationId, date, cropCycleId: 'c1', fieldId: 'f1', fieldName: 'Schlag 001' });

// Local midday, so the wall-clock date is the same in every zone the test runs in.
const today = new Date(2026, 9, 15, 12);

describe('checkConversion', () => {
  it('reports a plan as overdue once the 30-day window has passed', () => {
    expect(checkConversion([pass('op-31', '2026-09-14'), pass('op-30', '2026-09-15')], today)).toEqual([
      expect.objectContaining({ operationId: 'op-31', state: 'overdue', daysLeft: -1 }),
      expect.objectContaining({ operationId: 'op-30', state: 'due_soon', daysLeft: 0 }),
    ]);
  });

  it('warns in the last seven days of the window', () => {
    expect(checkConversion([pass('op-23', '2026-09-22'), pass('op-22', '2026-09-23')], today)).toEqual([
      expect.objectContaining({ operationId: 'op-23', state: 'due_soon', daysLeft: 7 }),
    ]);
    expect(CONVERSION_WINDOW_DAYS - CONVERSION_WARN_DAYS).toBe(23);
  });

  it('leaves future plans and plans without a date alone', () => {
    expect(checkConversion([pass('op-f', '2026-10-16'), pass('op-n', null), pass('op-t', '2026-10-15')], today)).toEqual([]);
  });

  it('puts the longest overdue plan first', () => {
    const findings = checkConversion([pass('soon', '2026-09-20'), pass('late', '2026-07-01'), pass('later', '2026-08-01')], today);
    expect(findings.map((f) => f.operationId)).toEqual(['late', 'later', 'soon']);
    expect(findings[0].daysLeft).toBe(CONVERSION_WINDOW_DAYS - 106);
  });
});
