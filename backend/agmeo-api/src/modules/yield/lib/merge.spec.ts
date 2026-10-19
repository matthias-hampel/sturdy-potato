import type { GridDefinition } from "./grid.js";

import {
  accumulateYieldPoints,
  calibrateToTotal,
  coverageRatio,
  crossSourceCalibration,
  dedupeByFingerprint,
  detectDuplicateSources,
  EVENT_CLUSTER_DAYS,
  type FingerprintedSource,
  gridSignature,
  groupSourcesIntoEvents,
  mergeSourceGrids,
  pixelJaccard,
  rateOf,
  type SourceAccumulation,
} from "./merge.js";

const GRID: GridDefinition = { epsg: 32632, originX: 0, originY: 1000, resolution: 10, width: 20, height: 20 };
const PIXELS = GRID.width * GRID.height;

const PIXEL_AREA_M2 = GRID.resolution * GRID.resolution;
/** 1 t/ha over 1 m² is 0.1 kg. */
const T_HA_TO_KG_M2 = 0.1;

/**
 * Accumulation covering [fromCol, toCol) of every row at a constant rate, with
 * each pixel fully harvested — the shape a real pass leaves behind.
 */
function stripe(
  sourceId: string,
  fromCol: number,
  toCol: number,
  value: number,
  opts: { samples?: number; coverage?: number } = {},
): SourceAccumulation {
  const samples = opts.samples ?? 4;
  const coverage = opts.coverage ?? 1;
  const mass = new Float64Array(PIXELS);
  const area = new Float64Array(PIXELS);
  const counts = new Int32Array(PIXELS);
  for (let row = 0; row < GRID.height; row++) {
    for (let col = fromCol; col < toCol; col++) {
      const index = row * GRID.width + col;
      area[index] = PIXEL_AREA_M2 * coverage;
      mass[index] = value * area[index] * T_HA_TO_KG_M2;
      counts[index] = samples;
    }
  }
  return { sourceId, mass, area, counts, pointCount: (toCol - fromCol) * GRID.height * samples };
}

describe("groupSourcesIntoEvents", () => {
  const product = "HARVESTING__GRLND_GRASSLAND__FOOD";

  it("keeps three combines of one afternoon in a single event", () => {
    const events = groupSourcesIntoEvents([
      { id: "a", productArticleId: product, harvestedFrom: "2026-08-02T12:10:00Z" },
      { id: "b", productArticleId: product, harvestedFrom: "2026-08-02T12:30:00Z" },
      { id: "c", productArticleId: product, harvestedFrom: "2026-08-02T11:57:00Z" },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].sources.map((s) => s.id).toSorted()).toEqual(["a", "b", "c"]);
  });

  it("splits grassland cuts apart instead of averaging them", () => {
    // The dominant real case: >21 days between operations on the same cultivation.
    const events = groupSourcesIntoEvents([
      { id: "cut1", productArticleId: product, harvestedFrom: "2026-05-20T00:00:00Z" },
      { id: "cut2", productArticleId: product, harvestedFrom: "2026-06-25T00:00:00Z" },
      { id: "cut3", productArticleId: product, harvestedFrom: "2026-08-10T00:00:00Z" },
    ]);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sources[0].id)).toEqual(["cut1", "cut2", "cut3"]);
    expect(new Set(events.map((e) => e.key)).size).toBe(3);
  });

  it("clusters across the boundary day but not beyond it", () => {
    const within = groupSourcesIntoEvents([
      { id: "a", productArticleId: product, harvestedFrom: "2026-08-02T00:00:00Z" },
      { id: "b", productArticleId: product, harvestedFrom: `2026-08-0${2 + EVENT_CLUSTER_DAYS}T00:00:00Z` },
    ]);
    expect(within).toHaveLength(1);

    const beyond = groupSourcesIntoEvents([
      { id: "a", productArticleId: product, harvestedFrom: "2026-08-02T00:00:00Z" },
      { id: "b", productArticleId: product, harvestedFrom: `2026-08-0${3 + EVENT_CLUSTER_DAYS}T00:00:00Z` },
    ]);
    expect(beyond).toHaveLength(2);
  });

  it("never mixes two products, however close the dates", () => {
    const events = groupSourcesIntoEvents([
      { id: "grain", productArticleId: "HARVESTING__TRZAX_WINTER_WHEAT", harvestedFrom: "2026-08-02T00:00:00Z" },
      { id: "straw", productArticleId: "HARVESTING__STRAW", harvestedFrom: "2026-08-02T06:00:00Z" },
    ]);
    expect(events).toHaveLength(2);
  });

  it("isolates sources without a date rather than guessing a cut", () => {
    const events = groupSourcesIntoEvents([
      { id: "dated", productArticleId: product, harvestedFrom: "2026-08-02T00:00:00Z" },
      { id: "undated", productArticleId: product, harvestedFrom: null },
    ]);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.from === null)?.sources[0].id).toBe("undated");
  });

  it("gives the same event a stable key", () => {
    const args = [{ id: "a", productArticleId: product, harvestedFrom: "2026-08-02T12:10:00Z" }];
    expect(groupSourcesIntoEvents(args)[0].key).toBe(groupSourcesIntoEvents(args)[0].key);
  });
});

