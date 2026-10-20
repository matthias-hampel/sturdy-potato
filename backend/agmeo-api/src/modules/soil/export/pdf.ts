/**
 * A small vector PDF writer (PDF 1.4): pages, Helvetica text, lines, rectangles and polygons.
 * Enough for the soil sample cards and result sheets without a PDF dependency; the reference
 * app rendered these with jsPDF in the browser.
 */
import { deflateSync } from 'node:zlib';
import type { PdfImage } from '../../../core/images.js';

export type Rgb = [number, number, number];

/** A4 landscape in points. */
export const A4_LANDSCAPE = { width: 842, height: 595 };

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

// Characters outside Latin-1 that WinAnsiEncoding places in 0x80..0x9F, and plain stand-ins for the rest.
const WIN_ANSI: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
const PLAIN: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '⁻': '-', '≤': '<=', '≥': '>=', 'Ø': 'Ø', '³': '³' };

function encode(text: string): number[] {
  const out: number[] = [];
  for (const raw of text) {
    const ch = PLAIN[raw] ?? raw;
    for (const c of ch) {
      const code = c.codePointAt(0)!;
      if (WIN_ANSI[c] != null) out.push(WIN_ANSI[c]);
      else if (code < 256 && (code >= 0xa0 || (code >= 32 && code < 127))) out.push(code);
      else out.push(0x3f);
    }
  }
  return out;
}

const escape = (bytes: number[]) =>
  bytes
    .map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b)))
    .join('');

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export class PdfDoc {
  private pages: string[] = [];
  private ops: string[] = [];
  readonly width: number;
  readonly height: number;
  /** The organization's logo, drawn by `logo()` (one shared XObject for every page). */
  readonly logoImage: PdfImage | null;

  constructor(size = A4_LANDSCAPE, opts: { logo?: PdfImage | null } = {}) {
    this.width = size.width;
    this.height = size.height;
    this.logoImage = opts.logo ?? null;
  }

  /**
   * Draws the logo inside a box whose top right corner is (right, top), keeping its aspect ratio.
   * Returns the drawn width (0 without a logo).
   */
  logo(right: number, top: number, maxWidth: number, maxHeight: number): number {
    const img = this.logoImage;
    if (!img) return 0;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(right - w)} ${n(this.height - top - h)} cm /Logo Do Q`);
    return w;
  }

  get pageCount() {
    return this.pages.length + (this.ops.length ? 1 : 0);
  }

  addPage() {
    if (this.ops.length) this.pages.push(this.ops.join('\n'));
    this.ops = [];
    return this;
  }

  /** Width of a text in points. */
  textWidth(text: string, size: number, bold = false) {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    return (encode(text).reduce((s, b) => s + (b >= 32 && b <= 126 ? table[b - 32] : 556), 0) * size) / 1000;
  }

  /** Cuts a text with an ellipsis to fit a width. */
  fit(text: string, width: number, size: number, bold = false) {
    if (this.textWidth(text, size, bold) <= width) return text;
    let s = text;
    while (s.length > 1 && this.textWidth(`${s}…`, size, bold) > width) s = s.slice(0, -1);
    return `${s}…`;
  }

  /** Text with its baseline at y (from the top of the page). */
  text(text: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: Rgb; align?: 'left' | 'right' | 'center' } = {}) {
    const size = opts.size ?? 10;
    const w = opts.align && opts.align !== 'left' ? this.textWidth(text, size, opts.bold) : 0;
    const left = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${this.fill(opts.color ?? [0.12, 0.14, 0.1])} /${opts.bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(this.height - y)} Td (${escape(encode(text))}) Tj ET`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb = [0.8, 0.8, 0.78], width = 0.5) {
    this.ops.push(`${this.stroke(color)} ${n(width)} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: Rgb; stroke?: Rgb; width?: number } = {}) {
    const paint = opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S';
    this.ops.push(`${opts.fill ? this.fill(opts.fill) : ''} ${opts.stroke ? this.stroke(opts.stroke) : ''} ${n(opts.width ?? 0.5)} w ${n(x)} ${n(this.height - y - h)} ${n(w)} ${n(h)} re ${paint}`);
    return this;
  }

  /** Polygons with holes (even-odd), points in page coordinates from the top. */
  polygon(rings: [number, number][][], opts: { fill?: Rgb; stroke?: Rgb; width?: number }) {
    const path = rings
      .filter((r) => r.length > 2)
      .map((r) => r.map(([x, y], i) => `${n(x)} ${n(this.height - y)} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' h')
      .join(' ');
    if (!path) return this;
    const paint = opts.fill && opts.stroke ? 'B*' : opts.fill ? 'f*' : 'S';
    this.ops.push(`${opts.fill ? this.fill(opts.fill) : ''} ${opts.stroke ? this.stroke(opts.stroke) : ''} ${n(opts.width ?? 0.5)} w 1 j ${path} ${paint}`);
    return this;
  }

  circle(x: number, y: number, r: number, opts: { fill?: Rgb; stroke?: Rgb; width?: number }) {
    const k = 0.5523 * r;
    const cy = this.height - y;
    const path = `${n(x + r)} ${n(cy)} m ${n(x + r)} ${n(cy + k)} ${n(x + k)} ${n(cy + r)} ${n(x)} ${n(cy + r)} c ${n(x - k)} ${n(cy + r)} ${n(x - r)} ${n(cy + k)} ${n(x - r)} ${n(cy)} c ${n(x - r)} ${n(cy - k)} ${n(x - k)} ${n(cy - r)} ${n(x)} ${n(cy - r)} c ${n(x + k)} ${n(cy - r)} ${n(x + r)} ${n(cy - k)} ${n(x + r)} ${n(cy)} c h`;
    const paint = opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S';
    this.ops.push(`${opts.fill ? this.fill(opts.fill) : ''} ${opts.stroke ? this.stroke(opts.stroke) : ''} ${n(opts.width ?? 0.5)} w ${path} ${paint}`);
    return this;
  }

  private fill = (c: Rgb) => `${n(c[0])} ${n(c[1])} ${n(c[2])} rg`;
  private stroke = (c: Rgb) => `${n(c[0])} ${n(c[1])} ${n(c[2])} RG`;

  toBuffer(meta: { title?: string } = {}): Buffer {
    const pages = [...this.pages, ...(this.ops.length || !this.pages.length ? [this.ops.join('\n')] : [])];
    const objects: Buffer[] = [];
    const add = (body: string | Buffer) => {
      objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
      return objects.length;
    };
    const catalog = add('');
    const pagesId = add('');
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const info = add(`<< /Producer (agmeo) /Title (${escape(encode(meta.title ?? ''))}) >>`);
    let xobjects = '';
    const img = this.logoImage;
    if (img) {
      const streamOf = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`${dict.slice(0, -2)} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
      const mask = img.alpha ? add(streamOf(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`, img.alpha)) : null;
      const image = add(
        streamOf(
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.colorSpace} /BitsPerComponent 8 /Filter /${img.filter}${mask ? ` /SMask ${mask} 0 R` : ''} >>`,
          img.data,
        ),
      );
      xobjects = ` /XObject << /Logo ${image} 0 R >>`;
    }
    const kids: number[] = [];
    for (const content of pages) {
      const data = deflateSync(Buffer.from(content, 'latin1'));
      const stream = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >>${xobjects} >> /Contents ${stream} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
    objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets: number[] = [];
    let length = chunks[0].length;
    objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(chunk);
      length += chunk.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

export const hexToRgb = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.6, 0.6, 0.6];
};
