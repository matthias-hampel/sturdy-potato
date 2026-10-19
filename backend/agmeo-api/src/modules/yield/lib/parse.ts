import { extractAftYieldPoints, isAftText, isAftZip } from './aft.js';
import type { CleaningStats } from './cleaning.js';
import { correctSectionCalibration, removeEdgePoints } from './cleaning.js';
import { looksLikeLonLat, resolveCrs, toLonLat, UnsupportedCrsError, type ResolvedCrs } from './crs.js';
import { type GridDefinition, GridError, pixelIndex, projector, round } from './grid.js';
import { extractIsoxmlYieldPoints, isIsoxmlZip } from './isoxml.js';
import type { PointDataSourceMeta } from './pointdata.js';
import { extractGeojsonYieldPoints, isPointDataZip, POINTDATA_GEOJSON_MEMBER } from './pointdata.js';
import { dbfEncoding, readDbfHeader, readPointShapefile, type ShapeRecord } from './shapefile.js';
import type { ParsedYieldPoints, YieldPoint } from './types.js';
import { openZip, type ZipEntries } from './zip.js';

export type { ParsedYieldPoints, YieldPoint } from './types.js';

/**
 * Mass-per-area yield attributes on harvest-monitor point exports, in order of preference.
 * VRYIELDMAS is John Deere's "Yield as Mass" (t/ha); WetMass is the uncorrected fallback.
 * Matching is case-insensitive.
 */
const MASS_PER_AREA_ATTRIBUTES = ['VRYIELDMAS', 'DRYMASS', 'WETMASS', 'ERTRAG'];

/** Column names of the flow-channel telemetry format (flow, width and speed logged as separate rows). */
const FLOW_ATTRIBUTES = ['YIELD', 'F_YIELD'];
const WIDTH_ATTRIBUTES = ['WORKING_WI', 'WORKINGWIDTH', 'SWATHWIDTH'];
const SPEED_ATTRIBUTES = ['DRIVING_SP', 'F_VELOCITY', 'VEHICLSPEED'];
const MOISTURE_ATTRIBUTES = ['MOISTURE', 'F_MOISTURE', 'GRAIN_MOIS'];
const DRY_MATTER_ATTRIBUTES = ['DRYMATTER'];
const SECTION_ATTRIBUTES = ['SECTIONID', 'SECTION'];
/** ISOTIME first: John Deere ships both, and its "Time" column is a localized string. */
const TIME_ATTRIBUTES = ['ISOTIME', 'TIMESTAMP', 'F_TIMESTAM', 'TIME'];
const HEADING_ATTRIBUTES = ['HEADING', 'F_HEADING'];
/** Distance travelled since the previous record [m] — the along-track footprint. */
const DISTANCE_ATTRIBUTES = ['DISTANCE'];

/**
 * What we can actually read, quoted back at the user when a zip holds none of it. The
 * remaining vendor terminal logs (John Deere .jdl, GreenStar .fdd) stay unsupported.
 */
export const ACCEPTED_CONTENT_HINT =
  "Accepted: a point shapefile (.shp + .dbf) with a yield column, a flow-channel shapefile (flow + working width + speed), an ISOXML TASKDATA.XML export, an AGRO-MAP .aft export (bare or zipped), or a points.geojson telemetry artefact. Other raw terminal logs (.jdl, .fdd) cannot be read — export the harvest from the manufacturer's portal instead.";

/** Percentile clip against harvest-monitor spikes (sensor artifacts, turn rows). */
const CLIP_LOW = 0.01;
const CLIP_HIGH = 0.99;

/**
 * Yield rates outside this window (t/ha) mark the map as implausible — wrong column, unit or
 * calibration. Fallback when the caller cannot name the crop.
 */
const PLAUSIBLE_RATE_T_HA: [number, number] = [1.5, 120];

/**
 * Crop-specific plausibility windows for the map MEAN (t/ha), matched as case-insensitive
 * substrings against the crop name or code. More specific entries come first.
 */
