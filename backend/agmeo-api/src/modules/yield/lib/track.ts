import type { YieldPoint } from "./types.js";

/**
 * Track-level cleaning of harvest-monitor points — the filters the public
 * reference recipe (USDA-ARS Yield Editor / its automated AYCE module) applies
 * and ours did not: flow delay, start/end-of-pass trim, velocity and
 * smooth-velocity, and swath overlap. GeoPard and PCT AgCloud sell exactly this
 * as "yield cleaning", and farmers know the terms, so every step reports what it
 * removed.
 *
 * Everything here needs points in DRIVE ORDER with timestamps. Where an export
 * carries no time column the steps skip themselves and say so — they never guess
 * an order, because a wrong order produces plausible-looking, wrong output,
 * which is worse than no filtering. That is also why the point caps upstream
 * sample systematically (every k-th) rather than at random.
 */

/** All thresholds in one place: they are part of the cleaning recipe's identity. */
export const YIELD_CLEANING_DEFAULTS = {
  /** Split passes when the heading changes by more than this [deg]. */
  passHeadingChangeDeg: 60,
  /** Split passes on a recording gap longer than this [s]. */
  passGapS: 10,
  /** AYCE defaults: the threshing chain filling and emptying. */
  startPassDelayS: 3,
  endPassDelayS: 5,
  /** Below this the machine is not harvesting steadily [m/s]. */
  minSpeedMs: 0.5,
  /** Above this it is road travel, not harvest [m/s]. */
  maxSpeedMs: 7,
  /** Flow is not in steady state while accelerating this hard [m/s²]. */
  maxAccelMs2: 0.5,
  /** Search window for the flow-delay estimate [s]. */
  maxLagS: 20,
  lagStepS: 0.5,
  /** Occupancy cell for the overlap bitmap [m]; coarsened for very large fields. */
  overlapCellM: 0.3,
  /** Drop a point when more than this share of its footprint was already cut. */
  overlapFraction: 0.5,
  /** Fallback width when a source carries no working width [m]. */
  assumedWidthM: 9,
} as const;

export type TrackCleaningStats = {
  /** Applied flow-delay shift [s] and where the value came from. */
  lagShiftS: number;
  lagSource: "declared" | "estimated" | "skipped";
  passes: number;
  passTrimRemoved: number;
  velocityRemoved: number;
  smoothVelocityRemoved: number;
  overlapRemoved: number;
  /** true when the source has no usable time base, so the track filters were skipped. */
  untimed: boolean;
};

const emptyTrackStats = (): TrackCleaningStats => ({
  lagShiftS: 0,
  lagSource: "skipped",
  passes: 0,
  passTrimRemoved: 0,
  velocityRemoved: 0,
  smoothVelocityRemoved: 0,
  overlapRemoved: 0,
  untimed: false,
});

/** A point with the derived per-sample motion the filters work on. */
export type TrackPoint = YieldPoint & {
  t: number;
  /** m/s, from consecutive positions unless the export carries a speed channel */
  speed: number;
  /** degrees, 0 = north */
  heading: number;
  /** distance to the previous point [m] */
  step: number;
  passIndex: number;
};

const EARTH_R = 6_371_008.8;
const DEG = Math.PI / 180;

/** Local metric offsets are enough at field scale and far cheaper than a projection. */
function metricDelta(a: YieldPoint, b: YieldPoint): { dx: number; dy: number } {
  const latMid = ((a.lat + b.lat) / 2) * DEG;
  return {
    dx: (b.lon - a.lon) * DEG * EARTH_R * Math.cos(latMid),
    dy: (b.lat - a.lat) * DEG * EARTH_R,
  };
}

const distanceM = (a: YieldPoint, b: YieldPoint): number => {
  const { dx, dy } = metricDelta(a, b);
  return Math.hypot(dx, dy);
};

const headingDeg = (a: YieldPoint, b: YieldPoint): number => {
  const { dx, dy } = metricDelta(a, b);
  return (Math.atan2(dx, dy) * (180 / Math.PI) + 360) % 360;
};

/** Smallest absolute difference between two headings [deg]. */
const headingDelta = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

