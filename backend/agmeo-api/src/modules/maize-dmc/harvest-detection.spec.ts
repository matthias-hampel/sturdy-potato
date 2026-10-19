import { readFileSync } from 'node:fs';
import {
  detectHarvest,
  detectionOverridesStatus,
  eligibleScenes,
  type HarvestDetection,
  REFERENCE_MIN_NDVI,
  type SceneObservation,
  siteContaminatedDates,
  STANDING_VETO_LOOKBACK_DAYS,
  vetoesHarvested,
} from './harvest-detection.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/harvest-detection.fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown;

type FixtureField = {
  fieldId: string;
  displayName: string;
  site: string;
  scenes: SceneObservation[];
  dmByDate: Record<string, number>;
  standingDates: string[];
};

const fields = (fixture as { fields: FixtureField[] }).fields;
const SEASON_START = '2026-08-01';

const bySite = new Map<string, FixtureField[]>();
for (const f of fields) bySite.set(f.site, [...(bySite.get(f.site) ?? []), f]);

const contaminated = new Map<string, Set<string>>();
for (const [site, members] of bySite) {
  contaminated.set(
    site,
    siteContaminatedDates(new Map(members.map((m) => [m.fieldId, m.scenes]))),
  );
}

function run(
  f: FixtureField,
  opts: { standing?: string[] } = {},
): HarvestDetection | null {
  return detectHarvest({
    scenes: f.scenes,
    contaminatedDates: contaminated.get(f.site) ?? new Set(),
    dmByDate: new Map(Object.entries(f.dmByDate)),
    standingDates: opts.standing ?? f.standingDates,
    seasonStart: SEASON_START,
  });
}

const site = (name: string) => {
  const members = bySite.get(name);
  if (!members) throw new Error(`fixture has no site ${name}`);
  return members;
};

describe('siteContaminatedDates — whole-site collapse that bounces back', () => {
  it("AMA-13's 2026-08-26 scene (all fields at NDVI ≈ 0.02) is dropped as implausibly low", () => {
    for (const f of site('AMA-13')) {
      expect(
        f.scenes.some((s) => s.date === '2026-08-26' && s.cloudCover === 0),
      ).toBe(true);
      expect(
        eligibleScenes(f.scenes, new Set()).some(
          (s) => s.date === '2026-08-26',
        ),
      ).toBe(false);
    }
  });

  it("flags Bozkov's 2026-08-24 dip (0.9 → 0.35–0.73 → 0.9)", () => {
    expect(contaminated.get('Bozkov')?.has('2026-08-24')).toBe(true);
  });

  it("does not flag Kobylí's real harvest drop (nobody bounces back)", () => {
    expect(contaminated.get('Kobylí')?.has('2026-08-09')).toBe(false);
  });
});

describe('eligibleScenes', () => {
  it('drops cloudy scenes, implausibly low NDVI and site-contaminated dates', () => {
    const scenes: SceneObservation[] = [
      { date: '2026-08-01', ndvi: 0.7, cloudCover: 0 },
      { date: '2026-08-03', ndvi: 0.6, cloudCover: 12 },
      { date: '2026-08-05', ndvi: 0.02, cloudCover: 0 },
      { date: '2026-08-07', ndvi: 0.65, cloudCover: 0 },
      { date: '2026-08-09', ndvi: null, cloudCover: 0 },
    ];
    expect(
      eligibleScenes(scenes, new Set(['2026-08-07'])).map((s) => s.date),
    ).toEqual(['2026-08-01']);
  });
});