const CROP_WINDOWS_T_HA: [keywords: string[], window: [number, number]][] = [
  [['GRASS_SEED', 'GRASSAMEN', 'GRASS SEED'], [0.5, 2.5]],
  [['CORN_SILAGE', 'SILOMAIS', 'SILAGE'], [20, 70]],
  [['CORN', 'MAIZE', 'MAIS'], [6, 15]],
  [['BARLEY', 'GERSTE'], [3, 12]],
  [['WHEAT', 'WEIZEN', 'TRITICALE'], [4, 12]],
  [['RAPE', 'RAPS', 'CANOLA'], [2, 5.5]],
  [['RYE', 'ROGGEN', 'OAT', 'HAFER'], [3, 11]],
  [['GRASSLAND', 'GRÜNLAND', 'GRUENLAND', 'GRAS', 'CLOVER', 'KLEE', 'LUZERNE', 'ALFALFA'], [1.5, 15]],
];

/** Per-point cap: 2× the crop window's maximum. */
const PER_POINT_CAP_FACTOR = 2;

/** The mean-plausibility window for a crop name — generic fallback when unknown. */
export function resolveCropWindow(crop?: string): [number, number] {
  if (!crop) return PLAUSIBLE_RATE_T_HA;
  const needle = crop.toUpperCase();
  for (const [keywords, window] of CROP_WINDOWS_T_HA) {
    if (keywords.some((k) => needle.includes(k))) return window;
  }
  return PLAUSIBLE_RATE_T_HA;
}

/** Forward-filled width/speed go stale after this many seconds without a fresh channel row. */
const CHANNEL_MAX_AGE_S = 30;

/** Cap on retained points PER export set (uniform reservoir sample beyond it). */
const MAX_POINTS_PER_SET = 2_000_000;

/** Largest zip member read into memory. The reference streams; agmeo caps (see report). */
const MAX_MEMBER_BYTES = 1_500 * 1024 * 1024;

type RawExtract = {
  points: YieldPoint[];
  totalFeatures: number;
  format: ParsedYieldPoints['format'];
  attribute: string;
  moistureAttribute?: string | null;
  basis: 'wet' | 'dry';
  sampled?: boolean;
  prjWkt?: string | null;
  crs?: Pick<ResolvedCrs, 'epsg' | 'source'>;
};

export type ParseOptions = {
  /** Crop name or code, for the plausibility window. */
  crop?: string;
  /** lon/lat of the field, to choose a UTM zone for projected exports without a .prj. */
  near?: [number, number] | null;
};

const ASSUMED_4326 = { epsg: 'EPSG:4326', source: 'assumed4326' as const };

/**
 * Parse a harvest-monitor export into cleaned yield points. Formats are auto-detected:
 *
 * - mass_per_area — each point carries a yield-per-area column (John Deere and compatible)
 * - flow_channels — flow, working width, speed and moisture logged as separate rows; merged
 *   along the timeline, rate = flow [kg/s] / (width [m] × speed [km/h]) → t/ha
 * - isoxml — an ISO 11783 TaskData zip: TLG time logs, yield by DDI 84/181, moisture DDI 99
 * - aft — AGRO-MAP .aft (bare or zipped)
 * - pointdata — a points.geojson telemetry artefact
 *
 * Cleaning in all cases: section calibration and edge removal per export set, non-positive
 * values dropped, 1st/99th percentile clipped, crop-window per-point cap; the mean rate is
 * checked against the (crop) plausibility window and reported in `quality`.
 *
 * Deviation from the reference: it forks a worker process and streams shapefile members to
 * survive 11 GB John Deere farm exports in a Next.js server; here the parse already runs in
 * the jobs worker and members are read whole, capped at MAX_MEMBER_BYTES.
 */
