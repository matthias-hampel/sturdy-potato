import {
  bsaKey,
  bslVarietyName,
  coerceNumeric,
  DISEASE_PROPERTY_NAMES,
  loadBslData,
  mergeDuplicates,
  normalizeVarietyKey,
  type RawVarietyPropertyRow,
  toDiseaseRatings,
  toVarietyTraits,
  TRAIT_PROPERTY_NAMES,
} from './bsl.js';

const rows = (entries: [string, number | null][]): RawVarietyPropertyRow[] => entries.map(([propertyName, value]) => ({ propertyName, value }));

describe('BSL data', () => {
  it('ships the reference list with properties, quality data and BSA keys', () => {
    const data = loadBslData();
    expect(data.varieties.length).toBe(2231);
    const withProps = data.varieties.filter((v) => v.properties && Object.keys(v.properties).length);
    expect(withProps.length).toBeGreaterThan(2000);
    // Most entries resolve to a BSA species (crops map to those codes).
    const keyed = data.varieties.filter((v) => bsaKey(v).speciesCode)
    expect(keyed.length / data.varieties.length).toBeGreaterThan(0.95);
  });

  it('merges entries the list repeats within a use group', () => {
    const a = { id: 1, name: 'Absint', kenn: '6146', species: 'weizen_winter', subspecies: 'W', properties: { reife: 5 } }
    const b = { id: 2, name: 'Absint 1)', kenn: '6146', species: 'weizen_winter', subspecies: 'W', breeder: 'X', properties: { reife: 6, lager: 3 }, quality: { fallzahl: 7 } }
    const c = { id: 3, name: 'Absint', kenn: '6146', species: 'weizen_winter', subspecies: 'Öko', properties: {} }
    const merged = mergeDuplicates([a, b, c])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: 1, name: 'Absint', breeder: 'X', properties: { reife: 5, lager: 3 }, quality: { fallzahl: 7 } })
    const all = mergeDuplicates(loadBslData().varieties)
    expect(all.length).toBeLessThan(2231)
    expect(all.length).toBeGreaterThan(2050)
  });

  it('reads the BSA species and Kennnummer of an entry', () => {
    expect(bsaKey({ kenn: 'BA 400', species: 'ackerbohne', subspecies: 'x' })).toEqual({ speciesCode: 'BA', registrationNumber: 400 });
    expect(bsaKey({ kenn: '1641', species: 'weizen_winter', subspecies: 'Winterweichweizen' })).toEqual({ speciesCode: 'WW', registrationNumber: 1641 });
    expect(bsaKey({ kenn: undefined, species: 'gerste', subspecies: 'Sommergerste - zweizeilig' })).toEqual({ speciesCode: 'GS', registrationNumber: null });
    expect(bsaKey({ kenn: '2304', species: 'gerste', subspecies: 'Wintergerste - zweizeilig' })).toEqual({ speciesCode: 'GW', registrationNumber: 2304 });
    expect(bsaKey({ species: 'hanf', subspecies: 'Faserhanf (Nutzhanf)' })).toEqual({ speciesCode: null, registrationNumber: null });
  });

  it('cleans names and maize maturity values like the reference import', () => {
    expect(bslVarietyName('RGT Planet 1)')).toBe('RGT Planet');
    expect(bslVarietyName('Capri  2)')).toBe('Capri');
    expect(coerceNumeric('S 250')).toBe(250);
    expect(coerceNumeric('K 220')).toBe(220);
    expect(coerceNumeric('hoch')).toBe('hoch');
    expect(coerceNumeric(7)).toBe(7);
  });
});

describe('normalizeVarietyKey (reference normalize.test.ts)', () => {
  it('matches differing whitespace, case and punctuation', () => {
    const canonical = normalizeVarietyKey('DKC 2956');
    for (const v of ['dkc 2956', 'DKC2956', 'dkc-2956', 'DKC  2956', 'DKC 2956 ', ' DKC 2956', 'DKC_2956']) expect(normalizeVarietyKey(v)).toBe(canonical);
  });
  it('keeps distinct names apart', () => {
    expect(normalizeVarietyKey('DKC 2956')).not.toBe(normalizeVarietyKey('DKC 3059'));
    expect(normalizeVarietyKey('LG 32216')).toBe('lg32216');
    expect(normalizeVarietyKey('LG 32.16')).toBe('lg3216');
    expect(normalizeVarietyKey('LID  2662  C')).toBe(normalizeVarietyKey('LID 2662 C'));
  });
});

describe('toVarietyTraits (reference traits.test.ts)', () => {
  it('maps each trait from its highest-priority property', () => {
    const t = toVarietyTraits(rows([['reifezeit', 4], ['auswinterung', 3], ['lager', 5], ['kornertrag', 8], ['tausendkornmasse', 46]]));
    expect(t).toEqual({
      maturity: { value: 4, source: 'reifezeit' },
      winterKill: { value: 3, source: 'auswinterung' },
      lodging: { value: 5, source: 'lager' },
      yield: { value: 8, source: 'kornertrag' },
      tkg: { value: 46, source: 'tausendkornmasse' },
    });
  });
  it('falls back to the next candidate', () => {
    const t = toVarietyTraits(rows([['siloreifezahl', 220], ['neigung_zu_lager', 6]]));
    expect(t.maturity).toEqual({ value: 220, source: 'siloreifezahl' });
    expect(t.lodging).toEqual({ value: 6, source: 'neigung_zu_lager' });
    expect(t.winterKill).toBeUndefined();
  });
  it('ignores nulls and unknown properties', () => {
    const t = toVarietyTraits(rows([['reifezeit', null], ['reife', 5], ['proteingehalt', 12]]));
    expect(t.maturity).toEqual({ value: 5, source: 'reife' });
    expect(t.yield).toBeUndefined();
    expect(new Set(TRAIT_PROPERTY_NAMES).size).toBe(TRAIT_PROPERTY_NAMES.length);
  });
});

describe('toDiseaseRatings (reference resistance.test.ts)', () => {
  it('maps susceptibilities to diseases, worst duplicate first', () => {
    expect(toDiseaseRatings(rows([['anfaelligkeit_braunrost', 4], ['gelbrost', 7]]))).toEqual([
      { disease: 'Gelbrost', susceptibility: 7 },
      { disease: 'Braunrost', susceptibility: 4 },
    ]);
    expect(toDiseaseRatings(rows([['anfaelligkeit_mehltau', 3], ['anfaelligkeit_fuer_mehltau', 6], ['mehltau', 2]]))).toEqual([{ disease: 'Mehltau', susceptibility: 6 }]);
  });
  it('drops values outside 1–9 and non-susceptibility properties', () => {
    expect(toDiseaseRatings(rows([['braunrost', null], ['gelbrost', 0], ['mehltau', 10]]))).toEqual([]);
    expect(toDiseaseRatings(rows([['resistenz_bydv', 9], ['ertrag', 8], ['frostempfindlichkeit', 5]]))).toEqual([]);
    expect(DISEASE_PROPERTY_NAMES.some((n) => n.includes('resistenz') || n.includes('toleranz'))).toBe(false);
  });
});
