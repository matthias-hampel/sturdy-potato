import { calendarDate, validateAttestations } from '@agmeo/contracts';
import { checkAttestations, SPRAYER_CYCLE_MONTHS } from './attestations.js';

const today = new Date('2026-09-12T00:00:00Z');
const complete = {
  certificateNumber: 'NI-12345',
  certificateHolder: 'M. Hoffmann',
  certificateValidUntil: '2029-06-30',
  sprayerInspectionNumber: 'PR-9988',
  sprayerInspectedOn: '2025-04-15',
};

describe('checkAttestations', () => {
  it('reports nothing when both certificates are valid', () => {
    const r = checkAttestations(complete, today);
    expect(r.sachkunde.state).toBe('ok');
    expect(r.sprayer.state).toBe('ok');
    expect(r.messages).toEqual([]);
  });

  it('reports a missing certificate number', () => {
    const r = checkAttestations({ ...complete, certificateNumber: '  ' }, today);
    expect(r.sachkunde.state).toBe('missing');
    expect(r.messages[0]).toContain('keine Sachkundenummer');
  });

  it('reports an expired certificate with its date', () => {
    const r = checkAttestations({ ...complete, certificateValidUntil: '2026-03-31' }, today);
    expect(r.sachkunde.state).toBe('expired');
    expect(r.sachkunde.daysLeft).toBeLessThan(0);
    expect(r.messages[0]).toContain('2026-03-31');
  });

  it('warns before the certificate lapses, while it is still valid', () => {
    const r = checkAttestations({ ...complete, certificateValidUntil: '2026-10-15' }, today);
    expect(r.sachkunde.state).toBe('ok');
    expect(r.sachkunde.daysLeft).toBe(33);
    expect(r.messages[0]).toContain('33 Tage');
  });

  it('calls an unreadable expiry unknown rather than valid', () => {
    expect(checkAttestations({ ...complete, certificateValidUntil: 'irgendwann' }, today).sachkunde.state).toBe('unknown');
  });

  it('reports an overdue sprayer inspection with the months', () => {
    const r = checkAttestations({ ...complete, sprayerInspectedOn: '2022-01-10' }, today);
    expect(r.sprayer.state).toBe('overdue');
    expect(r.sprayer.monthsSince).toBe(56);
    expect(r.messages[0]).toContain(`${SPRAYER_CYCLE_MONTHS} Monate`);
  });

  it('does not count a month that has only begun', () => {
    expect(checkAttestations({ ...complete, sprayerInspectedOn: '2023-09-13' }, today).sprayer.monthsSince).toBe(35);
    expect(checkAttestations({ ...complete, sprayerInspectedOn: '2023-09-12' }, today).sprayer.monthsSince).toBe(36);
  });

  it('reports both certificates when nothing is stored', () => {
    const r = checkAttestations(undefined, today);
    expect(r.sachkunde.state).toBe('missing');
    expect(r.sprayer.state).toBe('missing');
    expect(r.messages).toHaveLength(2);
  });

  it('says on every result that the certificate is kept per farm, not per person', () => {
    for (const input of [complete, undefined]) {
      const r = checkAttestations(input, today);
      expect(r.scope).toBe('farm');
      expect(r.scopeNote).toContain('nicht je Mitarbeiter');
    }
  });
});

describe('validateAttestations', () => {
  const now = new Date(2026, 9, 15, 10, 30);

  it('reports nothing for complete, valid data', () => {
    expect(validateAttestations({ ...complete, certificateValidUntil: '2028-12-31', sprayerInspectedOn: '2025-03-01' }, now)).toEqual({});
  });

  it('accepts today as inspection day and as expiry day', () => {
    expect(validateAttestations({ ...complete, sprayerInspectedOn: '2026-10-15', certificateValidUntil: '2026-10-15' }, now)).toEqual({});
  });

  it('reports an inspection dated tomorrow and a certificate that expired yesterday', () => {
    expect(validateAttestations({ ...complete, sprayerInspectedOn: '2026-10-16', certificateValidUntil: '2026-10-14' }, now)).toEqual({
      sprayerInspectedOn: 'notInFuture',
      certificateValidUntil: 'expired',
    });
  });

  it('reports missing, too short and too long values', () => {
    expect(
      validateAttestations({ certificateNumber: ' ', certificateHolder: 'x'.repeat(101), certificateValidUntil: '', sprayerInspectionNumber: 'AB', sprayerInspectedOn: '' }, now),
    ).toEqual({
      certificateNumber: 'required',
      certificateHolder: 'tooLong',
      certificateValidUntil: 'required',
      sprayerInspectionNumber: 'invalidFormat',
      sprayerInspectedOn: 'required',
    });
  });

  it('reports an unreadable date', () => {
    expect(validateAttestations({ ...complete, sprayerInspectedOn: 'irgendwann' }, now)).toEqual({ sprayerInspectedOn: 'invalidDate' });
  });
});

describe('calendarDate', () => {
  it('reads the wall-clock date of a Date, not its UTC rendering', () => {
    expect(calendarDate(new Date(2026, 7, 9, 0, 0, 0))).toBe('2026-08-09');
    expect(calendarDate(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01');
  });

  it('takes the date part of a timestamp string as written', () => {
    expect(calendarDate('2026-08-09 00:00:00')).toBe('2026-08-09');
    expect(calendarDate('2026-04-16')).toBe('2026-04-16');
  });

  it('yields null for nothing and for garbage', () => {
    expect(calendarDate(null)).toBeNull();
    expect(calendarDate('')).toBeNull();
    expect(calendarDate('gestern')).toBeNull();
    expect(calendarDate(new Date('x'))).toBeNull();
  });
});