export async function parseYieldPoints(buffer: Buffer, opts: ParseOptions | string = {}): Promise<ParsedYieldPoints> {
  const { crop, near } = typeof opts === 'string' ? { crop: opts, near: null } : opts;

  // Bare .aft text upload — the only accepted non-zip payload; AGRO-MAP writes latin1.
  if (isAftText(buffer)) return finalizeAftTexts([buffer.toString('latin1')], crop);

  let zip: ZipEntries;
  try {
    zip = await openZip(buffer);
  } catch {
    throw new GridError(`Not a readable .zip archive. ${ACCEPTED_CONTENT_HINT}`, 400);
  }

  try {
    if (isIsoxmlZip(zip.names)) {
      const isoxml = await extractIsoxmlYieldPoints(zip);
      const extracts: RawExtract[] = [
        {
          points: isoxml.points,
          totalFeatures: isoxml.totalRecords,
          format: 'isoxml',
          attribute: isoxml.attribute,
          moistureAttribute: isoxml.moistureAttribute,
          basis: isoxml.basis,
          sampled: isoxml.sampled,
          crs: ASSUMED_4326,
        },
      ];
      return finalize(extracts, 0, crop, cleanExtracts(extracts));
    }

    if (isPointDataZip(zip.names)) {
      const memberName = zip.names.find((n) => /(^|\/)points\.geojson$/i.test(n))!;
      const metaName = zip.names.find((n) => /(^|\/)source\.json$/i.test(n));
      const raw = (await zip.read(memberName)).toString('utf8');
      let meta: PointDataSourceMeta = {};
      if (metaName) {
        try {
          meta = JSON.parse((await zip.read(metaName)).toString('utf8')) as PointDataSourceMeta;
        } catch {
          // A broken sidecar costs provenance labels, never the points.
        }
      }
      const geojson = extractGeojsonYieldPoints(raw, meta.attribute ?? 'Telemetry point data');
      const extracts: RawExtract[] = [
        {
          points: geojson.points,
          totalFeatures: geojson.totalFeatures,
          format: 'pointdata',
          attribute: geojson.attribute,
          moistureAttribute: geojson.moistureAttribute,
          basis: meta.basis ?? 'wet',
          crs: ASSUMED_4326,
        },
      ];
      return finalize(extracts, 0, crop, cleanExtracts(extracts));
    }

    if (isAftZip(zip.names)) {
      const texts: string[] = [];
      for (const name of zip.names.filter((n) => /\.aft$/i.test(n) && !n.includes('__MACOSX'))) texts.push((await zip.read(name)).toString('latin1'));
      return finalizeAftTexts(texts, crop);
    }

    const shpNames = zip.names.filter((n) => n.toLowerCase().endsWith('.shp') && !n.includes('__MACOSX'));
    if (shpNames.length === 0) {
      throw new GridError(`Zip contains no .shp file, TASKDATA.XML, .aft or ${POINTDATA_GEOJSON_MEMBER}. ${ACCEPTED_CONTENT_HINT}`, 400);
    }

    // Farm exports bundle one shapefile set per field — parse every set and merge; the field
    // grid downstream acts as the spatial filter.
    const extracts: RawExtract[] = [];
    let firstError: GridError | null = null;
    for (const shpName of shpNames) {
      try {
        extracts.push(await extractShapefileSet(zip, shpName));
      } catch (error) {
        if (!(error instanceof GridError)) throw error;
        firstError = firstError ?? error;
      }
    }
    if (extracts.length === 0) throw firstError ?? new GridError('No parsable shapefile set in zip', 400);

    // Coordinates must be lon/lat BEFORE cleaning: edge removal works in metres.
    for (const extract of extracts) reprojectExtractTo4326(extract, near);
    return finalize(extracts, shpNames.length - extracts.length, crop, cleanExtracts(extracts));
  } finally {
    zip.close();
  }
}

function finalizeAftTexts(texts: string[], crop?: string): ParsedYieldPoints {
  const aft = extractAftYieldPoints(texts);
  const extracts: RawExtract[] = [
    {
      points: aft.points,
      totalFeatures: aft.totalRecords,
      format: 'aft',
      attribute: aft.attribute,
      moistureAttribute: aft.moistureAttribute,
      // AGROMAP monitors log fresh mass as harvested.
      basis: 'wet',
      crs: ASSUMED_4326,
    },
  ];
  return finalize(extracts, 0, crop, cleanExtracts(extracts));
}

/** Section calibration + edge removal PER export set, never across a merged farm zip. */
function cleanExtracts(extracts: RawExtract[]): CleaningStats {
  const cleaning: CleaningStats = { edgeRemoved: 0, sectionsCorrected: [] };
  for (const extract of extracts) {
    const calibration = correctSectionCalibration(extract.points);
    cleaning.sectionsCorrected.push(...calibration.corrections);
    if (calibration.skipped) cleaning.sectionCorrectionSkipped = (cleaning.sectionCorrectionSkipped ?? 0) + 1;
    const edged = removeEdgePoints(extract.points);
    cleaning.edgeRemoved += edged.removed;
    extract.points = edged.points;
  }
  return cleaning;
}

