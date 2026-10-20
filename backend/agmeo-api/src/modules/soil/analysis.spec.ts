/** The analysis dashboard aggregation (ported from AGVOLUTION/agmeo actions/soil/soilAnalyseShared.ts). */
import { buildSoilAnalysisSummary, type SoilAnalysisPayload } from '@agmeo/contracts';
import { zoneMeans } from './history.service.js';

const payload: SoilAnalysisPayload = {
  totalFieldCount: 3,
  fields: [
    { id: 'a', name: 'Acker', sampleCount: 2, soilTexture: 'sL', bbox: [10, 52, 10.1, 52.1], classes: { ph: 'C', p: 'A', k: 'C', mg: 'E' } },
    { id: 'b', name: 'Bach', sampleCount: 1, soilTexture: 'T', bbox: [9.9, 51.9, 10, 52], classes: { ph: 'B', p: 'C', k: 'C', mg: 'C' } },
  ],
  zones: [
    { fieldId: 'a', year: 2024, areaHa: 2, values: { ph: 6, p2o5: 4, humus: 2.5 }, classes: { ph: 'C', p: 'A', k: null, mg: null }, limeDt: 0 },
    { fieldId: 'a', year: 2026, areaHa: 1, values: { ph: 6.4, p2o5: 6, humus: 3.5 }, classes: { ph: 'D', p: 'B', k: null, mg: null }, limeDt: 0 },
    { fieldId: 'b', year: 2025, areaHa: 3, values: { ph: 5.2 }, classes: { ph: 'B', p: null, k: null, mg: null }, limeDt: 30 },
  ],
};

describe('soil analysis summary', () => {
  it('aggregates the selected fields', () => {
    const s = buildSoilAnalysisSummary(payload, new Set(['a', 'b']));
    expect(s).toMatchObject({ sampleCount: 3, fieldCount: 2, totalFieldCount: 3, earliestYear: 2024, latestYear: 2026, totalLimeT: 3, humusClass: 'mid' });
    expect(s.avg.ph).toBeCloseTo((6 + 6.4 + 5.2) / 3, 2);
    expect(s.stages.ph).toEqual({ A: 0, B: 1, C: 1, D: 1, E: 0 });
    expect(s.stages.p2o5).toMatchObject({ A: 1, B: 1 });
    expect(s.dominantSoilTexture).toBe('sL');
    expect(s.bbox).toEqual([9.9, 51.9, 10.1, 52.1]);
    expect(s.perField.map((f) => [f.fieldName, f.sampleCount, f.limeDt])).toEqual([
      ['Acker', 2, 0],
      ['Bach', 1, 30],
    ]);
    expect(s.recommendations.find((r) => r.key === 'lowP')?.fields).toEqual(['Acker']);
    expect(s.recommendations.find((r) => r.key === 'lowPh')?.fields).toEqual(['Bach']);
    expect(s.recommendations.find((r) => r.key === 'highMg')?.fields).toEqual(['Acker']);
    expect(s.recommendations.some((r) => r.key === 'positiveBase')).toBe(false);
  });

  it('narrows to a selection and stays empty without one', () => {
    expect(buildSoilAnalysisSummary(payload, new Set(['b']))).toMatchObject({ sampleCount: 1, fieldCount: 1, avg: { ph: 5.2, p2o5: null } });
    expect(buildSoilAnalysisSummary(payload, new Set())).toMatchObject({ sampleCount: 0, fieldCount: 0, totalLimeT: null, humusClass: null, bbox: null });
  });

  it('weights zone means by area', () => {
    expect(zoneMeans([{ areaHa: 3, values: { ph: 6 } }, { areaHa: 1, values: { ph: 7, k2o: 10 } }])).toEqual({ ph: 6.25, k2o: 10 });
  });
});