/**
 * Sort by time, derive speed/heading/step, and split into passes.
 *
 * Grouped by ELEMENT (`section`), which a real John Deere export makes
 * mandatory rather than nice: it logs one record per header element per 0.2 s —
 * a forage export we checked carries ~95 elements of 0.153 m each, so ~475
 * records per second, all sharing a timestamp and spread laterally across the
 * swath. Treating those as one time-ordered stream gives dt = 0 between
 * neighbours (infinite or zero speed) and headings that point ACROSS the swath,
 * so pass detection, the velocity filter and the lag estimate would all be
 * computed on nonsense. Each element is a continuous lane; that is the track.
 *
 * Logged channels win over derived ones wherever the export provides them
 * (`Heading`, `VEHICLSPEED` in km/h, `DISTANCE` since the previous record).
 *
 * Returns null when fewer than two points carry a timestamp — the caller then
 * keeps the points untouched and reports `untimed`.
 */
export function buildTrack(
  points: YieldPoint[],
  options: Partial<typeof YIELD_CLEANING_DEFAULTS> = {},
): TrackPoint[] | null {
  const config = { ...YIELD_CLEANING_DEFAULTS, ...options };
  const timed = points.filter((p): p is YieldPoint & { t: number } => typeof p.t === "number");
  if (timed.length < 2 || timed.length < points.length * 0.5) return null;

  // One lane per element; sources without a section id are one lane.
  const lanes = new Map<number, (YieldPoint & { t: number })[]>();
  for (const point of timed) {
    const lane = point.section ?? -1;
    const list = lanes.get(lane);
    if (list) list.push(point);
    else lanes.set(lane, [point]);
  }

  const track: TrackPoint[] = [];
  let passIndex = 0;
  for (const lane of lanes.values()) {
    passIndex = buildLane(lane, config, track, passIndex + 1);
  }
  return track.toSorted((a, b) => a.t - b.t);
}

/** Track of ONE element/lane; returns the last pass index it used. */
function buildLane(
  points: (YieldPoint & { t: number })[],
  config: typeof YIELD_CLEANING_DEFAULTS,
  out: TrackPoint[],
  firstPassIndex: number,
): number {
  const sorted = points.toSorted((a, b) => a.t - b.t);
  const start = out.length;
  let passIndex = firstPassIndex;
  let previousHeading: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    const previous = i > 0 ? sorted[i - 1] : null;
    const dt = previous ? (point.t - previous.t) / 1000 : 0;
    // Logged distance beats a recomputed one: it is what the machine actually
    // travelled between records, GPS noise included.
    const rawStep = point.step ?? (previous ? distanceM(previous, point) : 0);
    const derivedHeading = previous && rawStep > 0.05 ? headingDeg(previous, point) : (previousHeading ?? 0);
    const heading: number = point.heading ?? derivedHeading;
    const turned: boolean =
      previousHeading !== null && headingDelta(previousHeading, heading) > config.passHeadingChangeDeg;
    const isBreak: boolean = previous !== null && (dt > config.passGapS || turned);
    if (isBreak) passIndex++;

    // The first sample of a pass is measured ACROSS the turn: its step, speed
    // and heading describe the headland manoeuvre, not the pass. Zeroing them
    // (and resetting the heading reference) keeps one serpentine leg from being
    // split twice — once at the turn, once at the first in-pass heading.
    const step = isBreak ? 0 : rawStep;
    // km/h in the logged column; m/s everywhere in this module.
    const speed = point.speed !== undefined ? point.speed / 3.6 : !isBreak && dt > 0 ? rawStep / dt : 0;
    previousHeading = isBreak ? null : rawStep > 0.05 ? heading : previousHeading;

    out.push({
      ...point,
      t: point.t,
      speed,
      heading: isBreak ? (previousHeading ?? heading) : heading,
      step,
      passIndex,
    });
  }

  // Headings of pass-start samples are meaningless above; adopt the next
  // in-pass heading so the overlap footprint points along the pass.
  for (let i = start; i < out.length; i++) {
    if (out[i].step === 0 && i + 1 < out.length && out[i + 1].passIndex === out[i].passIndex) {
      out[i].heading = out[i + 1].heading;
    }
  }
  return passIndex;
}

export const passesOf = (track: TrackPoint[]): TrackPoint[][] => {
  const passes: TrackPoint[][] = [];
  for (const point of track) {
    const pass = passes[point.passIndex] ?? (passes[point.passIndex] = []);
    pass.push(point);
  }
  return passes.filter(Boolean);
};

/**
 * Estimate the flow delay by shifting the value series against the track and
 * keeping the shift that makes neighbouring passes agree best — the sensor lags
 * the header by the threshing chain's transit time, so an uncorrected map smears
 * yield along the driving direction and disagrees across adjacent passes.
 *
 * Implemented as AYCE does it in spirit: a coarse grid search minimising the
 * squared difference between a point and the spatially nearest point of ANOTHER
 * pass. Cheap because it only samples the candidate set.
 */