describe("gridSignature", () => {
  it("changes with the grid, so a cached accumulation is never reused on another one", () => {
    expect(gridSignature(GRID)).toBe(gridSignature({ ...GRID }));
    expect(gridSignature({ ...GRID, resolution: 20 })).not.toBe(gridSignature(GRID));
    expect(gridSignature({ ...GRID, originX: 10 })).not.toBe(gridSignature(GRID));
  });
});

const project = (lon: number, lat: number): [number, number] => [lon, lat];

describe("accumulateYieldPoints", () => {
  it("accumulates harvested mass and the ground it came from", () => {
    // 10 t/ha over 4 m² is 4 kg; 20 t/ha over 1 m² is 2 kg.
    const { mass, area, counts, pointsUsed } = accumulateYieldPoints(
      [
        { lon: 5, lat: 995, value: 10, width: 2, step: 2 },
        { lon: 5, lat: 995, value: 20, width: 1, step: 1 },
        { lon: 5000, lat: 995, value: 99, width: 2, step: 2 },
      ],
      GRID,
      project,
    );

    expect(pointsUsed).toBe(2);
    expect(mass[0]).toBeCloseTo(4 + 2, 6);
    expect(area[0]).toBe(5);
    expect(counts[0]).toBe(2);
    // The pixel's rate is mass over ground, not the mean of 10 and 20.
    expect(rateOf(mass[0], area[0])).toBeCloseTo(12, 6);
  });

  it("weights a sample by the ground it covered, not by existing at all", () => {
    // A machine crawling logs many samples over little ground; at full speed it
    // logs few over much. A mean of rates lets the crawl decide the pixel.
    const crawling = Array.from({ length: 20 }, () => ({ lon: 5, lat: 995, value: 4, width: 3, step: 0.05 }));
    const running = Array.from({ length: 2 }, () => ({ lon: 5, lat: 995, value: 10, width: 3, step: 0.5 }));

    const { mass, area } = accumulateYieldPoints([...crawling, ...running], GRID, project);
    const meanOfRates = (20 * 4 + 2 * 10) / 22;

    expect(meanOfRates).toBeCloseTo(4.5, 1);
    // Ground-weighted: 3 m² at 4 t/ha and 3 m² at 10 t/ha.
    expect(rateOf(mass[0], area[0])).toBeCloseTo(7, 6);
  });

  it("falls back to equal weighting when the export cannot say how much ground a record covered", () => {
    const { mass, area, areaKnownShare } = accumulateYieldPoints(
      [
        { lon: 5, lat: 995, value: 10 },
        { lon: 5, lat: 995, value: 20 },
      ],
      GRID,
      project,
    );

    expect(areaKnownShare).toBe(0);
    // Reduces exactly to the old mean of rates, so nothing regresses.
    expect(rateOf(mass[0], area[0])).toBeCloseTo(15, 6);
  });
});

describe("coverageRatio", () => {
  it("reports partial, full and double coverage", () => {
    const partial = stripe("a", 0, 1, 8, { coverage: 0.4 });
    const full = stripe("b", 1, 2, 8, { coverage: 1 });
    const doubled = stripe("c", 2, 3, 8, { coverage: 2 });

    expect(coverageRatio(partial.area, GRID)[0]).toBeCloseTo(0.4, 6);
    expect(coverageRatio(full.area, GRID)[1]).toBeCloseTo(1, 6);
    expect(coverageRatio(doubled.area, GRID)[2]).toBeCloseTo(2, 6);
  });
});

