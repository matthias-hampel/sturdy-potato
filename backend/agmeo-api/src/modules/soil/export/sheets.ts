/**
 * PDF sheets of the soil planner: the zonation map (sample card for the sampler: zones, probe
 * numbers, sampling points) and the results sheet (zones with lab values and content classes).
 * Layout follows the reference app's zonationPdf.ts / resultsPdf.ts, drawn as vectors instead
 * of map screenshots.
 */
import { SOIL_PARAM_META, type SoilParameter } from '@agmeo/contracts';
import type { MultiPolygon, Position } from 'geojson';
import type { PdfImage } from '../../../core/images.js';
import { hexToRgb, PdfDoc, type Rgb } from './pdf.js';

const L = {
  zonationTitle: 'Zonierungskarte',
  resultsTitle: 'Bodenuntersuchung – Ergebnisse',
  overview: 'Betriebsübersicht',
  contents: 'Inhalt',
  field: 'Schlag',
  area: 'Fläche',
  probes: 'Proben',
  probe: 'Probe',
  zone: 'Zone',
  page: 'Seite',
  sum: 'Summe',
  fields: 'Schläge',
  zonedHeader: 'Felder mit Zonierung',
  noZonationHeader: 'Felder ohne Zonierung',
  noZonationHint: 'Für diese Felder liegt noch keine Zonierung vor.',
  zones: (n: number) => (n === 1 ? '1 Zone' : `${n} Zonen`),
  soilType: 'Bodenart',
  sampledOn: 'Probenahme',
  classes: 'Gehaltsklassen nach VDLUFA (A sehr niedrig … E sehr hoch)',
  point: 'Probepunkt',
} as const;

export interface SheetZone {
  label: string;
  color: string;
  areaHa: number;
  probeNr: number | null;
  geometry: MultiPolygon;
  point: [number, number] | null;
  values: Partial<Record<SoilParameter, number>>;
  classes: Partial<Record<SoilParameter, string | null>>;
  sampledOn: string | null;
}

export interface SheetField {
  name: string;
  areaHa: number;
  soilType: string | null;
  geometry: MultiPolygon;
  zones: SheetZone[];
}

const MARGIN = 28;
const NAVY: Rgb = [0.09, 0.1, 0.2];
const GRAY: Rgb = [0.45, 0.47, 0.42];
const LINE: Rgb = [0.85, 0.84, 0.8];
const STAGE: Record<string, Rgb> = { A: hexToRgb('#dc2626'), B: hexToRgb('#f97316'), C: hexToRgb('#22c55e'), D: hexToRgb('#3b82f6'), E: hexToRgb('#8b5cf6') };

const num = (v: number, digits: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
const ha = (v: number) => `${num(v, 2)} ha`;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function header(pdf: PdfDoc, title: string, subtitle: string, date: string) {
  pdf.text('agmeo', MARGIN, MARGIN + 10, { size: 14, bold: true, color: [0.24, 0.42, 0.18] });
  pdf.text(title, MARGIN + 70, MARGIN + 10, { size: 14, bold: true, color: NAVY });
  pdf.text(pdf.fit(subtitle, pdf.width - 2 * MARGIN - 260, 9), MARGIN + 70, MARGIN + 23, { size: 9, color: GRAY });
  // The organization's logo at the top right, the date to its left.
  const logoWidth = pdf.logo(pdf.width - MARGIN, MARGIN - 6, 110, 30);
  pdf.text(date, pdf.width - MARGIN - (logoWidth ? logoWidth + 10 : 0), MARGIN + 10, { size: 9, color: GRAY, align: 'right' });
  pdf.line(MARGIN, MARGIN + 30, pdf.width - MARGIN, MARGIN + 30, LINE, 0.8);
}

function footer(pdf: PdfDoc, page: number) {
  pdf.text(`${L.page} ${page}`, pdf.width - MARGIN, pdf.height - MARGIN / 2, { size: 8, color: GRAY, align: 'right' });
}

/** Map projection fitting lon/lat geometries into a box (equirectangular, scaled by latitude). */
function projector(geometries: MultiPolygon[], box: { x: number; y: number; w: number; h: number }) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geometries)
    for (const poly of g.coordinates)
      for (const ring of poly)
        for (const [x, y] of ring) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
  if (!Number.isFinite(x0)) return (p: Position): [number, number] => [box.x, box.y];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const spanX = Math.max((x1 - x0) * k, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);
  const scale = Math.min(box.w / spanX, box.h / spanY);
  const ox = box.x + (box.w - spanX * scale) / 2;
  const oy = box.y + (box.h - spanY * scale) / 2;
  return (p: Position): [number, number] => [ox + (p[0] - x0) * k * scale, oy + (y1 - p[1]) * scale];
}

