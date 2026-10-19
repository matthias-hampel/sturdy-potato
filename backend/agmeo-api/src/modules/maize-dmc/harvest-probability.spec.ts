import {
  evaluateHarvest,
  harvestConfidenceOf,
  type HarvestFields,
  harvestStatusOf,
  probHarvested,
  withHarvestEvaluation,
} from './harvest-probability.js';

// The legacy anchors below describe the UNCORRECTED probability; the dry-down
// correction (on by default) is exercised in its own block at the end.
beforeEach(() => {
  process.env.DMC_HARVEST_P_CORRECTION = 'off';
});
afterAll(() => {
  delete process.env.DMC_HARVEST_P_CORRECTION;
});

// Behavioral anchors ported from kws-dmc tests/test_fraction_output.py
describe('probHarvested', () => {
  it('is ~0.5 when the mean sits exactly on the 33 % target, regardless of spread', () => {
    expect(probHarvested(0.33, 0.33, 0.33)).toBeCloseTo(0.5, 4);
    expect(probHarvested(0.33, 0.28, 0.38)).toBeCloseTo(0.5, 4);
  });

  it('is near 0 pre-season and near 1 when overripe', () => {
    expect(probHarvested(0.18, 0.18, 0.18)).toBeLessThan(0.01);
    expect(probHarvested(0.5, 0.48, 0.52)).toBeGreaterThan(0.99);
  });

  it('is monotonically increasing in the DM mean', () => {
    let prev = -1;
    for (const mean of [0.2, 0.25, 0.3, 0.33, 0.36, 0.4, 0.45]) {
      const p = probHarvested(mean, mean - 0.02, mean + 0.02);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('pulls toward 0.5 with wider forecast spread', () => {
    const tight = probHarvested(0.36, 0.355, 0.365);
    const wide = probHarvested(0.36, 0.3, 0.42);
    expect(wide).toBeLessThan(tight);
    expect(wide).toBeGreaterThan(0.5);
  });

  it('survives degenerate spread (p10 == p90) via the θ-sigma floor', () => {
    const p = probHarvested(0.36, 0.36, 0.36);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });
});

describe('harvestStatusOf / harvestConfidenceOf', () => {
  it('buckets at the 0.5 / 0.9 cutoffs', () => {
    expect(harvestStatusOf(0.49)).toBe('not_harvested');
    expect(harvestStatusOf(0.5)).toBe('possibly_harvested');
    expect(harvestStatusOf(0.89)).toBe('possibly_harvested');
    // ≥ 0.9 alone is not enough: one hot day never flips a field to harvested.
    expect(harvestStatusOf(0.9)).toBe('possibly_harvested');
  });

  it('promotes to harvested only after two previous run days ≥ 0.9 as well', () => {
    expect(harvestStatusOf(0.95, [0.92])).toBe('possibly_harvested');
    expect(harvestStatusOf(0.95, [0.92, 0.88])).toBe('possibly_harvested');
    expect(harvestStatusOf(0.95, [0.92, 0.91])).toBe('harvested');
    expect(harvestStatusOf(0.95, [0.92, 0.91, 0.2])).toBe('harvested');
  });

  describe('standing-crop veto (recentStandingScene)', () => {
    const persistentP = [0.92, 0.91]; // otherwise promotes to "harvested"

    it('caps a would-be harvested call at possibly_harvested when a recent clear scene still shows a standing crop', () => {
      // The KWS false-positive anchor: field ee660829-8468-434d-9959-c23fa24a6afe,
      // DM model said harvested on 2026-09-08, but its last clear scene
      // (2026-09-06, NDVI 0.73) flatly contradicted it.
      const scene = { date: '2026-09-06', ndvi: 0.73 };
      expect(harvestStatusOf(0.95, persistentP, scene, '2026-09-08')).toBe(
        'possibly_harvested',
      );
    });

    it('does not veto when the scene itself shows bare soil (low NDVI)', () => {
      const scene = { date: '2026-09-06', ndvi: 0.2 };
      expect(harvestStatusOf(0.95, persistentP, scene, '2026-09-08')).toBe(
        'harvested',
      );
    });

    it('does not veto a stale scene (older than 14 days)', () => {
      const scene = { date: '2026-08-20', ndvi: 0.73 }; // 19 days before todayIso
      expect(harvestStatusOf(0.95, persistentP, scene, '2026-09-08')).toBe(
        'harvested',
      );
    });

    it('does not veto right at the 14-day boundary, but does one day inside it', () => {
      const at14 = { date: '2026-08-25', ndvi: 0.73 }; // exactly 14 days before
      expect(harvestStatusOf(0.95, persistentP, at14, '2026-09-08')).toBe(
        'possibly_harvested',
      );
      const at15 = { date: '2026-08-24', ndvi: 0.73 }; // 15 days before
      expect(harvestStatusOf(0.95, persistentP, at15, '2026-09-08')).toBe(
        'harvested',
      );
    });

    it('is a no-op without a scene or without todayIso', () => {
      expect(harvestStatusOf(0.95, persistentP)).toBe('harvested');
      expect(harvestStatusOf(0.95, persistentP, null, '2026-09-08')).toBe(
        'harvested',
      );
      expect(
        harvestStatusOf(0.95, persistentP, { date: '2026-09-06', ndvi: 0.73 }),
      ).toBe('harvested');
    });

    it('never affects the possibly_harvested / not_harvested buckets, only the harvested promotion', () => {
      const scene = { date: '2026-09-06', ndvi: 0.73 };
      expect(harvestStatusOf(0.6, [], scene, '2026-09-08')).toBe(
        'possibly_harvested',
      );
      expect(harvestStatusOf(0.3, [], scene, '2026-09-08')).toBe(
        'not_harvested',
      );
    });
  });

  it('confidence is 0 at P=0.5 and 1 at the extremes', () => {
    expect(harvestConfidenceOf(0.5)).toBe(0);
    expect(harvestConfidenceOf(0)).toBe(1);
    expect(harvestConfidenceOf(1)).toBe(1);
    expect(harvestConfidenceOf(0.75)).toBeCloseTo(0.5, 10);
  });
});

describe('evaluateHarvest', () => {
  // Monotone dry-down window crossing the target
  const day = (date: string, dm: number) => ({
    date,
    median: dm,
    q5: dm - 0.01,
    q95: dm + 0.01,
  });
  const window = [
    day('2025-09-01', 0.29),
    day('2025-09-02', 0.31),
    day('2025-09-03', 0.33),
    day('2025-09-04', 0.35),
    day('2025-09-05', 0.37),
    day('2025-09-06', 0.39),
    day('2025-09-07', 0.41),
  ];

  it("returns today's probability when today is inside the window", () => {
    const evaluation = evaluateHarvest(window, '2025-09-03');
    expect(evaluation?.harvestProbability).toBeCloseTo(0.5, 2);
    expect(evaluation?.harvestStatus).toBe('possibly_harvested');
  });

  it('clamps to the first day before the window and the last day after it', () => {
    const before = evaluateHarvest(window, '2025-08-20');
    expect(before?.harvestProbability).toBe(probHarvested(0.29, 0.28, 0.3));
    const after = evaluateHarvest(window, '2025-09-20');
    expect(after?.harvestProbability).toBe(probHarvested(0.41, 0.4, 0.42));
    expect(after?.harvestStatus).toBe('possibly_harvested');
    expect(
      evaluateHarvest(window, '2025-09-20', {
        previousProbabilities: [0.99, 0.98],
      })?.harvestStatus,
    ).toBe('harvested');
  });

  it('a confirmed high-trust satellite detection overrides the model call', () => {
    const detection = {
      status: 'confirmed' as const,
      trust: 'high' as const,
      windowStart: '2025-08-28',
      windowEnd: '2025-08-30',
      confirmedAt: '2025-09-02',
    };
    const early = [day('2025-09-01', 0.2)];
    expect(evaluateHarvest(early, '2025-09-01', { detection })).toEqual({
      harvestProbability: 1,
      harvestStatus: 'harvested',
      confidence: 1,
    });
    // medium trust or unconfirmed: informational only
    expect(
      evaluateHarvest(early, '2025-09-01', {
        detection: { ...detection, trust: 'medium' },
      })?.harvestStatus,
    ).toBe('not_harvested');
    expect(
      evaluateHarvest(early, '2025-09-01', {
        detection: { ...detection, status: 'unconfirmed' },
      })?.harvestStatus,
    ).toBe('not_harvested');
  });

  it('stays not_harvested early in the season', () => {
    const early = [day('2025-08-01', 0.2), day('2025-08-02', 0.21)];
    const evaluation = evaluateHarvest(early, '2025-08-01');
    expect(evaluation?.harvestStatus).toBe('not_harvested');
  });

  it('returns null for an empty window', () => {
    expect(evaluateHarvest([], '2025-09-01')).toBeNull();
  });
});

describe('withHarvestEvaluation', () => {
  const day = (date: string, dm: number) => ({
    date,
    median: dm,
    q5: dm - 0.01,
    q95: dm + 0.01,
  });

  /** Assert the four fields are present and narrow them for numeric matchers. */
  const fieldsOf = (out: Partial<HarvestFields>): HarvestFields => {
    const { harvestProbability, harvestStatus, confidence, detectionDate } =
      out;
    if (harvestProbability === undefined || harvestStatus === undefined)
      throw new Error('harvest fields missing');
    if (confidence === undefined || detectionDate === undefined)
      throw new Error('harvest fields missing');
    return { harvestProbability, harvestStatus, confidence, detectionDate };
  };

  /** Single-day window, so the evaluated day is unambiguous. */
  const evaluateDm = (dm: number) =>
    fieldsOf(
      withHarvestEvaluation(
        { dailyPredictions: [day('2025-09-10', dm)] },
        '2025-09-10',
      ),
    );

  const dailyPredictions = [
    day('2025-09-01', 0.29),
    day('2025-09-02', 0.31),
    day('2025-09-03', 0.33),
    day('2025-09-04', 0.35),
    day('2025-09-05', 0.37),
    day('2025-09-06', 0.39),
    day('2025-09-07', 0.41),
  ];
  const response = { executionId: 'exec-1', dailyPredictions };

  it('adds all four harvest fields and preserves the rest of the response', () => {
    const out = withHarvestEvaluation(response, '2025-09-05');
    expect(out).toMatchObject({
      executionId: 'exec-1',
      dailyPredictions,
      harvestProbability: probHarvested(0.37, 0.36, 0.38),
      harvestStatus: 'possibly_harvested',
      detectionDate: '2025-09-05',
    });
    expect(out).toHaveProperty('confidence');
    expect(out).not.toHaveProperty('harvestDetected');
  });

  it('attaches the satellite detection and lets a confirmed high-trust one override', () => {
    const detection = {
      status: 'confirmed' as const,
      trust: 'high' as const,
      windowStart: '2025-08-28',
      windowEnd: '2025-08-30',
      confirmedAt: '2025-09-02',
    };
    const out = withHarvestEvaluation(response, '2025-09-01', { detection });
    expect(out).toMatchObject({
      harvestProbability: 1,
      harvestStatus: 'harvested',
      confidence: 1,
      harvestDetected: detection,
    });
    expect(out.dailyPredictions).toBe(dailyPredictions);
    const unconfirmed = withHarvestEvaluation(response, '2025-09-01', {
      detection: { ...detection, status: 'unconfirmed' },
    });
    expect(unconfirmed.harvestStatus).toBe('not_harvested');
    expect(unconfirmed.harvestDetected).toEqual({
      ...detection,
      status: 'unconfirmed',
    });
  });

  it('does not mutate the input response', () => {
    const input = { ...response };
    withHarvestEvaluation(input, '2025-09-05');
    expect(input).toEqual(response);
    expect(input).not.toHaveProperty('harvestStatus');
  });

  it('overrides a stale harvestProbability carried on the input', () => {
    // A cached run replays the upstream probability of the day it was created.
    const stale = { ...response, harvestProbability: 0.01 };
    const out = withHarvestEvaluation(stale, '2025-09-07');
    expect(out.harvestProbability).not.toBe(0.01);
    expect(out.harvestProbability).toBe(probHarvested(0.41, 0.4, 0.42));
  });

  it('keeps probability, status and confidence describing the same day', () => {
    const out = fieldsOf(
      withHarvestEvaluation(
        { ...response, harvestProbability: 0.99 },
        '2025-09-01',
      ),
    );
    expect(out.harvestProbability).toBe(probHarvested(0.29, 0.28, 0.3));
    expect(out.harvestStatus).toBe(harvestStatusOf(out.harvestProbability));
    expect(out.confidence).toBe(harvestConfidenceOf(out.harvestProbability));
    expect(out.detectionDate).toBe('2025-09-01');
  });

  it('buckets the status at the 0.5 and 0.9 boundaries', () => {
    // P(DM ≥ 0.33) == 0.5 exactly when the mean sits on the target.
    const onTarget = evaluateDm(0.33);
    expect(onTarget.harvestProbability).toBeCloseTo(0.5, 4);
    expect(onTarget.harvestStatus).toBe('possibly_harvested');
    expect(onTarget.confidence).toBeCloseTo(0, 3);

    const belowTarget = evaluateDm(0.32);
    expect(belowTarget.harvestProbability).toBeLessThan(0.5);
    expect(belowTarget.harvestStatus).toBe('not_harvested');

    // Bracket the 0.9 cutoff from both sides.
    const justUnder = evaluateDm(0.362);
    expect(justUnder.harvestProbability).toBeGreaterThan(0.5);
    expect(justUnder.harvestProbability).toBeLessThan(0.9);
    expect(justUnder.harvestStatus).toBe('possibly_harvested');

    const justOver = evaluateDm(0.375);
    expect(justOver.harvestProbability).toBeGreaterThanOrEqual(0.9);
    expect(justOver.harvestStatus).toBe('possibly_harvested');
    const persistent = fieldsOf(
      withHarvestEvaluation(
        { dailyPredictions: [day('2025-09-10', 0.375)] },
        '2025-09-10',
        {
          previousProbabilities: [0.95, 0.93],
        },
      ),
    );
    expect(persistent.harvestStatus).toBe('harvested');
  });

  it('sets confidence to |2P − 1|', () => {
    for (const dm of [0.2, 0.28, 0.33, 0.36, 0.45]) {
      const out = evaluateDm(dm);
      expect(out.confidence).toBeCloseTo(
        Math.abs(2 * out.harvestProbability - 1),
        4,
      );
    }
  });

  it('uses the passed today as detectionDate even outside the prediction window', () => {
    expect(withHarvestEvaluation(response, '2025-10-01').detectionDate).toBe(
      '2025-10-01',
    );
    expect(withHarvestEvaluation(response, '2025-01-01').detectionDate).toBe(
      '2025-01-01',
    );
  });

  it('returns the response unchanged when there are no daily predictions', () => {
    const empty = {
      executionId: 'exec-2',
      dailyPredictions: [],
      harvestProbability: 0.42,
    };
    const out = withHarvestEvaluation(empty, '2025-09-05');
    expect(out).toBe(empty);
    expect(out).toEqual({
      executionId: 'exec-2',
      dailyPredictions: [],
      harvestProbability: 0.42,
    });
  });
});

describe('dry-down correction (DMC_HARVEST_P_CORRECTION, on by default)', () => {
  const withCorrection = (fn: () => void) => {
    delete process.env.DMC_HARVEST_P_CORRECTION;
    try {
      fn();
    } finally {
      process.env.DMC_HARVEST_P_CORRECTION = 'off';
    }
  };

  it('maps the modelled DM through −5.96 + 1.20·DM before the CDF', () => {
    withCorrection(() => {
      // 0.33 modelled ≈ 0.3364 corrected → just above the target
      expect(probHarvested(0.33, 0.33, 0.33)).toBeGreaterThan(0.5);
      // 0.3247 modelled maps exactly onto the 0.33 target
      expect(probHarvested(0.3247, 0.3247, 0.3247)).toBeCloseTo(0.5, 2);
      // Below ~0.298 the correction lowers the probability (the fit crosses identity there)
      expect(probHarvested(0.25, 0.25, 0.25)).toBeLessThan(0.01);
    });
  });

  it('is monotone and leaves the published DM untouched (only the probability changes)', () => {
    withCorrection(() => {
      let prev = -1;
      for (const mean of [0.2, 0.25, 0.3, 0.33, 0.36, 0.4]) {
        const p = probHarvested(mean, mean - 0.02, mean + 0.02);
        expect(p).toBeGreaterThan(prev);
        prev = p;
      }
      const day = { date: '2026-09-08', median: 0.283, q5: 0.272, q95: 0.296 };
      const out = withHarvestEvaluation(
        { dailyPredictions: [day] },
        '2026-09-08',
      );
      expect(out.dailyPredictions[0]).toEqual(day);
    });
  });

  it('reproduces the 2026 back-test anchor: Volker 8 on 2026-09-08 (28.3 % modelled) stays below 0.5', () => {
    withCorrection(() => {
      const p = probHarvested(0.283, 0.272, 0.296);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(0.1);
    });
  });

  it('can be switched off', () => {
    process.env.DMC_HARVEST_P_CORRECTION = 'off';
    expect(probHarvested(0.33, 0.33, 0.33)).toBeCloseTo(0.5, 4);
  });
});
