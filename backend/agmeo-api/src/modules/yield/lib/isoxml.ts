import type { YieldChannel } from './channels.js';
import { channelAttribution, MM_TO_M, MOISTURE_CHANNEL, PPM_TO_PERCENT, WORKING_WIDTH_CHANNEL, YIELD_CHANNELS } from './channels.js';
import { GridError } from './grid.js';
import type { YieldPoint } from './types.js';
import type { ZipEntries } from './zip.js';

/**
 * ISO 11783-10 TaskData time logs, read without a library.
 *
 * The reference app uses the `isoxml` package; agmeo only needs the TLG time logs of a
 * TASKDATA export, whose format is small and fixed: TLGnnnnn.XML declares which fields every
 * binary record carries (TIM start, PTN position channels, DLV process-data channels) and
 * TLGnnnnn.BIN repeats them per record. ISOXML records only changes, so values are
 * forward-filled along the log.
 */

/**
 * Cap on retained points: a multi-day grass TaskData holds millions of 1 Hz records. Sampling
 * is SYSTEMATIC (every k-th record), not a reservoir: the track-level filters downstream need
 * points that are still consecutive along the drive.
 */
const MAX_ISOXML_POINTS = 2_000_000;

export type IsoxmlYieldExtract = {
  points: YieldPoint[];
  totalRecords: number;
  attribute: string;
  moistureAttribute?: string;
  /** Whether the picked DDI reports wet (84) or dry (181) mass */
  basis: 'wet' | 'dry';
  /** true when the records were thinned to MAX_ISOXML_POINTS */
  sampled?: boolean;
};

export function isIsoxmlZip(fileNames: string[]): boolean {
  return fileNames.some((name) => /(^|\/)taskdata\.xml$/i.test(name));
}

type XmlElement = { name: string; attrs: Record<string, string> };

/** Every start tag of an XML document with its attributes — ISOXML has no text content we need. */
export function xmlElements(xml: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const m of xml.matchAll(/<([A-Za-z_][\w.-]*)\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3] ?? '';
    out.push({ name: m[1], attrs });
  }
  return out;
}

/** Order of the optional PTN fields in a binary record, with their sizes. */
const PTN_FIELDS = [
  ['A', 'int32'],
  ['B', 'int32'],
  ['C', 'int32'],
  ['D', 'uint8'],
  ['E', 'uint16'],
  ['F', 'uint16'],
  ['G', 'uint8'],
  ['H', 'uint32'],
  ['I', 'uint16'],
] as const;

export type TimeLogHeader = {
  /** Start time stored per record. */
  hasTime: boolean;
  ptn: { key: string; type: (typeof PTN_FIELDS)[number][1] }[];
  /** Fixed PTN values from the header. */
  fixed: Record<string, number>;
  dlvs: { ddi: number; det: string | null }[];
};

export function parseTimeLogHeader(xml: string): TimeLogHeader {
  const elements = xmlElements(xml);
  const tim = elements.find((e) => e.name === 'TIM');
  if (!tim) throw new GridError('TLG header has no TIM element', 400);
  const ptnEl = elements.find((e) => e.name === 'PTN');
  const ptn: TimeLogHeader['ptn'] = [];
  const fixed: Record<string, number> = {};
  for (const [key, type] of PTN_FIELDS) {
    if (!ptnEl || !(key in ptnEl.attrs)) continue;
    if (ptnEl.attrs[key] === '') ptn.push({ key, type });
    else fixed[key] = Number(ptnEl.attrs[key]);
  }
  const dlvs = elements.filter((e) => e.name === 'DLV').map((e) => ({ ddi: parseInt(e.attrs.A ?? '', 16), det: e.attrs.C ?? null }));
  return { hasTime: 'A' in tim.attrs && tim.attrs.A === '', ptn, fixed, dlvs };
}

export type TimeLogRecord = {
  time?: number;
  lat?: number;
  lon?: number;
  status?: number;
  /** Values of this record only (by DLV index), not forward-filled. */
  values: Map<number, number>;
};

const DAY_MS = 86_400_000;
const EPOCH_1980 = Date.UTC(1980, 0, 1);

/** Iterate the binary records of a time log. A truncated last record ends the log. */
export function* timeLogRecords(header: TimeLogHeader, bin: Buffer): Generator<TimeLogRecord> {
  let offset = 0;
  const size = { int32: 4, uint32: 4, uint16: 2, uint8: 1 } as const;
  const read = (type: keyof typeof size): number => {
    const v =
      type === 'int32' ? bin.readInt32LE(offset) : type === 'uint32' ? bin.readUInt32LE(offset) : type === 'uint16' ? bin.readUInt16LE(offset) : bin.readUInt8(offset);
    offset += size[type];
    return v;
  };
  while (offset < bin.length) {
    try {
      const record: TimeLogRecord = { values: new Map() };
      if (header.hasTime) {
        const ms = read('uint32');
        const days = read('uint16');
        record.time = EPOCH_1980 + days * DAY_MS + ms;
      }
      const ptn: Record<string, number> = { ...header.fixed };
      for (const field of header.ptn) ptn[field.key] = read(field.type);
      if (ptn.A !== undefined) record.lat = header.fixed.A !== undefined && !header.ptn.some((f) => f.key === 'A') ? ptn.A : ptn.A * 1e-7;
      if (ptn.B !== undefined) record.lon = header.fixed.B !== undefined && !header.ptn.some((f) => f.key === 'B') ? ptn.B : ptn.B * 1e-7;
      if (ptn.D !== undefined) record.status = ptn.D;
      const count = read('uint8');
      for (let i = 0; i < count; i++) {
        const index = read('uint8');
        record.values.set(index, read('int32'));
      }
      yield record;
    } catch (error) {
      if (error instanceof RangeError) return;
      throw error;
    }
  }
}