describe("detectDuplicateSources", () => {
  it("drops the same harvest delivered twice, keeping the denser copy", () => {
    const jd = { ...stripe("jd", 0, 10, 8), provider: "johndeere", pointCount: 5000 };
    const upload = { ...stripe("upload", 0, 10, 8), provider: "upload", pointCount: 4000 };

    const dropped = detectDuplicateSources([jd, upload]);
    expect([...dropped.keys()]).toEqual(["upload"]);
  });

  it("keeps two combines that split the field", () => {
    const left = stripe("left", 0, 10, 8);
    const right = stripe("right", 10, 20, 8);
    expect(pixelJaccard(left.counts, right.counts)).toBe(0);
    expect(detectDuplicateSources([left, right]).size).toBe(0);
  });

  it("keeps sources that cover the same ground at genuinely different levels", () => {
    // Same footprint but 8 vs 12 t/ha is a calibration problem, not a duplicate:
    // dropping one would hide the disagreement instead of correcting it.
    const dropped = detectDuplicateSources([stripe("a", 0, 10, 8), stripe("b", 0, 10, 12)]);
    expect(dropped.size).toBe(0);
  });

  // On an exact point-count tie the provider decides. "agco" was missing from
  // PROVIDER_PRIORITY, so indexOf returned -1 and it beat John Deere.
  it("prefers John Deere over AGCO on an exact point-count tie", () => {
    const jd = { ...stripe("jd", 0, 10, 8), provider: "johndeere", pointCount: 4000 };
    const agco = { ...stripe("agco", 0, 10, 8), provider: "agco", pointCount: 4000 };

    expect([...detectDuplicateSources([jd, agco]).keys()]).toEqual(["agco"]);
    // Order of the pair must not change the winner.
    expect([...detectDuplicateSources([agco, jd]).keys()]).toEqual(["agco"]);
  });

  // A provider nobody has added yet must lose the tie, not win it.
  it("ranks an unknown provider last", () => {
    const jd = { ...stripe("jd", 0, 10, 8), provider: "johndeere", pointCount: 4000 };
    const mystery = { ...stripe("mystery", 0, 10, 8), provider: "brand-new-oem", pointCount: 4000 };

    expect([...detectDuplicateSources([jd, mystery]).keys()]).toEqual(["mystery"]);
    expect([...detectDuplicateSources([mystery, jd]).keys()]).toEqual(["mystery"]);
  });
});

describe("crossSourceCalibration", () => {
  it("rescales a miscalibrated machine using the ground both drove", () => {
    // Overlap on columns 6..11 (120 pixels, above MIN_SHARED_PIXELS);
    // A reads 10 there, B reads 8.
    const a = stripe("a", 0, 12, 10);
    const b = stripe("b", 6, 20, 8);

    const { factors, skipped } = crossSourceCalibration([a, b]);
    expect(skipped).toBe(false);
    // Reference is the mean of both on shared ground = 9.
    expect(factors.get("a")).toBeCloseTo(0.9, 3);
    expect(factors.get("b")).toBeCloseTo(1.125, 3);
  });

  it("does nothing when the machines already agree", () => {
    const { factors } = crossSourceCalibration([stripe("a", 0, 12, 9), stripe("b", 6, 20, 9)]);
    expect(factors.size).toBe(0);
  });

  it("does nothing when the sources barely overlap", () => {
    const { factors, sharedPixels } = crossSourceCalibration([stripe("a", 0, 10, 10), stripe("b", 10, 20, 8)]);
    expect(sharedPixels).toBe(0);
    expect(factors.size).toBe(0);
  });

  it("reports skipped instead of rescaling when the levels are incompatible", () => {
    // 8 vs 80 t/ha on shared ground is a wrong unit or a different crop.
    const { factors, skipped } = crossSourceCalibration([stripe("a", 0, 20, 8), stripe("b", 0, 20, 80)]);
    expect(skipped).toBe(true);
    expect(factors.size).toBe(0);
  });
});