const CRS_SAMPLE_SIZE = 32;
/** After transforming, this share of the points has to be inside lon/lat bounds. */
const LON_LAT_MIN_SHARE = 0.99;

/** Bring a set's points to WGS84 lon/lat in place; unsupported or implausible: 422. */
function reprojectExtractTo4326(extract: RawExtract, near?: [number, number] | null): void {
  const step = Math.max(1, Math.floor(extract.points.length / CRS_SAMPLE_SIZE));
  const sample: [number, number][] = [];
  for (let i = 0; i < extract.points.length && sample.length < CRS_SAMPLE_SIZE; i += step) sample.push([extract.points[i].lon, extract.points[i].lat]);

  let crs: ResolvedCrs;
  try {
    crs = resolveCrs(extract.prjWkt ?? null, sample, near);
  } catch (error) {
    if (error instanceof UnsupportedCrsError) throw new GridError(error.message, 422);
    throw error;
  }
  extract.crs = crs;

  const transform = toLonLat(crs.def);
  if (transform) {
    for (const point of extract.points) {
      const [lon, lat] = transform(point.lon, point.lat);
      point.lon = lon;
      point.lat = lat;
    }
  }

  const outside = extract.points.filter((p) => !Number.isFinite(p.lon) || !Number.isFinite(p.lat) || !looksLikeLonLat([[p.lon, p.lat]])).length;
  if (outside > extract.points.length * (1 - LON_LAT_MIN_SHARE)) {
    const [lon, lat] = [extract.points[0]?.lon, extract.points[0]?.lat];
    throw new GridError(
      `Coordinates are not usable as WGS84 after reprojection from ${crs.epsg ?? crs.source} (first point ${lon}, ${lat}) — the export's .prj may be wrong`,
      422,
    );
  }
}

function findSidecar(zip: ZipEntries, shpName: string, extension: string): string | undefined {
  const target = shpName.toLowerCase().replace(/\.shp$/, extension);
  return zip.names.find((n) => n.toLowerCase() === target);
}

async function readMember(zip: ZipEntries, name: string): Promise<Buffer> {
  const data = await zip.read(name);
  if (data.length > MAX_MEMBER_BYTES) throw new GridError(`Yield map too large to parse (${name})`, 413);
  return data;
}

async function readSidecar(zip: ZipEntries, name: string | undefined): Promise<string | null> {
  if (!name) return null;
  return (await zip.read(name)).toString('utf8').trim() || null;
}

async function extractShapefileSet(zip: ZipEntries, shpName: string): Promise<RawExtract> {
  const dbfName = findSidecar(zip, shpName, '.dbf');
  if (!dbfName) throw new GridError(`No .dbf sidecar for ${shpName} — yield attributes unavailable`, 400);
  const [prjWkt, cpg] = await Promise.all([readSidecar(zip, findSidecar(zip, shpName, '.prj')), readSidecar(zip, findSidecar(zip, shpName, '.cpg'))]);
  const [shp, dbf] = await Promise.all([readMember(zip, shpName), readMember(zip, dbfName)]);
  const encoding = dbfEncoding(cpg);
  const columns = readDbfHeader(dbf, encoding).fields.map((f) => f.name);
  const features = readPointShapefile(shp, dbf, encoding);

  const massColumn = findColumn(columns, MASS_PER_AREA_ATTRIBUTES);
  if (massColumn) return { ...parseMassPerArea(features, massColumn, columns), prjWkt };

  const flowColumn = findColumn(columns, FLOW_ATTRIBUTES);
  const widthColumn = findColumn(columns, WIDTH_ATTRIBUTES);
  const speedColumn = findColumn(columns, SPEED_ATTRIBUTES);
  if (flowColumn && widthColumn && speedColumn) return { ...parseFlowChannels(features, { flowColumn, widthColumn, speedColumn, columns }), prjWkt };

  throw new GridError(
    `No yield data in ${shpName} — expected a mass-per-area column (${MASS_PER_AREA_ATTRIBUTES.join(', ')}) or flow channels (${FLOW_ATTRIBUTES.join('/')} + width + speed)`,
    400,
  );
}