function drawGeometry(pdf: PdfDoc, g: MultiPolygon, project: (p: Position) => [number, number], style: { fill?: Rgb; stroke?: Rgb; width?: number }) {
  for (const poly of g.coordinates) pdf.polygon(poly.map((ring) => ring.map(project)), style);
}

function drawFieldMap(pdf: PdfDoc, field: SheetField, box: { x: number; y: number; w: number; h: number }, fill: (z: SheetZone) => Rgb) {
  pdf.rect(box.x, box.y, box.w, box.h, { stroke: LINE, fill: [0.97, 0.97, 0.95] });
  const inner = { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 };
  const project = projector([field.geometry], inner);
  for (const z of field.zones) drawGeometry(pdf, z.geometry, project, { fill: fill(z), stroke: [1, 1, 1], width: 0.6 });
  drawGeometry(pdf, field.geometry, project, { stroke: NAVY, width: 1.2 });
  for (const z of field.zones) {
    if (!z.point) continue;
    const [x, y] = project(z.point);
    pdf.circle(x, y, 3, { fill: NAVY, stroke: [1, 1, 1], width: 0.8 });
    const text = z.probeNr != null ? String(z.probeNr) : z.label;
    const w = pdf.textWidth(text, 8, true) + 6;
    pdf.rect(x - w / 2, y - 16, w, 11, { fill: [1, 1, 1], stroke: NAVY, width: 0.5 });
    pdf.text(text, x, y - 7.5, { size: 8, bold: true, color: NAVY, align: 'center' });
  }
}

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
  value: (z: SheetZone) => string;
  chip?: (z: SheetZone) => Rgb | null;
}

function zoneTable(pdf: PdfDoc, zones: SheetZone[], x: number, y: number, columns: Column[], maxY: number): number {
  const rowH = 14;
  let cx = x;
  for (const c of columns) {
    pdf.text(pdf.fit(c.label, c.width - 4, 7.5, true), c.align === 'right' ? cx + c.width - 2 : cx, y, { size: 7.5, bold: true, color: GRAY, align: c.align === 'right' ? 'right' : 'left' });
    cx += c.width;
  }
  const width = columns.reduce((s, c) => s + c.width, 0);
  pdf.line(x, y + 4, x + width, y + 4, LINE, 0.6);
  let ry = y + 4 + rowH - 3;
  for (const z of zones) {
    if (ry > maxY) break;
    cx = x;
    for (const [i, c] of columns.entries()) {
      if (i === 0) pdf.rect(cx, ry - 7, 7, 7, { fill: hexToRgb(z.color) });
      const chip = c.chip?.(z);
      if (chip) pdf.rect(cx + c.width - 10, ry - 7, 7, 7, { fill: chip });
      const text = pdf.fit(c.value(z), c.width - (i === 0 ? 14 : 4) - (chip ? 10 : 0), 8);
      pdf.text(text, c.align === 'right' ? cx + c.width - 2 - (chip ? 11 : 0) : cx + (i === 0 ? 10 : 0), ry, { size: 8, align: c.align === 'right' ? 'right' : 'left' });
      cx += c.width;
    }
    pdf.line(x, ry + 4, x + width, ry + 4, [0.93, 0.92, 0.9], 0.4);
    ry += rowH;
  }
  return ry;
}