export function estimateLagSeconds(
  track: TrackPoint[],
  options: Partial<typeof YIELD_CLEANING_DEFAULTS> = {},
): number | null {
  const config = { ...YIELD_CLEANING_DEFAULTS, ...options };
  const passes = passesOf(track);
  if (passes.length < 2) return null;

  // Sample pairs of nearby points from different passes once; the lag search
  // then only re-reads their values.
  const pairs: { a: TrackPoint; b: TrackPoint }[] = [];
  const sampleStep = Math.max(1, Math.floor(track.length / 400));
  for (let i = 0; i < track.length; i += sampleStep) {
    const point = track[i];
    let best: TrackPoint | null = null;
    let bestDistance = Infinity;
    for (let j = 0; j < track.length; j += sampleStep) {
      const other = track[j];
      if (other.passIndex === point.passIndex) continue;
      const distance = distanceM(point, other);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    if (best && bestDistance < 15) pairs.push({ a: point, b: best });
  }
  if (pairs.length < 20) return null;

  const byTime = new Map<number, TrackPoint[]>();
  for (const point of track) {
    const pass = byTime.get(point.passIndex) ?? [];
    pass.push(point);
    byTime.set(point.passIndex, pass);
  }

  /** Value that BELONGS at `point` if the sensor lags by `lag` seconds. */
  const shiftedValue = (point: TrackPoint, lag: number): number | null => {
    const pass = byTime.get(point.passIndex);
    if (!pass) return null;
    const target = point.t + lag * 1000;
    let best: TrackPoint | null = null;
    let bestDiff = Infinity;
    for (const candidate of pass) {
      const diff = Math.abs(candidate.t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
    return best && bestDiff <= 2000 ? best.value : null;
  };

  let bestLag = 0;
  let bestError = Infinity;
  for (let lag = 0; lag <= config.maxLagS; lag += config.lagStepS) {
    let error = 0;
    let count = 0;
    for (const { a, b } of pairs) {
      const valueA = shiftedValue(a, lag);
      const valueB = shiftedValue(b, lag);
      if (valueA === null || valueB === null) continue;
      error += (valueA - valueB) ** 2;
      count++;
    }
    if (count < 20) continue;
    const mean = error / count;
    if (mean < bestError) {
      bestError = mean;
      bestLag = lag;
    }
  }
  return bestError === Infinity ? null : bestLag;
}

/** Move each point's value back along its own pass by `lagS` seconds. */
export function applyLagShift(track: TrackPoint[], lagS: number): void {
  if (lagS <= 0) return;
  const passes = passesOf(track);
  for (const pass of passes) {
    const values = pass.map((p) => p.value);
    for (let i = 0; i < pass.length; i++) {
      const target = pass[i].t + lagS * 1000;
      // Passes are time-ordered, so a forward scan finds the sample the sensor
      // reported for this position.
      let j = i;
      while (j + 1 < pass.length && pass[j + 1].t <= target) j++;
      pass[i].value = values[j];
    }
  }
}

/** Drop the first/last seconds of every pass: the chain filling and emptying. */
export function trimPassEnds(
  track: TrackPoint[],
  options: Partial<typeof YIELD_CLEANING_DEFAULTS> = {},
): { kept: TrackPoint[]; removed: number } {
  const config = { ...YIELD_CLEANING_DEFAULTS, ...options };
  const kept: TrackPoint[] = [];
  let removed = 0;
  for (const pass of passesOf(track)) {
    const start = pass[0].t + config.startPassDelayS * 1000;
    const end = pass[pass.length - 1].t - config.endPassDelayS * 1000;
    // A pass shorter than the two delays together would vanish entirely; keep
    // it rather than delete a short but real pass (point rows, field corners).
    if (end <= start) {
      kept.push(...pass);
      continue;
    }
    for (const point of pass) {
      if (point.t >= start && point.t <= end) kept.push(point);
      else removed++;
    }
  }
  return { kept, removed };
}

/**
 * Velocity filters: standing still or road speed means the flow reading does not
 * belong to the ground under the machine, and hard acceleration means the flow
 * is not in steady state.
 */
export function filterVelocity(
  track: TrackPoint[],
  options: Partial<typeof YIELD_CLEANING_DEFAULTS> = {},
): { kept: TrackPoint[]; velocityRemoved: number; smoothVelocityRemoved: number } {
  const config = { ...YIELD_CLEANING_DEFAULTS, ...options };
  const kept: TrackPoint[] = [];
  let velocityRemoved = 0;
  let smoothVelocityRemoved = 0;

  for (const pass of passesOf(track)) {
    for (let i = 0; i < pass.length; i++) {
      const point = pass[i];
      // The first point of a pass has no derived speed yet.
      if (i > 0 && (point.speed < config.minSpeedMs || point.speed > config.maxSpeedMs)) {
        velocityRemoved++;
        continue;
      }
      if (i > 1) {
        const dt = (point.t - pass[i - 1].t) / 1000;
        const accel = dt > 0 ? Math.abs(point.speed - pass[i - 1].speed) / dt : 0;
        if (accel > config.maxAccelMs2) {
          smoothVelocityRemoved++;
          continue;
        }
      }
      kept.push(point);
    }
  }
  return { kept, velocityRemoved, smoothVelocityRemoved };
}

export type OverlapInput = {
  /** Points of every source, already cleaned per source. */
  points: TrackPoint[];
  sourceId: string;
};

/**
 * Remove double-cut ground, chronologically and ACROSS sources.
 *
 * Grain is harvested once. Where two combines' swaths overlap at a seam or at
 * the finish, the machine that arrived second measured near-zero flow over
 * ground that was already bare — a fake low-yield stripe. Our own reference case
 * has three combines working one field simultaneously, so this is the normal
 * case, not a corner case; running it per source would leave exactly those
 * artifacts in place.
 *
 * Method is AYCE's bitmap: walk the points of all sources in travel-time order,
 * mark each footprint into an occupancy raster, and drop a point when most of
 * its footprint was already cut.
 */
export function removeOverlap(
  sources: OverlapInput[],
  options: Partial<typeof YIELD_CLEANING_DEFAULTS> = {},
): { kept: Map<string, TrackPoint[]>; removed: number; cellM: number } {
  const config = { ...YIELD_CLEANING_DEFAULTS, ...options };
  const all = sources.flatMap((source) => source.points.map((point) => ({ point, sourceId: source.sourceId })));
  const kept = new Map<string, TrackPoint[]>(sources.map((source) => [source.sourceId, []]));
  if (all.length === 0) return { kept, removed: 0, cellM: config.overlapCellM };

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const { point } of all) {
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
  }
  const latMid = ((minLat + maxLat) / 2) * DEG;
  const widthM = (maxLon - minLon) * DEG * EARTH_R * Math.cos(latMid);
  const heightM = (maxLat - minLat) * DEG * EARTH_R;

  // The cell must be finer than one header element, or two neighbouring
  // elements share a cell and a few centimetres of GPS jitter makes one look
  // like the other's overlap. A John Deere forage export logs elements of
  // 0.153 m, well below the 0.3 m the published recipe assumes.
  const widths = all.map(({ point }) => point.width ?? 0).filter((width) => width > 0);
  const medianWidth = widths.length > 0 ? widths.toSorted((a, b) => a - b)[Math.floor(widths.length / 2)] : 0;
  let cellM = medianWidth > 0 ? Math.min(config.overlapCellM, Math.max(0.05, medianWidth / 2)) : config.overlapCellM;
  // Then coarsen on very large fields so the bitmap stays bounded.
  while ((widthM / cellM) * (heightM / cellM) > 60e6) cellM *= 2;
  const cols = Math.max(1, Math.ceil(widthM / cellM) + 2);
  const rows = Math.max(1, Math.ceil(heightM / cellM) + 2);
  const occupancy = new Uint8Array(cols * rows);

  const cellOf = (lon: number, lat: number): { col: number; row: number } => ({
    col: Math.floor(((lon - minLon) * DEG * EARTH_R * Math.cos(latMid)) / cellM),
    row: Math.floor(((lat - minLat) * DEG * EARTH_R) / cellM),
  });

  /**
   * Cells the point harvested: its element width ACROSS the heading, and the
   * ground it covered SINCE the previous record along it. Marking the trailing
   * segment rather than a box centred on the point is what lets consecutive
   * records of one lane tile without shadowing each other.
   */
  const footprint = (point: TrackPoint): number[] => {
    const width = point.width && point.width > 0 ? point.width : config.assumedWidthM;
    const along = Math.max(cellM / 2, point.step || cellM / 2);
    const rad = point.heading * DEG;
    const acrossLon = Math.cos(rad) / (EARTH_R * DEG * Math.cos(latMid));
    const acrossLat = -Math.sin(rad) / (EARTH_R * DEG);
    const alongLon = Math.sin(rad) / (EARTH_R * DEG * Math.cos(latMid));
    const alongLat = Math.cos(rad) / (EARTH_R * DEG);

    const cells: number[] = [];
    const acrossSteps = Math.max(1, Math.ceil(width / cellM));
    const alongSteps = Math.max(1, Math.ceil(along / cellM));
    for (let a = 0; a < acrossSteps; a++) {
      const acrossOffset = -width / 2 + (width * (a + 0.5)) / acrossSteps;
      for (let b = 0; b < alongSteps; b++) {
        // (-along, 0]: the ground behind the point, which is what it just cut.
        const alongOffset = -along + (along * (b + 0.5)) / alongSteps;
        const { col, row } = cellOf(
          point.lon + acrossOffset * acrossLon + alongOffset * alongLon,
          point.lat + acrossOffset * acrossLat + alongOffset * alongLat,
        );
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        cells.push(row * cols + col);
      }
    }
    return cells;
  };

  all.sort((a, b) => a.point.t - b.point.t);
  let removed = 0;

  // A SWEEP is everything logged at the same instant by the same source: the
  // header's elements side by side. They cover different ground by
  // construction, so they must be judged against the bitmap as it was BEFORE
  // the sweep and only then marked — otherwise the first element makes its own
  // neighbours look like overlap and half the swath is thrown away.
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j < all.length && all[j].point.t === all[i].point.t && all[j].sourceId === all[i].sourceId) j++;

    const sweep: { cells: number[]; sourceId: string; point: TrackPoint }[] = [];
    for (let k = i; k < j; k++) {
      const { point, sourceId } = all[k];
      const cells = footprint(point);
      const occupied = cells.reduce((count, index) => count + occupancy[index], 0);
      if (cells.length > 0 && occupied / cells.length > config.overlapFraction) {
        removed++;
        continue;
      }
      sweep.push({ cells, sourceId, point });
    }
    for (const entry of sweep) {
      for (const index of entry.cells) occupancy[index] = 1;
      kept.get(entry.sourceId)?.push(entry.point);
    }
    i = j;
  }

  return { kept, removed, cellM };
}

