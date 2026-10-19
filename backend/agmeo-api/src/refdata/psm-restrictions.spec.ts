import { auflageKey, mapRestrictions, parseAbstand } from './psm.js';

const texts: Record<string, string> = { NW605: 'Abstand zu Oberflächengewässern …', NT101: 'Abstand zu Saumbiotopen …', SF245: 'Wiederbetreten erst nach Antrocknen' };
const codeText = (c: string) => texts[c] ?? null;

describe('Auflagen', () => {
  it('keys the float auflagenr by its integer part', () => {
    expect(auflageKey(58981503.0)).toBe('58981503');
    expect(auflageKey('58981503.0')).toBe('58981503');
  });

  it('reads BVL distances, "*" meaning not permitted', () => {
    expect(parseAbstand('5')).toBe(5);
    expect(parseAbstand('2,5')).toBe(2.5);
    expect(parseAbstand('*')).toBeNull();
    expect(parseAbstand(null)).toBeNull();
    expect(parseAbstand(10)).toBe(10);
  });

  const awg = '024701-00/01-001';
  const { restrictions, reductions } = mapRestrictions(
    [
      { auflagenr: 1.0, ebene: awg, auflage: 'NW605', abstand: null },
      { auflagenr: 2.0, ebene: '024701-00', auflage: 'SF245', abstand: null },
      { auflagenr: 3.0, ebene: awg, auflage: 'NW605', abstand: '10' },
      { auflagenr: 4.0, ebene: '999999-00/01-001', auflage: 'NT101', abstand: null },
      { auflagenr: 1.0, ebene: awg, auflage: 'NW605', abstand: null },
    ],
    [
      { auflagenr: 1.0, kategorie: '50', redu_abstand: '10' },
      { auflagenr: 1.0, kategorie: '75 %', redu_abstand: '5' },
      { auflagenr: 1.0, kategorie: '90', redu_abstand: '*' },
      { auflagenr: 1.0, kategorie: '90', redu_abstand: '1' },
      { auflagenr: 3.0, kategorie: '90', redu_abstand: '1' },
    ],
    codeText,
    new Set([awg]),
    new Set(['024701-00']),
  );

  it('scopes each condition to an approved use or a product and drops unknown ones', () => {
    expect(restrictions.map((r) => r.auflagenr)).toEqual(['1', '2', '3']);
    expect(restrictions[0]).toMatchObject({ awg_id: awg, kennr: null, code: 'NW605', code_group: 'NW', text: texts.NW605 });
    expect(restrictions[1]).toMatchObject({ awg_id: null, kennr: '024701-00', code: 'SF245', code_group: 'SF' });
  });

  it('takes the widest permitted tier as buffer when no unreduced distance is stated', () => {
    expect(restrictions[0]).toMatchObject({ water_buffer_m: 10, drift_reduction_pct: 50 });
    expect(reductions.filter((r) => r.auflagenr === '1')).toEqual([
      { auflagenr: '1', reduction_pct: 50, distance_m: 10 },
      { auflagenr: '1', reduction_pct: 75, distance_m: 5 },
      { auflagenr: '1', reduction_pct: 90, distance_m: null },
    ]);
  });

  it('prefers the stated distance and then names no reduction class', () => {
    expect(restrictions[2]).toMatchObject({ water_buffer_m: 10, drift_reduction_pct: null });
    expect(restrictions[1]).toMatchObject({ water_buffer_m: null, drift_reduction_pct: null });
  });
});
