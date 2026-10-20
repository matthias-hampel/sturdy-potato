import type { YieldPoint } from "./parse.js";
import {
  applyLagShift,
  buildTrack,
  cleanTrack,
  estimateLagSeconds,
  filterVelocity,
  passesOf,
  removeOverlap,
  trimPassEnds,
  YIELD_CLEANING_DEFAULTS,
} from "./track.js";

const START = Date.parse("2026-08-02T12:00:00Z");
/** ~1 m in latitude at this scale, so distances in the fixtures are easy to reason about. */
const M_LAT = 1 / 110_540;
const M_LON = 1 / (111_320 * Math.cos(53.55 * (Math.PI / 180)));

type Sample = { x: number; y: number; value: number; second: number };

const toPoints = (samples: Sample[], width = 9): YieldPoint[] =>
  samples.map(({ x, y, value, second }) => ({
    lon: 12.99 + x * M_LON,
    lat: 53.55 + y * M_LAT,
    value,
    t: START + second * 1000,
    width,
  }));

/** One straight pass: `length` metres north at 1 m/s, 1 Hz. */
function pass(xOffset: number, length: number, value: number | ((step: number) => number), startSecond = 0): Sample[] {
  return Array.from({ length }, (_, step) => ({
    x: xOffset,
    y: step,
    value: typeof value === "function" ? value(step) : value,
    second: startSecond + step,
  }));
}

describe("buildTrack", () => {
  it("derives speed and splits passes on the turn", () => {
    const up = pass(0, 30, 8);
    const down = pass(9, 30, 8, 40).map((s) => ({ ...s, y: 30 - s.y }));
    const track = buildTrack(toPoints([...up, ...down]));

    expect(track).not.toBeNull();
    expect(passesOf(track!)).toHaveLength(2);
    // 1 m per second between consecutive samples.
    expect(track![5].speed).toBeCloseTo(1, 1);
  });

  it("returns null when the export carries no usable time base", () => {
    const untimed: YieldPoint[] = [
      { lon: 12.99, lat: 53.55, value: 8 },
      { lon: 12.9901, lat: 53.5501, value: 8 },
    ];
    expect(buildTrack(untimed)).toBeNull();
  });
});

describe("flow delay", () => {
  it("recovers an injected lag to within half a second", () => {
    // The lag is only observable across passes driven in OPPOSITE directions —
    // which is how a field is actually harvested. In space the yield steps up at
    // y = 20; the sensor reports it LAG seconds late, so on the northbound pass
    // the step appears LAG metres too far north and on the southbound pass LAG
    // metres too far south. Only shifting by the true lag makes them agree.
    const LAG = 6;
    const LENGTH = 40;
    const groundTruth = (y: number) => (y < 20 ? 6 : 12);

    const north: Sample[] = Array.from({ length: LENGTH }, (_, step) => ({
      x: 0,
      y: step,
      value: groundTruth(step - LAG),
      second: step,
    }));
    const south: Sample[] = Array.from({ length: LENGTH }, (_, step) => {
      const y = LENGTH - 1 - step;
      return { x: 4, y, value: groundTruth(y + LAG), second: 60 + step };
    });

    const track = buildTrack(toPoints([...north, ...south]))!;
    const estimate = estimateLagSeconds(track);

    expect(estimate).not.toBeNull();
    expect(estimate!).toBeGreaterThanOrEqual(LAG - 0.5);
    expect(estimate!).toBeLessThanOrEqual(LAG + 0.5);
  });

  it("shifts values back along the pass without reordering points", () => {
    const track = buildTrack(toPoints(pass(0, 10, (step) => step)))!;
    applyLagShift(track, 3);

    // The value measured 3 s later belongs here.
    expect(track[0].value).toBe(3);
    expect(track[5].value).toBe(8);
    // The tail cannot look further ahead than the pass goes.
    expect(track[9].value).toBe(9);
  });

  it("estimates nothing from a single pass", () => {
    expect(estimateLagSeconds(buildTrack(toPoints(pass(0, 40, 8)))!)).toBeNull();
  });
});