/**
 * Per-source track cleaning: build the track, correct the flow delay, trim pass
 * ends, apply the velocity filters. Overlap removal is deliberately NOT here —
 * it has to see every source of the harvest event at once.
 *
 * `declaredLagS` comes from formats that state it (GreenStar RCD declares
 * `vrLatency`, 14 s on the reference machine); `lagCorrectionApplies = false`
 * for sources a provider already corrected — John Deere's Operations Center
 * export among them, on the current evidence — so we never shift twice.
 */
export function cleanTrack(
  points: YieldPoint[],
  opts: {
    declaredLagS?: number | null;
    lagCorrectionApplies?: boolean;
    options?: Partial<typeof YIELD_CLEANING_DEFAULTS>;
  } = {},
): { points: YieldPoint[]; track: TrackPoint[] | null; stats: TrackCleaningStats } {
  const stats = emptyTrackStats();
  const track = buildTrack(points, opts.options);
  if (!track) {
    stats.untimed = true;
    return { points, track: null, stats };
  }

  if (opts.lagCorrectionApplies !== false) {
    const declared = opts.declaredLagS ?? null;
    const lag = declared ?? estimateLagSeconds(track, opts.options);
    if (lag !== null && lag > 0) {
      applyLagShift(track, lag);
      stats.lagShiftS = lag;
      stats.lagSource = declared !== null ? "declared" : "estimated";
    }
  }

  const trimmed = trimPassEnds(track, opts.options);
  stats.passTrimRemoved = trimmed.removed;

  const velocity = filterVelocity(trimmed.kept, opts.options);
  stats.velocityRemoved = velocity.velocityRemoved;
  stats.smoothVelocityRemoved = velocity.smoothVelocityRemoved;
  stats.passes = new Set(track.map((p) => p.passIndex)).size;

  // A filter chain that empties the map means the thresholds do not fit this
  // machine — report and keep the input rather than return nothing.
  if (velocity.kept.length < points.length * 0.1) {
    return { points, track, stats: { ...emptyTrackStats(), passes: stats.passes } };
  }
  return { points: velocity.kept, track: velocity.kept, stats };
}