function overviewPage(pdf: PdfDoc, title: string, orgName: string, date: string, fields: SheetField[], others: SheetField[], firstPage: number) {
  const l = L;
  const totalHa = [...fields, ...others].reduce((s, f) => s + f.areaHa, 0);
  header(pdf, title, `${orgName} · ${fields.length + others.length} ${l.fields} · ${ha(totalHa)}`, date);
  const box = { x: MARGIN, y: MARGIN + 44, w: (pdf.width - 2 * MARGIN) * 0.55, h: pdf.height - 2 * MARGIN - 64 };
  pdf.text(l.overview, box.x, box.y - 4, { size: 9, bold: true, color: NAVY });
  pdf.rect(box.x, box.y, box.w, box.h, { stroke: LINE, fill: [0.97, 0.97, 0.95] });
  const all = [...fields, ...others];
  const project = projector(
    all.map((f) => f.geometry),
    { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 },
  );
  for (const f of fields) for (const z of f.zones) drawGeometry(pdf, z.geometry, project, { fill: hexToRgb(z.color) });
  for (const f of all) drawGeometry(pdf, f.geometry, project, { stroke: NAVY, width: 0.6 });

  const tx = box.x + box.w + 18;
  const tw = pdf.width - MARGIN - tx;
  pdf.text(l.contents, tx, box.y - 4, { size: 9, bold: true, color: NAVY });
  let y = box.y + 10;
  const row = (name: string, areaHa: number, probes: string, page: string, bold = false) => {
    pdf.text(pdf.fit(name, tw - 120, 8, bold), tx, y, { size: 8, bold });
    pdf.text(probes, tx + tw - 80, y, { size: 8, align: 'right', bold });
    pdf.text(ha(areaHa), tx + tw - 26, y, { size: 8, align: 'right', bold });
    pdf.text(page, tx + tw, y, { size: 8, align: 'right', bold });
    y += 12;
  };
  pdf.text(l.field, tx, y, { size: 7.5, bold: true, color: GRAY });
  pdf.text(l.probes, tx + tw - 80, y, { size: 7.5, bold: true, color: GRAY, align: 'right' });
  pdf.text(l.area, tx + tw - 26, y, { size: 7.5, bold: true, color: GRAY, align: 'right' });
  pdf.text(l.page, tx + tw, y, { size: 7.5, bold: true, color: GRAY, align: 'right' });
  y += 14;
  fields.forEach((f, i) => y < pdf.height - MARGIN - 40 && row(f.name, f.areaHa, String(f.zones.length), String(firstPage + i)));
  if (others.length && y < pdf.height - MARGIN - 40) {
    y += 4;
    pdf.text(l.noZonationHeader, tx, y, { size: 8, bold: true, color: NAVY });
    y += 12;
    for (const f of others) if (y < pdf.height - MARGIN - 40) row(f.name, f.areaHa, '—', '—');
  }
  y += 4;
  pdf.line(tx, y - 8, tx + tw, y - 8, LINE, 0.6);
  row(`${l.sum} · ${all.length} ${l.fields}`, totalHa, String(fields.reduce((s, f) => s + f.zones.length, 0)), '', true);
  footer(pdf, 1);
}

/** Zonation map: an overview page and one page per field with zones, probe numbers and sampling points. */
export function zonationPdf(fields: SheetField[], others: SheetField[], opts: { orgName: string; date: string; logo?: PdfImage | null }): Buffer {
  const l = L;
  const pdf = new PdfDoc(undefined, { logo: opts.logo });
  const date = day(opts.date);
  overviewPage(pdf, l.zonationTitle, opts.orgName, date, fields, others, 2);
  fields.forEach((field, i) => {
    pdf.addPage();
    header(pdf, field.name, `${ha(field.areaHa)} · ${l.zones(field.zones.length)}${field.soilType ? ` · ${l.soilType} ${field.soilType}` : ''}`, date);
    const box = { x: MARGIN, y: MARGIN + 44, w: (pdf.width - 2 * MARGIN) * 0.62, h: pdf.height - 2 * MARGIN - 64 };
    drawFieldMap(pdf, field, box, (z) => hexToRgb(z.color));
    const tx = box.x + box.w + 18;
    const tw = pdf.width - MARGIN - tx;
    zoneTable(
      pdf,
      field.zones,
      tx,
      box.y + 8,
      [
        { label: l.zone, width: tw * 0.46, value: (z) => z.label },
        { label: l.probe, width: tw * 0.22, align: 'right', value: (z) => (z.probeNr != null ? String(z.probeNr) : '—') },
        { label: l.area, width: tw * 0.32, align: 'right', value: (z) => ha(z.areaHa) },
      ],
      pdf.height - MARGIN - 20,
    );
    footer(pdf, i + 2);
  });
  return pdf.toBuffer({ title: l.zonationTitle });
}