describe('detectHarvest — ground truth 2026', () => {
  it('Kobylí (harvested Aug 7): all four fields confirmed high-trust on Aug 11', () => {
    const results = site('Kobylí').map((f) => run(f));
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r).toMatchObject({
        status: 'confirmed',
        trust: 'high',
        windowStart: '2026-08-07',
        windowEnd: '2026-08-09',
      });
      expect(r?.confirmDate).toBe('2026-08-11');
      expect(detectionOverridesStatus(r)).toBe(true);
    }
  });

  it('AMA-17 (harvested ≈ Aug 12): NDVI 0.74 → 0.28 on Aug 13, reproduced Aug 14/16', () => {
    const results = site('AMA-17').map((f) => run(f));
    const confirmed = results.filter((r) => r?.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThanOrEqual(6);
    expect(
      confirmed.filter((r) => r?.trust === 'high').length,
    ).toBeGreaterThanOrEqual(5);
    for (const r of confirmed)
      expect(r).toMatchObject({
        windowStart: '2026-08-11',
        windowEnd: '2026-08-13',
      });
  });

  it('AMA-22 (harvested Aug 31): drop on Sep 2 stays unconfirmed until a clear scene 2–5 days later', () => {
    const results = site('AMA-22').map((f) => run(f));
    expect(
      results.filter((r) => r?.status === 'confirmed' && r.trust === 'high'),
    ).toHaveLength(0);
    expect(
      results.filter((r) => r?.status === 'unconfirmed').length,
    ).toBeGreaterThanOrEqual(6);
    for (const r of results) expect(detectionOverridesStatus(r)).toBe(false);
  });

  it('AMA-13/16 (harvested by Aug 24): contaminated post-harvest scenes never confirm', () => {
    for (const name of ['AMA-13', 'AMA-16']) {
      const results = site(name).map((f) => run(f));
      expect(results.filter((r) => r?.status === 'confirmed')).toHaveLength(0);
    }
  });

  it('AMA-32: a slow senescence decline (0.56 → 0.08 over a month) is not a harvest signature', () => {
    const results = site('AMA-32').map((f) => run(f));
    expect(results.filter((r) => r?.status === 'confirmed')).toHaveLength(0);
  });

  it('Bozkov (not harvested, DM 28 %): no detection at all', () => {
    for (const f of site('Bozkov')) expect(run(f)).toBeNull();
  });

  it('AMA-19: the Sep 2 haze dip (0.7 → 0.36–0.58, back to 0.6–0.7 on Sep 5) never confirms', () => {
    for (const f of site('AMA-19'))
      expect(run(f)?.status ?? 'none').not.toBe('confirmed');
  });

  it('AMA-30 AMABELL: a reproduced drop is vetoed by a lab sample taken six days later', () => {
    const f = site('AMA-30').find((x) => x.displayName === '30 - AMABELL');
    if (!f) throw new Error('fixture field missing');
    const withoutVeto = run(f, { standing: [] });
    expect(withoutVeto?.status).toBe('confirmed');
    const withVeto = run(f);
    expect(withVeto?.status).toBe('rejected');
    expect(withVeto?.rejectedReason).toMatch(/crop sampled on 2026-08-24/);
    expect(detectionOverridesStatus(withVeto)).toBe(false);
  });

  it('no confirmed detection anywhere in the fixture is contradicted by a later sample', () => {
    for (const f of fields) {
      const r = run(f);
      if (r?.status !== 'confirmed') continue;
      const later = f.standingDates.filter((d) => d > r.windowStart);
      for (const d of later) {
        const gap =
          (Date.parse(`${d}T00:00:00Z`) -
            Date.parse(`${r.windowStart}T00:00:00Z`)) /
          86_400_000;
        expect(gap).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('detectHarvest — synthetic edge cases', () => {
  const clear = (date: string, ndvi: number): SceneObservation => ({
    date,
    ndvi,
    cloudCover: 0,
  });
  const base = {
    contaminatedDates: new Set<string>(),
    standingDates: [] as string[],
    seasonStart: SEASON_START,
  };
  const dm = new Map([['2026-08-20', 0.31]]);

  it('confirms a sudden drop reproduced 2–5 days later', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: dm,
      scenes: [
        clear('2026-08-15', 0.72),
        clear('2026-08-18', 0.7),
        clear('2026-08-20', 0.22),
        clear('2026-08-23', 0.2),
      ],
    });
    expect(r).toMatchObject({
      status: 'confirmed',
      trust: 'high',
      windowStart: '2026-08-18',
      windowEnd: '2026-08-20',
      confirmDate: '2026-08-23',
    });
  });

  it('rejects when the confirmation scene contradicts the drop', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: dm,
      scenes: [
        clear('2026-08-18', 0.7),
        clear('2026-08-20', 0.22),
        clear('2026-08-23', 0.55),
      ],
    });
    expect(r?.status).toBe('rejected');
    expect(r?.rejectedReason).toMatch(/2026-08-23/);
  });

  it('rejects a candidate that bounces back after the confirmation window', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: dm,
      scenes: [
        clear('2026-08-18', 0.7),
        clear('2026-08-20', 0.22),
        clear('2026-08-29', 0.6),
      ],
    });
    expect(r?.status).toBe('rejected');
  });

  it('ignores a drop while the model DM is below 27 %', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: new Map([['2026-07-11', 0.19]]),
      scenes: [
        clear('2026-07-09', 0.6),
        clear('2026-07-11', 0.11),
        clear('2026-07-14', 0.12),
      ],
    });
    expect(r).toBeNull();
  });

  it('without a DM run, drops before the season start are ignored', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: new Map(),
      scenes: [
        clear('2026-07-09', 0.6),
        clear('2026-07-11', 0.11),
        clear('2026-07-14', 0.12),
      ],
    });
    expect(r).toBeNull();
  });

  it('a weaker drop (≥ 0.25 to ≤ 0.35) is medium trust and never overrides', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: dm,
      scenes: [
        clear('2026-08-18', 0.6),
        clear('2026-08-20', 0.33),
        clear('2026-08-23', 0.31),
      ],
    });
    expect(r).toMatchObject({ status: 'confirmed', trust: 'medium' });
    expect(detectionOverridesStatus(r)).toBe(false);
  });

  it('a later clean signature still confirms after an earlier rejected candidate', () => {
    const r = detectHarvest({
      ...base,
      dmByDate: new Map([
        ['2026-08-10', 0.3],
        ['2026-08-24', 0.34],
      ]),
      scenes: [
        clear('2026-08-08', 0.7),
        clear('2026-08-10', 0.2), // haze
        clear('2026-08-13', 0.68), // contradiction → rejected
        clear('2026-08-22', 0.66),
        clear('2026-08-24', 0.18),
        clear('2026-08-27', 0.17),
      ],
    });
    expect(r).toMatchObject({
      status: 'confirmed',
      trust: 'high',
      windowEnd: '2026-08-24',
    });
  });
});

