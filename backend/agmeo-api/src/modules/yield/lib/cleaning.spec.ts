import { correctSectionCalibration, correctSetCalibration, removeEdgePoints } from "./cleaning.js";
import type { YieldPoint } from "./parse.js";

function pts(n: number, value: number, section: number): YieldPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lon: 10 + (i % 30) * 0.0001,
    lat: 52 + Math.floor(i / 30) * 0.0001,
    value,
    section,
  }));
}

describe("correctSectionCalibration", () => {
  it("rescales deviating sections to the global mean", () => {
    // global mean = (200×10 + 100×8) / 300 = 9.333…
    const points = [...pts(200, 10, 495), ...pts(100, 8, 925)];
    const { corrections, skipped } = correctSectionCalibration(points);
    expect(corrections).toEqual([
      { section: 495, factor: 0.933 },
      { section: 925, factor: 1.167 },
    ]);
    expect(skipped).toBe(false);
    expect(points[0].value).toBeCloseTo(9.333, 2);
    expect(points[250].value).toBeCloseTo(9.333, 2);
  });

  it("leaves agreeing sections and single-section sets untouched", () => {
    const agreeing = [...pts(200, 10, 495), ...pts(100, 9.8, 925)];
    expect(correctSectionCalibration(agreeing)).toEqual({ corrections: [], skipped: false });
    expect(correctSectionCalibration(pts(200, 10, 495))).toEqual({ corrections: [], skipped: false });
  });

  it("skips fragmented-SECTIONID sets instead of smoothing them", () => {
    // 25 sections that all diverge from the global mean — a machine logging
    // fragment ids, not a calibration problem (observed: 178 on one cut)
    const points = Array.from({ length: 25 }, (_, s) => pts(60, s % 2 === 0 ? 6 : 12, s)).flat();
    const before = points.map((p) => p.value);
    const { corrections, skipped } = correctSectionCalibration(points);
    expect(skipped).toBe(true);
    expect(corrections).toEqual([]);
    expect(points.map((p) => p.value)).toEqual(before); // nothing rescaled
  });
});

describe("removeEdgePoints", () => {
  it("drops boundary points and keeps the interior", () => {
    // 50x50 grid @ ~7m spacing → ~350m square; 15m buffer removes ~2 outer rings
    const points: YieldPoint[] = [];
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        points.push({ lon: 10 + x * 0.0001, lat: 52 + y * 0.000063, value: 8 });
      }
    }
    const { points: kept, removed } = removeEdgePoints(points);
    expect(removed).toBeGreaterThan(150);
    expect(kept.length + removed).toBe(2500);
    // corners gone, center stays
    expect(kept.some((p) => p.lon === 10 && p.lat === 52)).toBe(false);
    expect(kept.some((p) => Math.abs(p.lon - 10.0025) < 1e-9)).toBe(true);
  });

  it("keeps small sets unchanged", () => {
    const { removed } = removeEdgePoints([{ lon: 10, lat: 52, value: 5 }]);
    expect(removed).toBe(0);
  });

  // The reference compared its hand-rolled hull + inward test against turf's convex hull and
  // negative buffer. Without turf, the reference here is an independent brute force: a gift-
  // wrapping hull in local metres and each point's distance to the nearest hull SEGMENT (for a
  // point inside a convex polygon that equals the distance to its boundary).
  it.each([
    ["irregular blob", (i: number) => ({ r: 0.004 + 0.002 * Math.sin(i * 2.3), a: i * 0.017 })],
    ["long thin strip", (i: number) => ({ r: 0.006 + 0.0005 * Math.sin(i), a: (i % 2) * Math.PI + i * 1e-4 })],
    ["circle with flat side", (i: number) => ({ r: 0.005, a: Math.min(i * 0.01, Math.PI) })],
  ])("selects the same points as an independent hull and buffer — %s", (_name, shape) => {
    const points: YieldPoint[] = [];
    for (let i = 0; i < 1200; i++) {
      const { r, a } = shape(i);
      const inward = 0.3 + 0.7 * Math.abs(Math.sin(i * 12.9898));
      points.push({ lon: 10 + r * inward * Math.cos(a), lat: 52 + r * inward * Math.sin(a), value: 8 });
    }

    const lat0 = 52;
    const kx = (Math.PI / 180) * 6_371_008.8 * Math.cos((lat0 * Math.PI) / 180);
    const ky = (Math.PI / 180) * 6_371_008.8;
    const xy = points.map((p) => [(p.lon - 10) * kx, (p.lat - lat0) * ky] as const);
    // Gift wrapping.
    let start = 0;
    for (let i = 1; i < xy.length; i++) if (xy[i][0] < xy[start][0] || (xy[i][0] === xy[start][0] && xy[i][1] < xy[start][1])) start = i;
    const hull: number[] = [];
    let current = start;
    do {
      hull.push(current);
      let next = (current + 1) % xy.length;
      for (let i = 0; i < xy.length; i++) {
        const cross = (xy[next][0] - xy[current][0]) * (xy[i][1] - xy[current][1]) - (xy[next][1] - xy[current][1]) * (xy[i][0] - xy[current][0]);
        if (cross < 0) next = i;
      }
      current = next;
    } while (current !== start && hull.length <= xy.length);
    const segDistance = ([px, py]: readonly [number, number], [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]) => {
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
      return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
    };
    const inside = points.filter((_, i) => hull.every((h, k) => segDistance(xy[i], xy[h], xy[hull[(k + 1) % hull.length]]) >= 15 - 1e-6));
    const expected = inside.length < points.length * 0.3 ? points : inside;

    const { points: kept } = removeEdgePoints(points);
    // The local projections differ by the hull's own reference latitude; allow a handful of
    // points within centimetres of the 15 m line to fall either way.
    expect(Math.abs(kept.length - expected.length)).toBeLessThanOrEqual(Math.max(2, expected.length * 0.01));
    expect(kept.length).toBeGreaterThan(0);
  });
});

describe("correctSetCalibration", () => {
  const set = (n: number, value: number): YieldPoint[] =>
    Array.from({ length: n }, (_, i) => ({ lon: 10 + i * 0.0001, lat: 52, value }));

  it("rescales deviating sets to the pooled mean", () => {
    // pooled mean = (200×10 + 100×8) / 300 = 9.333…
    const a = set(200, 10);
    const b = set(100, 8);
    const { corrections } = correctSetCalibration([a, b]);
    expect(corrections).toEqual([
      { set: 0, factor: 0.933 },
      { set: 1, factor: 1.167 },
    ]);
    expect(a[0].value).toBeCloseTo(9.333, 2);
    expect(b[0].value).toBeCloseTo(9.333, 2);
  });

  it("leaves agreeing sets and single sets untouched", () => {
    const agreeing = [set(200, 10), set(100, 9.8)];
    expect(correctSetCalibration(agreeing)).toEqual({ corrections: [] });
    expect(agreeing[0][0].value).toBe(10);
    expect(correctSetCalibration([set(200, 10)])).toEqual({ corrections: [] });
  });

  it("ignores sets below the minimum point count", () => {
    const big = set(200, 10);
    const tiny = set(10, 3);
    const { corrections } = correctSetCalibration([big, tiny]);
    expect(corrections).toEqual([]);
    expect(tiny[0].value).toBe(3);
  });
});