describe("trimPassEnds", () => {
  it("drops the chain filling and emptying at both ends of every pass", () => {
    const track = buildTrack(toPoints([...pass(0, 30, 8), ...pass(9, 30, 8, 60)]))!;
    const { kept, removed } = trimPassEnds(track);

    const perPass = YIELD_CLEANING_DEFAULTS.startPassDelayS + YIELD_CLEANING_DEFAULTS.endPassDelayS;
    expect(removed).toBe(2 * perPass);
    expect(kept).toHaveLength(60 - 2 * perPass);
  });

  it("keeps a pass that is shorter than the two delays instead of deleting it", () => {
    const track = buildTrack(toPoints(pass(0, 5, 8)))!;
    const { kept, removed } = trimPassEnds(track);
    expect(removed).toBe(0);
    expect(kept).toHaveLength(5);
  });
});

describe("filterVelocity", () => {
  it("drops standing still and road speed", () => {
    const samples: Sample[] = [
      ...pass(0, 10, 8),
      // stopped: same position for 5 s
      ...Array.from({ length: 5 }, (_, i) => ({ x: 0, y: 9, value: 8, second: 10 + i })),
      // then 12 m/s away, which is road travel
      ...Array.from({ length: 5 }, (_, i) => ({ x: 0, y: 9 + 12 * (i + 1), value: 8, second: 15 + i })),
    ];
    const track = buildTrack(toPoints(samples))!;
    const { kept, velocityRemoved } = filterVelocity(track);

    expect(velocityRemoved).toBeGreaterThan(0);
    expect(kept.every((p) => p.speed === 0 || (p.speed >= 0.5 && p.speed <= 7))).toBe(true);
  });

  it("drops samples taken while accelerating hard", () => {
    // 1 m/s for 10 s, then a 3 m/s jump: the flow is not in steady state.
    const samples: Sample[] = [...pass(0, 10, 8), { x: 0, y: 13, value: 8, second: 10 }];
    const track = buildTrack(toPoints(samples))!;
    const { smoothVelocityRemoved } = filterVelocity(track);
    expect(smoothVelocityRemoved).toBe(1);
  });
});

describe("removeOverlap", () => {
  it("drops the SECOND machine over ground that was already cut", () => {
    // Two machines drive the same line; the second arrives a minute later and
    // would record a fake low stripe over bare ground.
    const first = toPoints(pass(0, 30, 9), 3);
    const second = toPoints(pass(0, 30, 1, 120), 3);

    const { kept, removed } = removeOverlap([
      { sourceId: "first", points: buildTrack(first)! },
      { sourceId: "second", points: buildTrack(second)! },
    ]);

    expect(removed).toBeGreaterThan(20);
    expect(kept.get("first")!.length).toBe(30);
    expect(kept.get("second")!.length).toBeLessThan(10);
  });

  it("keeps adjacent swaths that only touch at the seam", () => {
    const left = toPoints(pass(0, 30, 8), 3);
    const right = toPoints(pass(4, 30, 8, 120), 3);

    const { kept, removed } = removeOverlap([
      { sourceId: "left", points: buildTrack(left)! },
      { sourceId: "right", points: buildTrack(right)! },
    ]);

    expect(removed).toBe(0);
    expect(kept.get("right")!.length).toBe(30);
  });

  it("respects the declared working width", () => {
    // 3 m apart is overlap for a 9 m header, not for a 2 m one.
    const wide = removeOverlap([
      { sourceId: "a", points: buildTrack(toPoints(pass(0, 30, 8), 9))! },
      { sourceId: "b", points: buildTrack(toPoints(pass(3, 30, 8, 120), 9))! },
    ]);
    const narrow = removeOverlap([
      { sourceId: "a", points: buildTrack(toPoints(pass(0, 30, 8), 2))! },
      { sourceId: "b", points: buildTrack(toPoints(pass(3, 30, 8, 120), 2))! },
    ]);

    expect(wide.removed).toBeGreaterThan(narrow.removed);
  });
});