describe('vetoesHarvested', () => {
  it('vetoes when the scene is recent and still shows a standing crop', () => {
    expect(
      vetoesHarvested({ date: '2026-09-06', ndvi: 0.73 }, '2026-09-08'),
    ).toBe(true);
    expect(
      vetoesHarvested(
        { date: '2026-09-06', ndvi: REFERENCE_MIN_NDVI },
        '2026-09-08',
      ),
    ).toBe(true);
  });

  it('does not veto a bare-soil scene', () => {
    expect(
      vetoesHarvested(
        { date: '2026-09-06', ndvi: REFERENCE_MIN_NDVI - 0.01 },
        '2026-09-08',
      ),
    ).toBe(false);
  });

  it('does not veto once the scene is older than the lookback window', () => {
    expect(STANDING_VETO_LOOKBACK_DAYS).toBe(14);
    expect(
      vetoesHarvested({ date: '2026-07-01', ndvi: 0.73 }, '2026-09-08'),
    ).toBe(false); // well past 14 days
    expect(
      vetoesHarvested({ date: '2026-08-25', ndvi: 0.73 }, '2026-09-08'),
    ).toBe(true); // exactly 14 days
    expect(
      vetoesHarvested({ date: '2026-08-24', ndvi: 0.73 }, '2026-09-08'),
    ).toBe(false); // 15 days
  });

  it('ignores a scene dated after today (bad input) and a missing scene', () => {
    expect(
      vetoesHarvested({ date: '2026-09-09', ndvi: 0.73 }, '2026-09-08'),
    ).toBe(false);
    expect(vetoesHarvested(null, '2026-09-08')).toBe(false);
    expect(vetoesHarvested(undefined, '2026-09-08')).toBe(false);
  });
});
