import { GridError } from "./grid.js";

import { plausibleMoisturePercent } from "./channels.js";
import type { YieldPoint } from "./types.js";

/**
 * AGRO-MAP .aft — the export format of the Agrocom AGROMAP software that
 * accompanied CLAAS/Agrocom yield monitors (ACT/CEBIS era, ~2000-2013). Half
 * CSV, half custom: one header line (farm, field, crop, channel names, then
 * summary stats), followed by one row per logged point. Column semantics per
 * the original autoyield research parser (aft_agrocom.py):
 *
 *   N051.49229,E009.92908,09.500,0145636,03.3,…,14.07.10,15.0,…
 *   [0] lat    [1] lon    [2] t/ha [3] HHMMSS (last 6)  [d] date [d+1] moisture %
 *
 * The date column is located by scanning the first data row (its index varies
 * between AGROMAP versions); moisture is the column right after it. Rows are
 * time-ordered per file but a harvest is often split across several .aft
 * exports (tank loads / days), so extraction merges all members and re-sorts
 * by timestamp — the pass-overlap filter downstream needs the harvest sequence.
 */
const AFT_MAGIC = "AGRO-MAP.AFT";

export function isAftZip(fileNames: string[]): boolean {
  return fileNames.some((name) => /\.aft$/i.test(name) && !name.includes("__MACOSX"));
}

/** True when the upload is a bare .aft text file rather than a zip. */
export function isAftText(buffer: Buffer): boolean {
  return buffer.subarray(0, AFT_MAGIC.length).toString("latin1") === AFT_MAGIC;
}

export type AftExtract = {
  points: YieldPoint[];
  totalRecords: number;
  attribute: string;
  moistureAttribute: string;
  /** Logged timestamps (epoch ms) of the kept points — the real harvest dates. */
  times: number[];
};

const DATE_PATTERN = /^[0-3]\d\.[0-1]\d\.\d{2}$/;

type AftRecord = YieldPoint & { time: number };

function parseCoordinate(raw: string): number | null {
  const hemisphere = raw[0];
  const value = Number.parseFloat(raw.slice(1));
  if (!Number.isFinite(value)) return null;
  if (hemisphere === "N" || hemisphere === "E") return value;
  if (hemisphere === "S" || hemisphere === "W") return -value;
  return null;
}

function parseAftText(text: string): { records: AftRecord[]; kultur?: string; schlag?: string } {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ?? "";
  if (!header.startsWith(AFT_MAGIC)) throw new GridError("Not an AGRO-MAP .aft file", 400);

  // Header prefix before the channel-name block (",;" delimits it): position 4
  // is the farm, 5 the field, 6 the crop ("W- Gerste" → "W-Gerste").
  const prefixEnd = header.indexOf(",;");
  const prefix = (prefixEnd > 0 ? header.slice(0, prefixEnd) : header).split(",");
  const kultur = prefix[6]?.trim().replace("- ", "-") || undefined;
  const schlag = prefix[5]?.trim() || undefined;

  const records: AftRecord[] = [];
  let dateIndex = -1;

  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols.length < 6 || !/^[NS]\d/.test(cols[0])) continue;

    if (dateIndex === -1) {
      dateIndex = cols.findIndex((col) => DATE_PATTERN.test(col));
      if (dateIndex === -1) continue;
    }

    const lat = parseCoordinate(cols[0]);
    const lon = parseCoordinate(cols[1]);
    const value = Number.parseFloat(cols[2]);
    const date = cols[dateIndex];
    if (lat === null || lon === null || !Number.isFinite(value) || !DATE_PATTERN.test(date)) continue;

    // 0145636 → 14:56:36 on the row's date. Only ordering matters, so the
    // timezone is irrelevant (a harvest crossing midnight keeps its per-day
    // order, matching the original parser's behavior).
    const hhmmss = cols[3].slice(-6);
    const [dd, mm, yy] = date.split(".");
    const time = Date.parse(`20${yy}-${mm}-${dd}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}Z`);
    if (!Number.isFinite(time)) continue;

    const rawMoisture = Number.parseFloat(cols[dateIndex + 1] ?? "");
    records.push({
      lat,
      lon,
      value,
      moisture: plausibleMoisturePercent(rawMoisture > 0 ? rawMoisture : undefined),
      time,
    });
  }

  return { records, kultur, schlag };
}

/**
 * Merge one or more .aft member texts (one harvest is often exported in
 * parts) into a single time-ordered yield point set. Yield rates are t/ha
 * fresh mass as recorded by the monitor — no unit conversion needed.
 */
export function extractAftYieldPoints(texts: string[]): AftExtract {
  const all: AftRecord[] = [];
  let kultur: string | undefined;
  let schlag: string | undefined;

  for (const text of texts) {
    const parsed = parseAftText(text);
    kultur = kultur ?? parsed.kultur;
    schlag = schlag ?? parsed.schlag;
    // Not `push(...parsed.records)`: a season file carries hundreds of
    // thousands of records, and spreading them as call arguments overflows the
    // stack (a 15 MB export died with "Maximum call stack size exceeded").
    for (const record of parsed.records) all.push(record);
  }
  if (all.length === 0) throw new GridError("The .aft file contains no data rows", 400);

  all.sort((a, b) => a.time - b.time);
  const kept = all.filter((record) => record.value > 0);
  // `t` stays on the points: the track-cleaning chain (lag shift, pass trim,
  // overlap removal) reconstructs the harvest sequence from it.
  const points = kept.map(({ time, ...point }) => ({ ...point, t: time }));
  if (points.length === 0) throw new GridError("The .aft file contains no positive yield points", 400);

  const label = [kultur, schlag].filter(Boolean).join(", ");
  return {
    points,
    totalRecords: all.length,
    attribute: label ? `AGRO-MAP AFT yield (${label})` : "AGRO-MAP AFT yield",
    moistureAttribute: "AGRO-MAP AFT grain moisture",
    // Kept, not all: a monitor logs zero-yield rows while driving to the field,
    // and those would stretch the window past the actual harvest.
    times: kept.map((record) => record.time),
  };
}