function parseMassPerArea(features: Iterable<ShapeRecord>, column: string, columns: string[]): RawExtract {
  const moistureColumn = findColumn(columns, MOISTURE_ATTRIBUTES);
  const dryMatterColumn = findColumn(columns, DRY_MATTER_ATTRIBUTES);
  const sectionColumn = findColumn(columns, SECTION_ATTRIBUTES);
  const timeColumn = findColumn(columns, TIME_ATTRIBUTES);
  const widthColumn = findColumn(columns, WIDTH_ATTRIBUTES);
  const headingColumn = findColumn(columns, HEADING_ATTRIBUTES);
  const speedColumn = findColumn(columns, SPEED_ATTRIBUTES);
  const distanceColumn = findColumn(columns, DISTANCE_ATTRIBUTES);

  const raw: YieldPoint[] = [];
  let totalFeatures = 0;
  let positives = 0;
  for (const feature of features) {
    totalFeatures++;
    const value = Number(feature.properties[column]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const section = sectionColumn ? Number(feature.properties[sectionColumn]) : NaN;
    const point: YieldPoint = {
      lon: feature.x,
      lat: feature.y,
      value,
      moisture: readMoisture(feature.properties, moistureColumn, dryMatterColumn),
      section: Number.isFinite(section) ? section : undefined,
      t: readTime(timeColumn ? feature.properties[timeColumn] : undefined),
      width: readPositive(widthColumn ? feature.properties[widthColumn] : undefined),
      heading: readFinite(headingColumn ? feature.properties[headingColumn] : undefined),
      // km/h in every export we have seen.
      speed: readPositive(speedColumn ? feature.properties[speedColumn] : undefined),
      step: readPositive(distanceColumn ? feature.properties[distanceColumn] : undefined),
    };
    positives++;
    if (raw.length < MAX_POINTS_PER_SET) raw.push(point);
    else {
      const j = Math.floor(Math.random() * positives);
      if (j < MAX_POINTS_PER_SET) raw[j] = point;
    }
  }
  if (raw.length === 0) throw new GridError(`No point features with positive "${column}" values`, 400);
  return {
    points: raw,
    sampled: positives > raw.length,
    totalFeatures,
    format: 'mass_per_area',
    attribute: column,
    moistureAttribute: moistureColumn || dryMatterColumn,
    basis: column.toUpperCase() === 'DRYMASS' ? 'dry' : 'wet',
  };
}

type FlowColumns = { flowColumn: string; widthColumn: string; speedColumn: string; columns: string[] };
type FlowRow = { lon: number; lat: number; time: number; flow: number; width: number; speed: number; moisture?: number };

/**
 * Merge the separate telemetry channels along the timeline: width, speed and moisture rows
 * update the machine state; each flow row becomes a yield point using the most recent state
 * (dropped when the state is stale or missing).
 */
function parseFlowChannels(features: Iterable<ShapeRecord>, cols: FlowColumns): RawExtract {
  const moistureColumn = findColumn(cols.columns, MOISTURE_ATTRIBUTES);
  const timeColumn = findColumn(cols.columns, TIME_ATTRIBUTES);

  const rows: FlowRow[] = [];
  let totalFeatures = 0;
  for (const feature of features) {
    totalFeatures++;
    const p = feature.properties;
    rows.push({
      lon: feature.x,
      lat: feature.y,
      time: timeColumn ? Date.parse(String(p[timeColumn])) : NaN,
      flow: Number(p[cols.flowColumn]),
      width: Number(p[cols.widthColumn]),
      speed: Number(p[cols.speedColumn]),
      moisture: readMoisture(p, moistureColumn, null),
    });
  }
  if (timeColumn) rows.sort((a, b) => a.time - b.time);

  let width = 0;
  let widthTime = -Infinity;
  let speed = 0;
  let speedTime = -Infinity;
  let moisture: number | undefined;
  const raw: YieldPoint[] = [];
  let merged = 0;
  for (const row of rows) {
    if (row.width > 0) {
      width = row.width;
      widthTime = row.time;
    }
    if (row.speed > 0) {
      speed = row.speed;
      speedTime = row.time;
    }
    if (row.moisture !== undefined) moisture = row.moisture;
    if (!(row.flow > 0) || width <= 0 || speed <= 0) continue;
    if (row.time - widthTime > CHANNEL_MAX_AGE_S * 1000 || row.time - speedTime > CHANNEL_MAX_AGE_S * 1000) continue;
    // flow [kg/s] / (width [m] × speed [km/h → m/s]) = kg/m² → ×10 = t/ha
    const value = (row.flow / (width * (speed / 3.6))) * 10;
    if (!Number.isFinite(value) || value <= 0) continue;
    const point: YieldPoint = { lon: row.lon, lat: row.lat, value, moisture, t: Number.isFinite(row.time) ? row.time : undefined, width };
    merged++;
    if (raw.length < MAX_POINTS_PER_SET) raw.push(point);
    else {
      const j = Math.floor(Math.random() * merged);
      if (j < MAX_POINTS_PER_SET) raw[j] = point;
    }
  }
  if (raw.length === 0) throw new GridError('Flow channels could not be merged into yield points', 400);
  return {
    points: raw,
    sampled: merged > raw.length,
    totalFeatures,
    format: 'flow_channels',
    attribute: `${cols.flowColumn} / (${cols.widthColumn} × ${cols.speedColumn})`,
    moistureAttribute: moistureColumn,
    basis: 'wet',
  };
}

/** Timestamps arrive as ISO strings, "2026-08-02 12:10:49" or epoch numbers. */
function readTime(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readPositive(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readFinite(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** 1st/99th-percentile clip of one export set's points. */
function clipPercentiles(points: YieldPoint[]): YieldPoint[] {
  if (points.length === 0) return points;
  const sorted = points.map((p) => p.value).sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * CLIP_LOW)];
  const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * CLIP_HIGH))];
  return points.filter((p) => p.value >= low && p.value <= high);
}