/** Results: per field the zones coloured by their pH class and a table of the measured values. */
export function resultsPdf(fields: SheetField[], params: SoilParameter[], opts: { orgName: string; date: string; paramLabel: (p: SoilParameter) => string; logo?: PdfImage | null }): Buffer {
  const l = L;
  const pdf = new PdfDoc(undefined, { logo: opts.logo });
  const date = day(opts.date);
  overviewPage(pdf, l.resultsTitle, opts.orgName, date, fields, [], 2);
  const classKey: Partial<Record<SoilParameter, SoilParameter>> = { ph: 'ph', p2o5: 'p2o5', k2o: 'k2o', mgo: 'mgo' };
  fields.forEach((field, i) => {
    pdf.addPage();
    const sampled = field.zones.map((z) => z.sampledOn).filter((d): d is string => !!d).sort().at(-1);
    header(pdf, field.name, `${ha(field.areaHa)} · ${l.zones(field.zones.length)}${sampled ? ` · ${l.sampledOn} ${day(sampled)}` : ''}`, date);
    const mapBox = { x: MARGIN, y: MARGIN + 44, w: (pdf.width - 2 * MARGIN) * 0.4, h: pdf.height - 2 * MARGIN - 90 };
    drawFieldMap(pdf, field, mapBox, (z) => (z.classes.ph ? STAGE[z.classes.ph] : hexToRgb(z.color)));
    const tx = mapBox.x + mapBox.w + 14;
    const tw = pdf.width - MARGIN - tx;
    const shown = params.filter((p) => field.zones.some((z) => z.values[p] != null)).slice(0, 8);
    const valueWidth = shown.length ? (tw * 0.62) / shown.length : 0;
    zoneTable(
      pdf,
      field.zones,
      tx,
      mapBox.y + 8,
      [
        { label: l.zone, width: tw * 0.2, value: (z) => z.label },
        { label: l.probe, width: tw * 0.08, align: 'right', value: (z) => (z.probeNr != null ? String(z.probeNr) : '—') },
        { label: l.area, width: tw * 0.1, align: 'right', value: (z) => num(z.areaHa, 2) },
        ...shown.map<Column>((p) => ({
          label: `${opts.paramLabel(p)}${SOIL_PARAM_META[p].unit ? ` ${SOIL_PARAM_META[p].unit}` : ''}`,
          width: valueWidth,
          align: 'right',
          value: (z) => (z.values[p] != null ? num(z.values[p]!, SOIL_PARAM_META[p].decimals) : '—'),
          chip: (z) => {
            const key = classKey[p];
            const cls = key ? z.classes[key] : null;
            return cls ? STAGE[cls] : null;
          },
        })),
      ],
      pdf.height - MARGIN - 40,
    );
    let lx = MARGIN;
    const ly = pdf.height - MARGIN - 20;
    pdf.text(l.classes, lx, ly, { size: 7.5, color: GRAY });
    lx += pdf.textWidth(l.classes, 7.5) + 10;
    for (const [stage, color] of Object.entries(STAGE)) {
      pdf.rect(lx, ly - 7, 7, 7, { fill: color });
      pdf.text(stage, lx + 9, ly, { size: 7.5 });
      lx += 22;
    }
    footer(pdf, i + 2);
  });
  return pdf.toBuffer({ title: l.resultsTitle });
}
