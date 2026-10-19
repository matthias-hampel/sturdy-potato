import type { Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import type { Job } from '../../jobs/runner.js';
import { type DetectionField, harvestDetectionHandler, planDetections, sceneOf, siteKeyFor } from './harvest-detection.job.js';

const field = (id: string, scenes: [string, number][], over: Partial<DetectionField> = {}): DetectionField => ({
  organizationId: 'org',
  cropCycleId: id,
  fieldId: `f-${id}`,
  fieldName: `Schlag ${id}`,
  lat: 52.31,
  lng: 10.52,
  scenes: scenes.map(([date, ndvi]) => ({ date, ndvi, cloudCover: 0 })),
  ...over,
});

describe('sceneOf', () => {
  it('treats ≥ 99 % valid pixels as a clear scene', () => {
    expect(sceneOf({ date: '2026-08-20', ndvi: '0.71', validPixelPct: 99.4, status: 'valid' })).toEqual({ date: '2026-08-20', ndvi: 0.71, cloudCover: 0 });
    expect(sceneOf({ date: '2026-08-20', ndvi: 0.71, validPixelPct: 80, status: 'valid' }).cloudCover).toBe(20);
    expect(sceneOf({ date: '2026-08-20', ndvi: 0.71, validPixelPct: 100, status: 'insufficient_coverage' }).cloudCover).toBe(0);
    expect(sceneOf({ date: '2026-08-20', ndvi: null, validPixelPct: null }).cloudCover).toBeNull();
  });
});

describe('siteKeyFor', () => {
  it('uses a location number in the name, else the 0.1° cell, always within the organization', () => {
    expect(siteKeyFor({ organizationId: 'o1', fieldName: '14 - ISLANDO', lat: 1, lng: 1 })).toBe('o1:loc-14');
    expect(siteKeyFor({ organizationId: 'o1', fieldName: 'Hinterm Hof', lat: 52.31, lng: 10.52 })).toBe('o1:523_105');
    expect(siteKeyFor({ organizationId: 'o1', fieldName: 'X', lat: null, lng: null })).toBeNull();
  });
});

describe('planDetections', () => {
  const harvested = field('a', [
    ['2026-08-15', 0.72],
    ['2026-08-18', 0.7],
    ['2026-08-20', 0.22],
    ['2026-08-23', 0.2],
  ]);
  const standing = field('b', [
    ['2026-08-15', 0.75],
    ['2026-08-20', 0.74],
  ]);

  it('confirms a reproduced drop and records every field’s latest clear scene', () => {
    const plan = planDetections({ fields: [harvested, standing], year: 2026, dmByCycle: new Map([['a', new Map([['2026-08-20', 0.31]])]]), standingByCycle: new Map() });
    expect(plan.detections).toHaveLength(1);
    expect(plan.detections[0]).toMatchObject({ status: 'confirmed', trust: 'high', windowStart: '2026-08-18', windowEnd: '2026-08-20' });
    expect(plan.satelliteStatus.map((s) => [s.field.cropCycleId, s.date, s.ndvi])).toEqual([
      ['a', '2026-08-23', 0.2],
      ['b', '2026-08-20', 0.74],
    ]);
  });

  it('applies the DM gate and the sample veto', () => {
    const gated = planDetections({ fields: [harvested], year: 2026, dmByCycle: new Map([['a', new Map([['2026-08-20', 0.2], ['2026-08-23', 0.21]])]]), standingByCycle: new Map() });
    expect(gated.detections).toHaveLength(0);
    const vetoed = planDetections({ fields: [harvested], year: 2026, dmByCycle: new Map(), standingByCycle: new Map([['a', ['2026-08-25']]]) });
    expect(vetoed.detections[0]).toMatchObject({ status: 'rejected' });
    expect(vetoed.vetoed).toBe(1);
  });
});

describe('harvestDetectionHandler', () => {
  it('skips itself while maize-dmc-api is not configured', async () => {
    const prev = config.maizeDmc.apiUrl;
    config.maizeDmc.apiUrl = '';
    try {
      const db = { selectFrom: () => { throw new Error('must not query'); } } as unknown as Kysely<DB>;
      await expect(harvestDetectionHandler(db)({ payload: {} } as Job)).resolves.toBeUndefined();
    } finally {
      config.maizeDmc.apiUrl = prev;
    }
  });
});
