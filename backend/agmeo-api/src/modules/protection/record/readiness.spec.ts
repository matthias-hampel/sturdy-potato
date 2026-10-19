import { finding, load, record } from './__fixtures__/records.js';
import type { PlannedPass } from './conversion.js';
import { buildExport, preflight } from './eu-export.js';
import type { ProtectionLoad } from './load.js';
import { buildReadiness, issueTargets } from './readiness.js';

const now = new Date(2026, 9, 15, 12);

const readiness = (l: ProtectionLoad) => {
  const document = buildExport(l, now);
  return buildReadiness(l, document, preflight(l, document, now), now);
};
const byCode = (l: ProtectionLoad) => new Map(readiness(l).map((i) => [i.code, i]));

describe('buildReadiness', () => {
  it('is empty when record, approval and certificates give no cause for complaint', () => {
    expect(readiness(load([record()]))).toEqual([]);
  });

  it('turns every missing required field into a blocking row with the passes it concerns', () => {
    // A tank mix is two rows of one pass: the pass is listed once, not per partner.
    const items = readiness(
      load([record({ kennr: null }), record({ inputId: 'in2', product: 'Partner', kennr: null }), record({ operationId: 'op2', inputId: 'in3', bbch: null, kennr: null })]),
    );
    expect(items.map((i) => [i.code, i.severity, i.count])).toEqual([
      ['field_kennr', 'blocking', 2],
      ['field_growthStage', 'blocking', 1],
    ]);
    expect(items[0].fix).toBe('protection');
    expect(items[0].affected[0]).toEqual({ operationId: 'op1', passId: 'op1', cropCycleId: 'c1', fieldId: 'f1', fieldName: 'Schlag 001', date: '2026-05-12', detail: undefined });
  });

  it('rates a deviation from the approval as warning and a notice as info', () => {
    const items = byCode(
      load([record(), record({ operationId: 'op2' })], {
        bvl: [finding(), finding({ operationId: 'op2', passId: 'op2', code: 'unknown_registration', severity: 'notice', message: 'Not in the register.' })],
      }),
    );
    expect(items.get('bvl_dose_above_max')).toMatchObject({ severity: 'warning', fix: 'protection', count: 1 });
    expect(items.get('bvl_dose_above_max')!.affected[0].detail).toContain('maximum');
    expect(items.get('bvl_unknown_registration')).toMatchObject({ severity: 'info', count: 1 });
    // Deviations do not block the file; only record gaps do.
    expect([...items.values()].some((i) => i.severity === 'blocking')).toBe(false);
  });

  it('places a finding without a known pass on the first pass of its operation', () => {
    const items = byCode(load([record({ passId: 'p1' }), record({ passId: 'p2', fieldId: 'f2', fieldName: 'Schlag 002' })], { bvl: [finding({ passId: null })] }));
    expect(items.get('bvl_dose_above_max')!.affected[0]).toMatchObject({ passId: 'p1', fieldName: 'Schlag 001' });
  });

  it('lists missing certificates as farm-data rows without passes', () => {
    const items = byCode(load([record()], { attestations: undefined }));
    expect(items.get('sachkunde_missing')).toMatchObject({ severity: 'warning', fix: 'farmData', count: 0 });
    expect(items.get('sprayer_missing')).toMatchObject({ severity: 'warning', fix: 'farmData' });
  });

  it('warns about a certificate expiring soon and an overdue sprayer inspection', () => {
    const items = byCode(
      load([record()], {
        attestations: { certificateNumber: 'NI-1', certificateHolder: null, certificateValidUntil: '2026-12-01', sprayerInspectionNumber: 'PR-1', sprayerInspectedOn: '2022-01-01', updatedAt: null },
      }),
    );
    expect(items.get('sachkunde_expiring')).toMatchObject({ params: { date: '2026-12-01' } });
    expect(items.get('sprayer_overdue')).toMatchObject({ params: { date: '2022-01-01' } });
    expect(items.has('sachkunde_expired')).toBe(false);
  });

  it('reports overdue and soon-due conversions of planned passes separately', () => {
    const planned = (operationId: string, date: string): PlannedPass => ({ operationId, passId: operationId, date, cropCycleId: 'c1', fieldId: 'f1', fieldName: 'Schlag 001' });
    const plannedPasses = [planned('p1', '2026-08-01'), planned('p2', '2026-09-18'), planned('p3', '2026-09-20'), planned('p4', '2026-11-01')];
    const items = byCode(load([record()], { planned: plannedPasses.length, plannedPasses }));
    expect(items.get('conversion_overdue')).toMatchObject({ severity: 'warning', fix: 'protection', count: 1 });
    expect(items.get('conversion_overdue')!.affected[0].operationId).toBe('p1');
    expect(items.get('conversion_due_soon')).toMatchObject({ count: 2, params: { days: 3 } });
    expect(items.get('planned')).toMatchObject({ severity: 'info', count: 4 });
  });

  it('names passes without FLIK as info, fixed in the field', () => {
    expect(byCode(load([record({ flik: null })])).get('without_flik')).toMatchObject({ severity: 'info', fix: 'fieldsManager', count: 1 });
  });

  it('sends every gap to where it is closed', () => {
    const items = byCode(
      load([
        record({ product: null, kennr: null, applicatorName: null, usageType: null }),
        record({ operationId: 'op2', inputId: 'in2', crop: null, cropEppo: null, fieldName: null }),
      ]),
    );
    expect(items.get('field_product')!.fix).toBe('protection');
    expect(items.get('field_applicator')!.fix).toBe('protection');
    expect(items.get('field_usageType')!.fix).toBe('protection');
    expect(items.get('field_crop')!.fix).toBe('fieldsManager');
    expect(items.get('field_fieldName')!.fix).toBe('fieldsManager');
  });

  it('shows at most eight passes per row but counts all', () => {
    const records = Array.from({ length: 10 }, (_, i) => record({ operationId: `op${i}`, inputId: `in${i}`, applicatorName: null }));
    const items = byCode(load(records));
    expect(items.get('field_applicator')).toMatchObject({ count: 10 });
    expect(items.get('field_applicator')!.affected).toHaveLength(8);
  });
});

describe('issueTargets', () => {
  const targets = (l: ProtectionLoad, code: string) => {
    const document = buildExport(l, now);
    return issueTargets(l, document, preflight(l, document, now), code, now);
  };

  it('returns every pass of a row, not only the eight shown', () => {
    const records = Array.from({ length: 10 }, (_, i) => record({ operationId: `op${i}`, inputId: `in${i}`, applicatorName: null }));
    const result = targets(load(records), 'field_applicator');
    expect(result.passes).toHaveLength(10);
    expect(new Set(result.passes.map((pass) => pass.cropCycleId))).toEqual(new Set(['c1']));
  });

  it('names a pass of a tank mix once, though each partner deviates', () => {
    const l = load([record({ inputId: 'in1' }), record({ inputId: 'in2', product: 'Partner' })], { bvl: [finding(), finding({ message: 'Partner too' })] });
    expect(targets(l, 'bvl_dose_above_max').passes).toHaveLength(1);
  });

  it('is empty once the gap is closed', () => {
    expect(targets(load([record()]), 'field_applicator')).toEqual({ passes: [], params: undefined });
  });
});
