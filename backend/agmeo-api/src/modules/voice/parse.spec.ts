import { OPERATION_DRAFT_KEYS, type OperationDraft, validateOperationDraft } from '@agmeo/contracts';
import { normalize, numberWord, parseDictation, rateInBaseUnit, spokenNumbers, type VoiceVocabulary } from './parse.js';

const TODAY = '2026-04-20';
const empty: VoiceVocabulary = { fields: [], products: [] };
const vocab: VoiceVocabulary = {
  fields: [
    { id: 'f1', name: 'Nordschlag' },
    { id: 'f2', name: 'Langer Streifen' },
    { id: 'f3', name: 'Schlag 12' },
    { id: 'f4', name: 'Mühlenfeld' },
  ],
  products: [
    { id: 'p1', name: 'Prosaro', category: 'crop_protection', baseUnit: 'l' },
    { id: 'p2', name: 'Harnstoff 46', category: 'fertilizer', baseUnit: 'kg' },
    { id: 'p3', name: 'Rindergülle', category: 'fertilizer', baseUnit: 'm3' },
    { id: 'p4', name: 'Karate Zeon', category: 'crop_protection', baseUnit: 'l' },
    { id: 'p5', name: 'KAS 27', category: 'fertilizer', baseUnit: 't' },
  ],
};

/** BEISPIEL 1 of the reference's validated prompt. */
const example1: OperationDraft = {
  kind: 'operation',
  fieldName: 'Nordschlag',
  category: 'plantProtection',
  articleName: 'Prosaro',
  quantity: 1,
  unit: 'l/ha',
  bbch: 39,
  partialArea: false,
  partialAreaHa: null,
  windMs: 4,
  tempC: null,
  date: 'heute',
  operatorHint: null,
  freeText: '',
  missing: [],
  confidence: 'high',
};

