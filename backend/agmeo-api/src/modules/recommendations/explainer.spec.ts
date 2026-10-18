import { germanDate, localizeDates } from './explainer.service.js';

describe('localizeDates', () => {
  it('names the right weekday', () => {
    expect(germanDate('2026-10-23')).toBe('Fr., 23.10.');
    expect(germanDate('2026-10-20')).toBe('Di., 20.10.');
  });

  it('formats dates and spray window times throughout the payload', () => {
    const out = localizeDates({
      windowFrom: '2026-10-20',
      evidence: [{ code: 'spray_window', params: { start: '2026-10-20T19:00', end: '2026-10-20T23:00', hours: 4 } }],
      key: 'timing:abc:postpone',
    });
    expect(out).toEqual({
      windowFrom: 'Di., 20.10.',
      evidence: [{ code: 'spray_window', params: { start: 'Di., 20.10. 19:00 Uhr', end: 'Di., 20.10. 23:00 Uhr', hours: 4 } }],
      key: 'timing:abc:postpone',
    });
  });
});