function finalize(extracts: RawExtract[], skippedSources: number, crop?: string, cleaning?: CleaningStats): ParsedYieldPoints {
  const totalFeatures = extracts.reduce((sum, e) => sum + e.totalFeatures, 0);
  const attribute = [...new Set(extracts.map((e) => e.attribute))].join(' + ');
  const moistureAttribute = extracts.map((e) => e.moistureAttribute).find(Boolean);
  const window = resolveCropWindow(crop);
  const [plausibleMin, plausibleMax] = window;

  // Clip PER export set: a farm zip bundles one set per field (different crops and levels).
  const clipped = extracts.flatMap((e) => clipPercentiles(e.points));
  // The crop cap drops what no harvest can produce; when it would erase the map the window
  // clearly doesn't match the data — keep the clipped points and let `plausible` flag it.
  const pointCap = plausibleMax * PER_POINT_CAP_FACTOR;
  const capped = clipped.filter((p) => p.value <= pointCap);
  const points = capped.length > 0 ? capped : clipped;
  const cappedPoints = clipped.length - points.length;

  let valueSum = 0;
  let moistureSum = 0;
  let moistureCount = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const point of points) {
    valueSum += point.value;
    if (moistureAttribute && point.moisture !== undefined) {
      moistureSum += point.moisture;
      moistureCount++;
    }
    if (point.t !== undefined) {
      if (point.t < tMin) tMin = point.t;
      if (point.t > tMax) tMax = point.t;
    }
  }
  const meanRate = round(valueSum / points.length, 2);
  const plausible = meanRate >= plausibleMin && meanRate <= plausibleMax;

  return {
    points,
    format: extracts[0].format,
    attribute,
    totalFeatures,
    droppedFeatures: totalFeatures - points.length,
    // Dry only when every source is dry — a wet/dry mix degrades to wet.
    basis: extracts.every((e) => e.basis === 'dry') ? 'dry' : 'wet',
    moisture:
      moistureAttribute && moistureCount > 0
        ? { attribute: moistureAttribute, mean: round(moistureSum / moistureCount, 2), pointsWithMoisture: moistureCount }
        : undefined,
    sources: { parsed: extracts.length, skipped: skippedSources },
    crs: [...new Set(extracts.map((e) => (e.crs ? `${e.crs.epsg ?? 'unknown'} (${e.crs.source})` : null)).filter(Boolean))].join(' + ') || undefined,
    cleaning,
    timeRange: Number.isFinite(tMin) ? [tMin, tMax] : undefined,
    quality: {
      meanRate,
      plausible,
      window,
      cappedPoints,
      note:
        [
          extracts.some((e) => e.sampled)
            ? `Very large export — points sampled down to ~${MAX_POINTS_PER_SET.toLocaleString('en-US')} per set; mean and distribution are statistically preserved`
            : undefined,
          plausible
            ? undefined
            : `Mean rate ${meanRate} t/ha is outside the plausible window ${plausibleMin}-${plausibleMax} t/ha${crop ? ` for ${crop}` : ''} — check the yield column, its unit and the machine calibration before using this map`,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    },
  };
}