describe('OperationDraft contract (reference operationDraft.test.ts)', () => {
  const sparse: OperationDraft = {
    ...example1,
    fieldName: null,
    category: 'fertilization',
    articleName: 'Harnstoff',
    quantity: null,
    unit: null,
    bbch: null,
    windMs: null,
    date: null,
    operatorHint: 'der Lehrling',
    freeText: "Schlag liegt 'oben', genaue Bezeichnung unklar.",
    missing: ['fieldName', 'quantity', 'unit'],
    confidence: 'low',
  };

  it('accepts complete and sparse drafts', () => {
    expect(validateOperationDraft(example1)).toEqual({ valid: true, draft: example1 });
    expect(validateOperationDraft(sparse)).toEqual({ valid: true, draft: sparse });
  });

  it.each([null, undefined, 42, 'draft', [example1]])('rejects non-objects (%p)', (value) => {
    expect(validateOperationDraft(value).valid).toBe(false);
  });

  it.each(OPERATION_DRAFT_KEYS)('rejects a draft without the %s key', (key) => {
    const draft: Record<string, unknown> = { ...example1 };
    delete draft[key];
    expect(validateOperationDraft(draft)).toEqual({ valid: false, errors: [`missing key: ${key}`] });
  });

  it('rejects unexpected keys, off-enum values and wrong types', () => {
    expect(validateOperationDraft({ ...example1, schlagNummer: 12 })).toEqual({ valid: false, errors: ['unexpected key: schlagNummer'] });
    for (const [key, value] of [
      ['kind', 'spritzung'],
      ['category', 'grunddüngung'],
      ['unit', 'g/ha'],
      ['confidence', 'certain'],
      ['bbch', 39.5],
      ['bbch', 100],
    ] as const) {
      expect(validateOperationDraft({ ...example1, [key]: value }).valid).toBe(false);
    }
    const r = validateOperationDraft({ ...example1, quantity: '1 Liter', partialArea: 'nein', freeText: null, missing: [1] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toHaveLength(4);
  });
});

describe('spoken numbers', () => {
  it('reads German number words', () => {
    expect(numberWord('zweihundert')).toBe(200);
    expect(numberWord('fuenfundzwanzig')).toBe(25);
    expect(numberWord('einhundertfuenfzig')).toBe(150);
    expect(numberWord('dreitausendfuenfhundert')).toBe(3500);
    expect(numberWord('schlag')).toBeNull();
    expect(spokenNumbers(normalize('zwei Komma fünf Liter'))).toBe('2.5 liter');
    expect(spokenNumbers(normalize('anderthalb Liter'))).toBe('1.5 liter');
    expect(spokenNumbers(normalize('ein Liter pro Hektar'))).toBe('1 liter pro hektar');
    expect(spokenNumbers(normalize('ein halber Hektar'))).toBe('0.5 hektar');
    expect(normalize('1,5 l/ha')).toBe('1.5 l/ha');
  });

  it('converts spoken rates to the product unit', () => {
    expect(rateInBaseUnit(200, 'kg/ha', 'kg')).toBe(200);
    expect(rateInBaseUnit(300, 'kg/ha', 't')).toBe(0.3);
    expect(rateInBaseUnit(25, 'm3/ha', 'm3')).toBe(25);
    expect(rateInBaseUnit(1, 'l/ha', 'kg')).toBeNull();
    expect(rateInBaseUnit(null, 'l/ha', 'l')).toBeNull();
  });
});

describe('parseDictation', () => {
  it('parses the reference example 1 to the same draft', () => {
    const { draft, resolved } = parseDictation('Heute auf dem Nordschlag Prosaro gefahren, ein Liter pro Hektar, Weizen BBCH 39, Wind war vier Meter.', vocab, TODAY);
    expect(draft).toEqual(example1);
    expect(validateOperationDraft(draft).valid).toBe(true);
    expect(resolved).toEqual({ fieldId: 'f1', fieldName: 'Nordschlag', productId: 'p1', productName: 'Prosaro', operationType: 'crop_protection', ratePerHa: 1, performedOn: TODAY });
  });

  it('parses example 1 without the organization’s names too', () => {
    const { draft, resolved } = parseDictation('Heute auf dem Nordschlag Prosaro gefahren, ein Liter pro Hektar, Weizen BBCH 39, Wind war vier Meter.', empty, TODAY);
    expect(draft).toEqual(example1);
    expect(resolved).toMatchObject({ fieldId: null, productId: null, operationType: 'crop_protection' })
  });

  it('parses the reference example 2: doubt, vague place, operator', () => {
    const { draft } = parseDictation('Äh Harnstoff gestreut, äh wieviel weiß ich nicht mehr, der Lehrling ist gefahren, irgendein Schlag oben.', empty, TODAY);
    expect(draft).toMatchObject({
      kind: 'operation',
      fieldName: null,
      category: 'fertilization',
      articleName: 'Harnstoff',
      quantity: null,
      unit: null,
      date: null,
      operatorHint: 'der Lehrling',
      missing: ['fieldName', 'quantity', 'unit'],
      confidence: 'low',
    });
    expect(draft.freeText).toContain('oben');
  });

  it('matches inflected field names and takes the corrected amount', () => {
    const { draft, resolved } = parseDictation('Gestern vom Langen Streifen Gülle ausgebracht, 20 Kubikmeter, nee warte, 25 Kubik mein ich. Eingearbeitet nach vier Stunden.', vocab, TODAY);
    expect(draft).toMatchObject({ fieldName: 'Langer Streifen', articleName: 'Rindergülle', category: 'fertilization', quantity: 25, unit: 'm3/ha', date: 'gestern' });
    expect(resolved).toMatchObject({ fieldId: 'f2', productId: 'p3', ratePerHa: 25, performedOn: '2026-04-19', operationType: 'fertilization' });
  });

  it('converts milliliters and doppelzentner, and leaves unsupported units in freeText', () => {
    expect(parseDictation('Karate Zeon 75 Milliliter pro Hektar auf Schlag 12 gespritzt', vocab, TODAY).draft).toMatchObject({ fieldName: 'Schlag 12', quantity: 0.075, unit: 'l/ha', confidence: 'high' });
    const kas = parseDictation('KAS gestreut auf dem Mühlenfeld, zwei Doppelzentner', vocab, TODAY);
    expect(kas.draft).toMatchObject({ articleName: 'KAS 27', quantity: 0.2, unit: 't/ha' });
    expect(kas.resolved.ratePerHa).toBe(0.2);
    const seed = parseDictation('Mühlenfeld gedrillt, 320 Körner pro Quadratmeter', vocab, TODAY).draft;
    expect(seed).toMatchObject({ category: 'sowing', quantity: null, unit: null });
    expect(seed.freeText).toContain('320 koerner pro quadratmeter');
    expect(seed.missing).toEqual(['articleName', 'quantity', 'unit']);
  });

  it('recognizes dates, wind in km/h, temperature and partial areas', () => {
    const { draft } = parseDictation('Am 12.4. Harnstoff 46 auf dem Nordschlag gestreut, 200 Kilo, nur die Ecke am Wald, ein halber Hektar betroffen. 12 Grad, Wind 18 km/h.', vocab, TODAY);
    expect(draft).toMatchObject({ date: '2026-04-12', quantity: 200, unit: 'kg/ha', partialArea: true, partialAreaHa: 0.5, tempC: 12, windMs: 5 });
    expect(parseDictation('vorgestern gegrubbert auf Schlag 12', vocab, TODAY).draft).toMatchObject({ date: '2026-04-18', category: 'tillage', missing: [], confidence: 'high' });
    // A decimal is not a date.
    expect(parseDictation('Prosaro 1.5 Liter auf dem Nordschlag gespritzt', vocab, TODAY).draft.date).toBeNull();
  });

  it('keeps observations and notes as such', () => {
    const obs = parseDictation('Auf dem Mühlenfeld starker Befall mit Gelbrost, BBCH 32.', vocab, TODAY);
    expect(obs.draft).toMatchObject({ kind: 'observation', category: null, fieldName: 'Mühlenfeld', bbch: 32, missing: [] });
    expect(obs.draft.freeText).toContain('Gelbrost');
    expect(obs.resolved.operationType).toBe('inspection');
    const note = parseDictation('Notiz: Zaun am Nordschlag reparieren.', vocab, TODAY);
    expect(note.draft).toMatchObject({ kind: 'note', fieldName: 'Nordschlag', freeText: 'Zaun am Nordschlag reparieren.' });
  });

  it('collects disease notes of an operation in freeText and asks for missing core fields', () => {
    const { draft } = parseDictation('Heute Prosaro gespritzt wegen Septoria.', vocab, TODAY);
    expect(draft).toMatchObject({ articleName: 'Prosaro', fieldName: null, missing: ['fieldName', 'quantity', 'unit'], confidence: 'low' });
    expect(draft.freeText).toContain('Septoria');
    expect(validateOperationDraft(draft).valid).toBe(true);
  });
});
