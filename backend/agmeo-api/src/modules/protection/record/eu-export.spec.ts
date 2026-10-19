import { finding, load, record } from './__fixtures__/records.js';
import { buildExport, EXPORT_SCHEMA, preflight } from './eu-export.js';

describe('buildExport', () => {
  it('carries schema, version and year', () => {
    const doc = buildExport(load([record()]), new Date('2026-09-12T10:00:00Z'));
    expect(doc).toMatchObject({ schema: EXPORT_SCHEMA, schemaVersion: 2, year: 2026 });
    expect(doc.generatedAt).toBe('2026-09-12T10:00:00.000Z');
  });

  it('folds a tank mix into ONE application with several products', () => {
    const doc = buildExport(load([record({ inputId: 'in1' }), record({ inputId: 'in2', product: 'Partner' })]));
    expect(doc.applications).toHaveLength(1);
    expect(doc.applications[0].products).toHaveLength(2);
  });

  it('keeps one operation over two fields as two applications', () => {
    const doc = buildExport(load([record({ passId: 'p1' }), record({ passId: 'p2', fieldId: 'f2', fieldName: 'Schlag 002' })]));
    expect(doc.applications.map((a) => [a.operationId, a.passId, a.field.name])).toEqual([
      ['op1', 'p1', 'Schlag 001'],
      ['op1', 'p2', 'Schlag 002'],
    ]);
  });

  it('turns a rate per hectare into the amount for the area', () => {
    const doc = buildExport(load([record({ dose: 0.8, doseUnit: 'l/ha', areaHa: 10 })]));
    expect(doc.applications[0].products[0]).toMatchObject({ absoluteAmount: 8, absoluteAmountUnit: 'l' });
  });

  it('leaves an amount without area reference as it is', () => {
    const doc = buildExport(load([record({ dose: 5, doseUnit: 'l' })]));
    expect(doc.applications[0].products[0]).toMatchObject({ absoluteAmount: 5, absoluteAmountUnit: 'l' });
  });

  it('gives no absolute amount when the area is missing', () => {
    expect(buildExport(load([record({ areaHa: null })])).applications[0].products[0].absoluteAmount).toBeNull();
  });

  it('freezes the waiting period and the earliest harvest on the application', () => {
    const doc = buildExport(load([record({ date: '2026-06-20' })]));
    expect(doc.applications[0].products[0]).toMatchObject({ preHarvestIntervalDays: 35, earliestHarvestDate: '2026-07-25' });
  });

  it('sorts the applications by date', () => {
    const doc = buildExport(load([record({ operationId: 'b', date: '2026-06-01' }), record({ operationId: 'a', date: '2026-04-01' })]));
    expect(doc.applications.map((a) => a.operationId)).toEqual(['a', 'b']);
  });

  it('carries the missing fields per application', () => {
    expect(buildExport(load([record({ applicatorName: null })])).applications[0].missingFields).toEqual(['Anwender']);
  });

  it('joins the gaps of both rows of a tank mix without duplicates', () => {
    const doc = buildExport(load([record({ inputId: 'in1', applicatorName: null }), record({ inputId: 'in2', applicatorName: null, targetOrganism: null })]));
    expect(doc.applications[0].missingFields).toEqual(['Anwender', 'Anwendungsgebiet']);
  });
});

describe('preflight', () => {
  it('reports a clean state as ready', () => {
    const l = load([record()]);
    const p = preflight(l, buildExport(l));
    expect(p).toMatchObject({ applications: 1, exportable: 1, incomplete: 0, ready: true });
    expect(p.bvl).toEqual([]);
  });

  it('is not ready while a required field is missing', () => {
    const l = load([record({ applicatorName: null })]);
    const p = preflight(l, buildExport(l));
    expect(p).toMatchObject({ incomplete: 1, exportable: 0, ready: false });
    expect(p.records.byField[0]).toMatchObject({ label: 'Anwender', missing: 1 });
  });

  it('is not ready with a deviation from the approval, and counts per code', () => {
    const l = load([record()], { bvl: [finding()] });
    const p = preflight(l, buildExport(l));
    expect(p.ready).toBe(false);
    expect(p.bvlByCode).toEqual([{ code: 'dose_above_max', severity: 'deviation', count: 1 }]);
  });

  it('stays ready with a mere notice and lists deviations first', () => {
    const l = load([record()], { bvl: [finding({ code: 'unknown_registration', severity: 'notice' })] });
    expect(preflight(l, buildExport(l)).ready).toBe(true);
    const both = load([record()], { bvl: [finding({ code: 'unknown_registration', severity: 'notice' }), finding()] });
    expect(preflight(both, buildExport(both)).bvl.map((f) => f.severity)).toEqual(['deviation', 'notice']);
  });

  it('counts applications without FLIK separately without blocking', () => {
    const l = load([record({ flik: null })]);
    const p = preflight(l, buildExport(l));
    expect(p.withoutFlik).toBe(1);
    expect(p.ready).toBe(true);
  });

  it('says nothing about gaps for zero applications', () => {
    const l = load([], { planned: 3 });
    const p = preflight(l, buildExport(l));
    expect(p).toMatchObject({ applications: 0, planned: 3, incomplete: 0, ready: true });
    expect(p.records.byField).toEqual([]);
  });
});

describe('buildExport — pass without a product', () => {
  const withoutProduct = record({ inputId: null, product: null, kennr: null, awgId: null, dose: null, doseUnit: null, preHarvestIntervalDays: null });

  it('stays one application and invents no empty product entry', () => {
    const doc = buildExport(load([withoutProduct]));
    expect(doc.applications).toHaveLength(1);
    expect(doc.applications[0].products).toEqual([]);
  });

  it('reports product, registration number and dose as missing', () => {
    expect(buildExport(load([withoutProduct])).applications[0].missingFields).toEqual(expect.arrayContaining(['Mittelname', 'BVL-Zulassungsnummer', 'Aufwandmenge']));
  });

  it('keeps the export from being ready', () => {
    const l = load([withoutProduct]);
    expect(preflight(l, buildExport(l))).toMatchObject({ applications: 1, incomplete: 1, ready: false });
  });
});

describe('certificates in the export', () => {
  const now = new Date('2026-09-12T00:00:00Z');

  it('carries the Sachkundenachweis and the sprayer inspection', () => {
    const doc = buildExport(load([record()]), now);
    expect(doc.farm.sachkunde).toEqual({ number: 'NI-12345', holder: 'M. Hoffmann', validUntil: '2029-06-30' });
    expect(doc.farm.sprayerInspection).toEqual({ number: 'PR-9988', lastInspection: '2025-04-15' });
  });

  it('reports missing certificates in the preflight without blocking the export', () => {
    const l = load([record()], { attestations: undefined });
    const p = preflight(l, buildExport(l, now), now);
    expect(p.attestations.sachkunde.state).toBe('missing');
    expect(p.attestations.sprayer.state).toBe('missing');
    expect(p.ready).toBe(true);
  });

  it('reports an expired Sachkundenachweis', () => {
    const l = load([record()], {
      attestations: { certificateNumber: 'NI-1', certificateHolder: null, certificateValidUntil: '2026-01-31', sprayerInspectionNumber: 'P', sprayerInspectedOn: '2025-04-15', updatedAt: null },
    });
    const p = preflight(l, buildExport(l, now), now);
    expect(p.attestations.sachkunde.state).toBe('expired');
    expect(p.attestations.messages[0]).toContain('abgelaufen');
  });
});