/**
 * Standardize rates to a target moisture (e.g. 14% for cereals).
 *
 * - wet basis: value × (100 − moisture) / (100 − target) — points without a moisture reading
 *   stay unchanged.
 * - dry basis: value × 100 / (100 − target) — the values are already dry mass, so drying them
 *   again via their moisture channel would double-correct.
 *
 * Returns the number of standardized points.
 */
export function standardizeMoisture(points: YieldPoint[], targetMoisture: number, basis: 'wet' | 'dry'): number {
  let standardized = 0;
  for (const point of points) {
    if (basis === 'dry') {
      point.value = (point.value * 100) / (100 - targetMoisture);
      standardized++;
      continue;
    }
    if (point.moisture === undefined || point.moisture <= 0 || point.moisture >= 100) continue;
    point.value = (point.value * (100 - point.moisture)) / (100 - targetMoisture);
    standardized++;
  }
  return standardized;
}

function findColumn(columns: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const match = columns.find((c) => c.toUpperCase() === candidate);
    if (match) return match;
  }
  return null;
}

function readMoisture(properties: Record<string, unknown> | null, moistureColumn: string | null, dryMatterColumn: string | null): number | undefined {
  if (moistureColumn) {
    const m = Number(properties?.[moistureColumn]);
    if (m > 0 && m < 100) return m;
  }
  if (dryMatterColumn) {
    const dm = Number(properties?.[dryMatterColumn]);
    if (dm > 0 && dm < 100) return 100 - dm;
  }
  return undefined;
}

/** 1 t/ha = 1000 kg / 10 000 m² = 0.1 kg/m². */
const T_HA_TO_KG_M2 = 0.1;

export type GriddedYield = {
  raster: Float64Array;
  /** Grid pixels that received at least one harvest point */
  coveredPixels: number;
  pointsUsed: number;
};

/**
 * Grid one source's points, accumulating harvested MASS and the ground it came from and
 * dividing at the end — a rate is intensive, so a mean of rates gives every record the same
 * vote no matter how much ground it stands for. Without a known footprint every record gets
 * the same nominal area, which reduces exactly to the mean of rates.
 */
export function gridYieldPoints(points: YieldPoint[], grid: GridDefinition): GriddedYield {
  const mass = new Float64Array(grid.width * grid.height);
  const area = new Float64Array(grid.width * grid.height);
  const project = projector(grid.epsg);
  let pointsUsed = 0;
  for (const point of points) {
    const [x, y] = project(point.lon, point.lat);
    const idx = pixelIndex(grid, x, y);
    if (idx < 0) continue;
    const areaM2 = point.width && point.width > 0 && point.step && point.step > 0 ? point.width * point.step : 1;
    mass[idx] += point.value * areaM2 * T_HA_TO_KG_M2;
    area[idx] += areaM2;
    pointsUsed++;
  }
  const raster = new Float64Array(grid.width * grid.height).fill(NaN);
  let coveredPixels = 0;
  for (let i = 0; i < raster.length; i++) {
    if (area[i] > 0) {
      raster[i] = mass[i] / area[i] / T_HA_TO_KG_M2;
      coveredPixels++;
    }
  }
  return { raster, coveredPixels, pointsUsed };
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of the points. */
export function pointsBbox(points: YieldPoint[]): [number, number, number, number] | null {
  if (!points.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}