describe("mergeSourceGrids", () => {
  it("merges adjacent swaths into one raster", () => {
    const merged = mergeSourceGrids([stripe("left", 0, 10, 8), stripe("right", 10, 20, 9)]);

    expect(merged.coveredPixels).toBe(PIXELS);
    expect(merged.raster[0]).toBeCloseTo(8, 6);
    expect(merged.raster[15]).toBeCloseTo(9, 6);
    expect(merged.pixelMean).toBeCloseTo(8.5, 6);
  });

  it("weights by harvested ground, so a fast logger cannot take over", () => {
    // Same ground, wildly different logging rates: the merged value must be the
    // mass-weighted mean, i.e. exactly halfway, and NOT pulled toward the
    // chattier machine. This is what made the old sample-count cap unnecessary.
    const sparse = { ...stripe("sparse", 0, 20, 10, { samples: 1 }) };
    const dense = { ...stripe("dense", 0, 20, 20, { samples: 1000 }) };

    const merged = mergeSourceGrids([sparse, dense]);
    expect(merged.raster[0]).toBeCloseTo(15, 6);
  });

  it("conserves mass: the field total is the sum of the pixels", () => {
    const left = stripe("left", 0, 10, 8);
    const right = stripe("right", 10, 20, 12);

    const merged = mergeSourceGrids([left, right], new Map(), undefined, GRID);
    const hectares = (PIXELS * PIXEL_AREA_M2) / 10_000;

    expect(merged.harvestedHa).toBeCloseTo(hectares, 6);
    // Half the field at 8 t/ha and half at 12 gives 10 t/ha over the whole.
    expect(merged.pixelMean).toBeCloseTo(10, 6);
    expect(merged.totalT).toBeCloseTo(10 * hectares, 6);
    // And the per-source split adds up to it.
    const bySource = merged.contributions.reduce((sum, c) => sum + c.massT, 0);
    expect(bySource).toBeCloseTo(merged.totalT, 6);
  });

  it("flags pixels whose accumulated ground exceeds the pixel itself", () => {
    // Undetected double pass: same ground counted twice.
    const merged = mergeSourceGrids([stripe("a", 0, 5, 9), stripe("b", 0, 5, 9)], new Map(), undefined, GRID);

    expect(merged.overCoveredPixels).toBe(5 * GRID.height);
    // The rate stays honest even so — mass and ground both doubled.
    expect(merged.raster[0]).toBeCloseTo(9, 6);
  });

  it("ignores excluded sources but still reports them", () => {
    const merged = mergeSourceGrids(
      [stripe("keep", 0, 10, 8), stripe("drop", 10, 20, 30)],
      new Map([["drop", "user"]]),
    );

    expect(merged.coveredPixels).toBe(PIXELS / 2);
    expect(merged.contributions.find((c) => c.sourceId === "drop")?.excluded).toBe("user");
    expect(merged.contributions.find((c) => c.sourceId === "drop")?.pixels).toBe(0);
  });

  it("counts overlap pixels per source", () => {
    const merged = mergeSourceGrids([stripe("a", 0, 12, 9), stripe("b", 6, 20, 9)]);
    expect(merged.contributions.find((c) => c.sourceId === "a")?.overlapPixels).toBe(6 * GRID.height);
  });
});

describe("calibrateToTotal", () => {
  it("scales the map onto a weighbridge total", () => {
    const merged = mergeSourceGrids([stripe("a", 0, 20, 8)], new Map(), undefined, GRID);
    const target = 9 * merged.harvestedHa;

    const { factor, applied } = calibrateToTotal(merged, target);
    expect(applied).toBe(true);
    expect(factor).toBeCloseTo(9 / 8, 6);
    expect(merged.pixelMean).toBeCloseTo(9, 6);
    // Mass conservation makes this exact rather than approximate.
    expect(merged.totalT).toBeCloseTo(target, 6);
  });

  it("reports but does not apply a factor that means the tonnage is for other area", () => {
    const merged = mergeSourceGrids([stripe("a", 0, 20, 8)], new Map(), undefined, GRID);

    const { factor, applied } = calibrateToTotal(merged, 40 * merged.harvestedHa);
    expect(applied).toBe(false);
    expect(factor).toBeCloseTo(5, 6);
    expect(merged.pixelMean).toBeCloseTo(8, 6);
  });
});

describe("dedupeByFingerprint", () => {
  const source = (id: string, overrides: Partial<FingerprintedSource> = {}): FingerprintedSource => ({
    id,
    fingerprint: "f1",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  });

  it("keeps the older copy", () => {
    const dropped = dedupeByFingerprint([
      source("new", { createdAt: "2026-08-02T10:00:00.000Z" }),
      source("old", { createdAt: "2026-08-01T10:00:00.000Z" }),
    ]);
    expect([...dropped]).toEqual([["new", "old"]]);
  });

  it("does not depend on the order the rows came back in", () => {
    const sources = [source("a", { createdAt: "2026-08-03T10:00:00.000Z" }), source("b"), source("c")];
    expect([...dedupeByFingerprint(sources)]).toEqual([...dedupeByFingerprint(sources.toReversed())]);
  });

  it("never drops a source that has not been parsed yet", () => {
    // Two nulls are not a match: neither has data to be identical to.
    const dropped = dedupeByFingerprint([source("a", { fingerprint: null }), source("b", { fingerprint: null })]);
    expect(dropped.size).toBe(0);
  });

  it("leaves two different harvests alone", () => {
    expect(dedupeByFingerprint([source("a"), source("b", { fingerprint: "f2" })]).size).toBe(0);
  });

  it("drops every extra copy of a group, not just one", () => {
    const dropped = dedupeByFingerprint([
      source("a", { createdAt: "2026-08-02T10:00:00.000Z" }),
      source("b"),
      source("c", { createdAt: "2026-08-03T10:00:00.000Z" }),
    ]);
    expect(dropped.size).toBe(2);
    expect(dropped.get("a")).toBe("b");
    expect(dropped.get("c")).toBe("b");
  });
});