describe("cleanTrack", () => {
  it("reports the whole chain and keeps the map usable", () => {
    const points = toPoints([...pass(0, 40, 8), ...pass(9, 40, 8, 60)]);
    const { points: cleaned, stats } = cleanTrack(points);

    expect(stats.untimed).toBe(false);
    expect(stats.passes).toBe(2);
    expect(stats.passTrimRemoved).toBeGreaterThan(0);
    expect(cleaned.length).toBeGreaterThan(points.length * 0.5);
  });

  it("leaves an untimed source completely alone", () => {
    const untimed: YieldPoint[] = Array.from({ length: 50 }, (_, i) => ({
      lon: 12.99 + i * M_LON,
      lat: 53.55,
      value: 8,
    }));
    const { points, stats } = cleanTrack(untimed);

    expect(stats.untimed).toBe(true);
    expect(points).toHaveLength(50);
  });

  it("skips the lag correction for sources a provider already corrected", () => {
    const recorded = (step: number) => (step - 6 < 20 ? 6 : 12);
    const points = toPoints([...pass(0, 40, recorded), ...pass(9, 40, recorded, 60)]);

    const { stats } = cleanTrack(points, { lagCorrectionApplies: false });
    expect(stats.lagSource).toBe("skipped");
    expect(stats.lagShiftS).toBe(0);
  });

  it("prefers a declared latency over the estimate", () => {
    const points = toPoints([...pass(0, 40, 8), ...pass(9, 40, 8, 60)]);
    const { stats } = cleanTrack(points, { declaredLagS: 14 });

    expect(stats.lagSource).toBe("declared");
    expect(stats.lagShiftS).toBe(14);
  });
});

describe("section-per-record exports (the John Deere shape)", () => {
  /**
   * A real JD forage export logs one record per header ELEMENT per 0.2 s — the
   * one we checked carries ~95 elements of 0.153 m, so ~475 records a second,
   * all sharing a timestamp and spread laterally across the swath. Before the
   * track was grouped by element, those neighbours had dt = 0 and headings
   * pointing across the swath, so speeds and passes were computed on nonsense.
   */
  const SECTIONS = 8;
  const SECTION_WIDTH = 0.153;

  function sectionedPass(seconds: number, startSecond = 0): YieldPoint[] {
    const points: YieldPoint[] = [];
    for (let step = 0; step < seconds; step++) {
      for (let section = 0; section < SECTIONS; section++) {
        points.push({
          // 1 m/s north; elements sit side by side across the swath
          lon: 12.99 + section * SECTION_WIDTH * M_LON,
          lat: 53.55 + step * M_LAT,
          value: 8,
          t: START + (startSecond + step) * 1000,
          section,
          width: SECTION_WIDTH,
        });
      }
    }
    return points;
  }

  it("gives each element its own lane instead of jumping across the swath", () => {
    const track = buildTrack(sectionedPass(30))!;

    expect(track).toHaveLength(30 * SECTIONS);
    expect(passesOf(track)).toHaveLength(SECTIONS);
    // Every sample keeps a plausible harvesting speed; before the fix the
    // same-timestamp neighbours produced 0 or absurd values.
    const speeds = track.filter((point) => point.step > 0).map((point) => point.speed);
    expect(Math.max(...speeds)).toBeLessThan(3);
    expect(Math.min(...speeds)).toBeGreaterThan(0.3);
  });

  it("keeps the whole swath — parallel elements are not each other's overlap", () => {
    const { kept, removed } = removeOverlap([{ sourceId: "one", points: buildTrack(sectionedPass(30))! }]);

    expect(removed).toBe(0);
    expect(kept.get("one")!).toHaveLength(30 * SECTIONS);
  });

  it("still drops a second drive over the same ground", () => {
    // Same field, same elements, twenty minutes later: an obstacle detour or a
    // finishing pass, where the header takes almost nothing.
    const first = buildTrack(sectionedPass(30))!;
    const second = buildTrack(sectionedPass(30, 1200))!;

    const { kept, removed } = removeOverlap([
      { sourceId: "first", points: first },
      { sourceId: "second", points: second },
    ]);

    expect(removed).toBeGreaterThan(0);
    expect(kept.get("first")!.length).toBe(first.length);
    expect(kept.get("second")!.length).toBeLessThan(second.length);
  });

  it("prefers the logged speed and heading over derived ones", () => {
    const points: YieldPoint[] = [
      { lon: 12.99, lat: 53.55, value: 8, t: START, section: 1, speed: 18, heading: 270 },
      { lon: 12.99, lat: 53.55 + M_LAT, value: 8, t: START + 1000, section: 1, speed: 18, heading: 270 },
    ];
    const track = buildTrack(points)!;

    // 18 km/h = 5 m/s, not the ~1 m/s the positions imply.
    expect(track[1].speed).toBeCloseTo(5, 1);
    expect(track[1].heading).toBe(270);
  });
});
