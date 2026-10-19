import { record } from './__fixtures__/records.js';
import { gapsOf, RECORD_FIELDS, summarise } from './records.js';

describe('RECORD_FIELDS', () => {
  it('has fourteen entries, thirteen of them always required', () => {
    // Thirteen required fields plus the time of day, which only some Auflagen demand.
    expect(RECORD_FIELDS).toHaveLength(14);
    expect(RECORD_FIELDS.filter((f) => f.requirement === 'always')).toHaveLength(13);
  });

  it('names for every field where its value comes from', () => {
    for (const field of RECORD_FIELDS) {
      expect(field.source.length).toBeGreaterThan(5);
      expect(field.label.length).toBeGreaterThan(2);
    }
  });
});

describe('gapsOf', () => {
  it('finds nothing on a complete record', () => {
    expect(gapsOf(record())).toEqual([]);
  });

  it('demands the time of day only where an Auflage requires it', () => {
    expect(gapsOf(record({ timeOfDay: null, timeOfDayRequired: false }))).toEqual([]);
    expect(gapsOf(record({ timeOfDay: null, timeOfDayRequired: true })).map((g) => g.key)).toEqual(['timeOfDay']);
  });

  it('accepts the location from a geometry OR a FLIK', () => {
    expect(gapsOf(record({ flik: null })).map((g) => g.key)).not.toContain('fieldLocation');
    expect(gapsOf(record({ hasGeometry: false })).map((g) => g.key)).not.toContain('fieldLocation');
    expect(gapsOf(record({ hasGeometry: false, flik: null })).map((g) => g.key)).toContain('fieldLocation');
  });

  it('counts a dose without unit or of zero as missing', () => {
    expect(gapsOf(record({ doseUnit: null })).map((g) => g.key)).toContain('dose');
    expect(gapsOf(record({ dose: 0 })).map((g) => g.key)).toContain('dose');
  });

  it('counts BBCH 0 as recorded, not as missing', () => {
    expect(gapsOf(record({ bbch: 0 })).map((g) => g.key)).not.toContain('growthStage');
    expect(gapsOf(record({ bbch: null })).map((g) => g.key)).toContain('growthStage');
  });

  it('reports all thirteen required fields on an empty record', () => {
    const empty = record({
      date: null,
      product: null,
      kennr: null,
      dose: null,
      doseUnit: null,
      areaHa: null,
      fieldName: null,
      hasGeometry: false,
      flik: null,
      crop: null,
      cropEppo: null,
      applicatorName: null,
      usageType: null,
      targetOrganism: null,
      bbch: null,
    });
    expect(gapsOf(empty)).toHaveLength(13);
  });

  it('gives every gap its source, so it can be fixed', () => {
    expect(gapsOf(record({ applicatorName: null }))).toEqual([{ key: 'applicator', label: 'Anwender', source: 'verantwortliche Person der Maßnahme' }]);
  });
});

describe('summarise', () => {
  it('counts complete applications and gaps per field', () => {
    const result = summarise([record(), record({ operationId: 'op2', applicatorName: null }), record({ operationId: 'op3', applicatorName: null, bbch: null })]);
    expect(result.applications).toBe(3);
    expect(result.complete).toBe(1);
    expect(result.byField[0]).toMatchObject({ key: 'applicator', missing: 2 });
    expect(result.byField.map((f) => f.key)).toEqual(['applicator', 'growthStage']);
  });

  it('names the weakest applications as examples, not only counts', () => {
    const result = summarise([record({ operationId: 'few', applicatorName: null }), record({ operationId: 'worst', applicatorName: null, bbch: null, targetOrganism: null })]);
    expect(result.worst[0].operationId).toBe('worst');
    expect(result.worst[0].missing).toHaveLength(3);
  });

  it('stays at five examples so the answer stays readable', () => {
    const many = Array.from({ length: 12 }, (_, i) => record({ operationId: `op${i}`, applicatorName: null }));
    expect(summarise(many).worst).toHaveLength(5);
  });

  it('reports no gaps instead of thirteen for no applications', () => {
    expect(summarise([])).toMatchObject({ applications: 0, complete: 0, byField: [], worst: [] });
  });
});
