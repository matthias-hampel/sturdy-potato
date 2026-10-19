/**
 * RADOLAN binary format (RY national grid and the members of the RV/DE1200 composite), ported
 * from the reference app (src/lib/dwd/radolan.ts, time.ts). The header is ASCII up to ETX (0x03);
 * the body is row-major little-endian uint16, south to north. The low 12 bits are the value,
 * bits 12–13 flag missing data.
 */
import { bunzip2 } from '../../vendor/seek-bzip/bunzip2.js';

const NO_DATA_MASK = 0x3000;
const VALUE_MASK = 0x0fff;

export interface RadolanFrame {
  /** mm in 5 minutes, north up (row 0 is the northernmost), row-major; NaN = no data. */
  values: Float32Array;
  rows: number;
  cols: number;
  /** VV header field: forecast lead time in minutes (0 for analyses and products without VV). */
  forecastMinutes: number;
}

/** Parses an already decompressed RADOLAN buffer (e.g. a member of an RV tar). */
export function parseRadolanRaw(raw: Uint8Array): RadolanFrame {
  const etx = raw.indexOf(0x03);
  if (etx < 0) throw new Error('RADOLAN: no ETX byte in header');

  const header = Buffer.from(raw.buffer, raw.byteOffset, etx).toString('latin1');
  const gp = /GP\s*(\d+)x\s*(\d+)/.exec(header);
  if (!gp) throw new Error('RADOLAN: missing GP field in header');
  const rows = Number(gp[1]);
  const cols = Number(gp[2]);

  const pr = /PR\s+E([+-]\d+)/.exec(header);
  const precision = pr ? Math.pow(10, Number(pr[1])) : 0.1;

  const vv = /VV\s+(\d+)/.exec(header);
  const forecastMinutes = vv ? Number(vv[1]) : 0;

  const bodyOffset = etx + 1;
  if (raw.length < bodyOffset + rows * cols * 2) {
    throw new Error(`RADOLAN: body shorter than expected (${raw.length - bodyOffset} < ${rows * cols * 2})`);
  }

  // Little-endian uint16, flipped vertically (south-to-north → north up).
  const body = new DataView(raw.buffer, raw.byteOffset + bodyOffset, rows * cols * 2);
  const values = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const srcRow = rows - 1 - r;
    for (let c = 0; c < cols; c++) {
      const word = body.getUint16((srcRow * cols + c) * 2, true);
      values[r * cols + c] = word & NO_DATA_MASK ? NaN : (word & VALUE_MASK) * precision;
    }
  }
  return { values, rows, cols, forecastMinutes };
}

/** Decompresses a bzip2-encoded RADOLAN file and parses it. */
export const parseRadolan = (compressed: Uint8Array): RadolanFrame => parseRadolanRaw(bunzip2(compressed));

/** DWD file name timestamp `YYMMDDHHMM` (UTC) → Date. */
export function timestampToDate(ts: string): Date {
  if (!/^\d{10}$/.test(ts)) throw new Error(`Invalid RADOLAN timestamp ${ts}`);
  return new Date(`20${ts.slice(0, 2)}-${ts.slice(2, 4)}-${ts.slice(4, 6)}T${ts.slice(6, 8)}:${ts.slice(8, 10)}:00Z`);
}

/** Date → DWD file name timestamp `YYMMDDHHMM` (UTC). */
export function dateToTimestamp(d: Date): string {
  return d.toISOString().replace(/^\d\d(\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d).*$/, '$1$2$3$4$5');
}