/** GNSS fix, DGNSS, precise, RTK fixed/float, dead reckoning, manual, simulated. */
const VALID_STATUS = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const validPosition = (r: TimeLogRecord) =>
  r.lat !== undefined && r.lon !== undefined && !(r.lat === 0 && r.lon === 0) && (r.status === undefined || VALID_STATUS.has(r.status));

/** TLG names of the TaskData: referenced by tasks, else every TLG with both parts present. */
function timeLogNames(names: string[], taskdataXml: string, taskdataPath: string): { xml: string; bin: string }[] {
  const dir = taskdataPath.includes('/') ? taskdataPath.slice(0, taskdataPath.lastIndexOf('/') + 1) : '';
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const find = (base: string, ext: string) => byLower.get(`${dir}${base}.${ext}`.toLowerCase());
  const referenced = xmlElements(taskdataXml)
    .filter((e) => e.name === 'TLG' && e.attrs.A)
    .map((e) => e.attrs.A);
  const bases = referenced.length
    ? referenced
    : names.filter((n) => /(^|\/)TLG\d+\.bin$/i.test(n)).map((n) => n.slice(n.lastIndexOf('/') + 1).replace(/\.bin$/i, ''));
  return [...new Set(bases)].flatMap((base) => {
    const xml = find(base, 'xml');
    const bin = find(base, 'bin');
    return xml && bin ? [{ xml, bin }] : [];
  });
}

/**
 * Extract raw yield points from an ISOXML TaskData zip (CLAAS, Fendt/AGCO, Krone, CNH
 * terminals …): every TLG time log is parsed, the yield channel is picked by DDI and missing
 * values are forward-filled along the log. Cleaning happens downstream in the shared pipeline.
 */
export async function extractIsoxmlYieldPoints(zip: ZipEntries): Promise<IsoxmlYieldExtract> {
  const taskdataPath = zip.names.find((n) => /(^|\/)taskdata\.xml$/i.test(n));
  if (!taskdataPath) throw new GridError('Invalid ISOXML TaskData: no TASKDATA.XML', 400);
  const taskdata = (await zip.read(taskdataPath)).toString('utf8');
  if (!/ISO11783_TaskData/.test(taskdata)) throw new GridError('Invalid ISOXML TaskData: TASKDATA.XML is not an ISO 11783 task file', 400);
  const logs = timeLogNames(zip.names, taskdata, taskdataPath);
  if (logs.length === 0) throw new GridError('TaskData contains no TLG time logs', 400);

  const points: YieldPoint[] = [];
  let stride = 1;
  let seen = 0;
  let totalRecords = 0;
  let picked: YieldChannel | null = null;
  let hasMoisture = false;

  for (const log of logs) {
    const header = parseTimeLogHeader((await zip.read(log.xml)).toString('utf8'));
    // Pin the yield DDI on first contact so a file mixing wet (84) and dry (181) logs never
    // blends the two under one attribute.
    const channel: YieldChannel | undefined = picked ?? YIELD_CHANNELS.find((c) => header.dlvs.some((d) => d.ddi === c.ddi));
    const yieldIndex = channel ? header.dlvs.findIndex((d) => d.ddi === channel.ddi) : -1;
    const bin = await zip.read(log.bin);
    if (!channel || yieldIndex < 0) {
      for (const _ of timeLogRecords(header, bin)) totalRecords++;
      continue;
    }
    picked = channel;
    const moistureIndex = header.dlvs.findIndex((d) => d.ddi === MOISTURE_CHANNEL.ddi);
    if (moistureIndex >= 0) hasMoisture = true;
    const widthIndex = header.dlvs.findIndex((d) => d.ddi === WORKING_WIDTH_CHANNEL.ddi);

    const filled = new Map<number, number>();
    for (const record of timeLogRecords(header, bin)) {
      totalRecords++;
      for (const [index, value] of record.values) filled.set(index, value);
      if (!validPosition(record)) continue;
      const raw = filled.get(yieldIndex);
      if (!(raw !== undefined && raw > 0)) continue;

      seen++;
      if ((seen - 1) % stride !== 0) continue;

      const moisturePpm = moistureIndex >= 0 ? filled.get(moistureIndex) : undefined;
      const moisture = moisturePpm !== undefined ? moisturePpm * PPM_TO_PERCENT : undefined;
      const widthMm = widthIndex >= 0 ? filled.get(widthIndex) : undefined;
      points.push({
        lon: record.lon!,
        lat: record.lat!,
        value: raw * channel.toCanonical,
        moisture: moisture !== undefined && moisture > 0 && moisture < 100 ? moisture : undefined,
        t: record.time,
        width: widthMm !== undefined && widthMm > 0 ? widthMm * MM_TO_M : undefined,
      });

      // Cap reached: double the stride and drop every second point kept so far.
      if (points.length >= MAX_ISOXML_POINTS) {
        for (let write = 0, read = 0; read < points.length; read += 2, write++) points[write] = points[read];
        points.length = Math.ceil(points.length / 2);
        stride *= 2;
      }
    }
  }

  if (!picked) {
    throw new GridError(`TaskData time logs carry no yield channel — expected DDI ${YIELD_CHANNELS.map((c) => c.ddi).join(' or ')}`, 400);
  }
  if (points.length === 0) throw new GridError('TaskData yield channel contains no positive values', 400);

  return {
    points,
    sampled: stride > 1,
    totalRecords,
    attribute: channelAttribution(picked),
    moistureAttribute: hasMoisture ? channelAttribution(MOISTURE_CHANNEL) : undefined,
    basis: picked.basis,
  };
}
