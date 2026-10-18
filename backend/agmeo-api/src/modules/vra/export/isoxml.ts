import type { VraRateUnit } from '@agmeo/contracts';
import type { MultiPolygon, Polygon, Position } from 'geojson';

/**
 * Setpoint process data per rate unit (ISO 11783-11 DDIs) and the factor from the per-hectare
 * rate to the DDI's integer value, with the value presentation that shows it per hectare again.
 */
const PROCESS_DATA: Record<VraRateUnit, { ddi: string; factor: number; scale: string; decimals: number }> = {
  // DDI 6, Setpoint Mass Per Area Application Rate, 1 mg/m²: 1 kg/ha = 100 mg/m².
  'kg/ha': { ddi: '0006', factor: 100, scale: '0.01', decimals: 2 },
  // DDI 1, Setpoint Volume Per Area Application Rate, 0.01 mm³/m²: 1 l/ha = 100 mm³/m².
  'l/ha': { ddi: '0001', factor: 10_000, scale: '0.0001', decimals: 2 },
  // DDI 11, Setpoint Count Per Area Application Rate, 0.001 /m²: 1 seed/ha = 0.0001 /m².
  'seeds/ha': { ddi: '000B', factor: 0.1, scale: '10', decimals: 0 },
};

export interface TaskDataInput {
  productName: string;
  unit: VraRateUnit;
  standardRate: number | null;
}

export interface TaskData {
  customer: string;
  farm: string;
  field: { name: string; areaM2: number; boundary: Polygon | MultiPolygon };
  task: string;
  inputs: TaskDataInput[];
  /** Rates per hectare in the order of `inputs`. */
  zones: { zoneNo: number; geometry: MultiPolygon; rates: number[] }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (a: Record<string, string | number>) =>
  Object.entries(a)
    .map(([k, v]) => ` ${k}="${typeof v === 'string' ? esc(v) : v}"`)
    .join('');

function polygons(geometry: Polygon | MultiPolygon, type: number, designator: string): string {
  const list = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const ring = (coords: Position[], exterior: boolean) =>
    `<LSG A="${exterior ? 1 : 2}">${coords.map(([lon, lat]) => `<PNT A="2" C="${lat.toFixed(9)}" D="${lon.toFixed(9)}"/>`).join('')}</LSG>`;
  return list.map((p) => `<PLN${attrs({ A: type, B: designator })}>${p.map((r, i) => ring(r, i === 0)).join('')}</PLN>`).join('\n');
}

/**
 * ISO 11783-10 task data with one planned task whose treatment zones carry the setpoint rates:
 * zone 0 outside the field (rate 0), one zone per VRA zone with its polygons, and a zone with the
 * standard rates for lost positioning.
 */
export function taskDataXml(t: TaskData): string {
  const products = t.inputs.map((input, i) => ({ ...input, ...PROCESS_DATA[input.unit], pdt: `PDT${i + 1}`, vpn: `VPN${i + 1}` }));
  const pdv = (rates: (number | null)[]) =>
    products
      .map((p, i) => `<PDV${attrs({ A: p.ddi, B: Math.round((rates[i] ?? 0) * p.factor), C: p.pdt, E: p.vpn })}/>`)
      .join('');
  const lostCode = t.zones.length + 1;
  const zones = [
    `<TZN A="0" B="Outside field">${pdv(products.map(() => 0))}</TZN>`,
    ...t.zones.map((z) => `<TZN${attrs({ A: z.zoneNo, B: `Zone ${z.zoneNo}` })}>\n${polygons(z.geometry, 2, `Zone ${z.zoneNo}`)}\n${pdv(z.rates)}</TZN>`),
    `<TZN${attrs({ A: lostCode, B: 'Standard rate' })}>${pdv(products.map((p) => p.standardRate))}</TZN>`,
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ISO11783_TaskData${attrs({ VersionMajor: 4, VersionMinor: 3, ManagementSoftwareManufacturer: 'agmeo', ManagementSoftwareVersion: '1.0', DataTransferOrigin: 1 })}>`,
    `<CTR${attrs({ A: 'CTR1', B: t.customer })}/>`,
    `<FRM${attrs({ A: 'FRM1', B: t.farm, I: 'CTR1' })}/>`,
    `<PFD${attrs({ A: 'PFD1', C: t.field.name, D: Math.round(t.field.areaM2), E: 'CTR1', F: 'FRM1' })}>`,
    polygons(t.field.boundary, 1, t.field.name),
    '</PFD>',
    ...products.map((p) => `<PDT${attrs({ A: p.pdt, B: p.productName })}/>`),
    ...products.map((p) => `<VPN${attrs({ A: p.vpn, B: 0, C: p.scale, D: p.decimals, E: p.unit })}/>`),
    `<TSK${attrs({ A: 'TSK1', B: t.task, C: 'CTR1', D: 'FRM1', E: 'PFD1', G: 1, I: lostCode, J: 0 })}>`,
    ...zones,
    '</TSK>',
    '</ISO11783_TaskData>',
    '',
  ].join('\n');
}
