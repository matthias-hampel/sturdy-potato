import { exportRate, VRA_IMPERIAL, type VraMap, type VraMapInputView, type VraRateUnit, type VraUnitSystem } from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { round } from '../../../core/mappers.js';
import type { TaskDataTask } from './isoxml.js';
import { polygonShapefile, type DbfField } from './shapefile.js';
import type { ZipEntry } from './zip.js';

/** What a prescription needs besides the map: names and the field boundary. */
export interface PrescriptionMeta {
  field: string;
  farm: string;
  organization: string;
  boundary: Polygon | MultiPolygon;
  areaHa: number;
}

/** The map fields a prescription reads (a loaded map, or a test fixture). */
export type PrescriptionMap = Pick<VraMap, 'title' | 'type' | 'unitSystem' | 'inputs' | 'zones'>;

/**
 * The export chain of one input (reference createGeojson): the zone rate as the terminal gets it —
 * a target stand divided by germination once, then per acre for imperial maps.
 */
export function terminalRate(input: Pick<VraMapInputView, 'unit' | 'germinationPct'>, rate: number, system: VraUnitSystem): { rate: number; unit: string } {
  const sent = exportRate(rate, input.unit, input.germinationPct);
  if (system !== 'imperial') return { rate: sent.rate, unit: sent.unit };
  return { rate: round(sent.rate * VRA_IMPERIAL[sent.unit].factor, 2), unit: VRA_IMPERIAL[sent.unit].unit };
}

/** The unit the terminal receives for an input (seeds/ha for a target stand with germination). */
export const terminalUnit = (input: Pick<VraMapInputView, 'unit' | 'germinationPct'>): VraRateUnit => exportRate(1, input.unit, input.germinationPct).unit;

/** A single-input map has one RATE column; several inputs keep their own column names. */
export const rateColumns = (map: PrescriptionMap) => map.inputs.map((i) => (map.type === 'several' ? i.columnName : 'RATE'));

const productOf = (i: VraMapInputView) => i.productName ?? (i.name || i.cropName || i.inputType);

function zoneValues(map: PrescriptionMap, zoneNo: number) {
  const columns = rateColumns(map);
  return Object.fromEntries(map.inputs.map((i, k) => [columns[k], terminalRate(i, i.rates[String(zoneNo)] ?? 0, map.unitSystem).rate]));
}

/** GeoJSON prescription: one feature per zone with the rate column(s), unit and product. */
export function prescriptionGeojson(map: PrescriptionMap, meta: Pick<PrescriptionMeta, 'field'>, name: string) {
  const columns = rateColumns(map);
  const single = map.inputs.length === 1 ? map.inputs[0] : null;
  return {
    type: 'FeatureCollection' as const,
    name,
    properties: {
      title: map.title,
      type: map.type,
      field: meta.field,
      units: Object.fromEntries(map.inputs.map((i, k) => [columns[k], terminalRate(i, 0, map.unitSystem).unit])),
      inputs: map.inputs.map((i, k) => ({ column: columns[k], name: i.name || i.cropName, unit: terminalRate(i, 0, map.unitSystem).unit, germinationPct: i.germinationPct })),
    },
    features: map.zones.map((z) => ({
      type: 'Feature' as const,
      geometry: z.geometry,
      properties: {
        ZONE: z.zoneNo,
        AREA_HA: z.areaHa,
        ...zoneValues(map, z.zoneNo),
        ...(single ? { UNIT: terminalRate(single, 0, map.unitSystem).unit, PRODUCT: productOf(single) } : {}),
      } as Record<string, number | string>,
    })),
  };
}

/** Shapefile set (.shp .shx .dbf .prj .cpg) of a map, named `name`, under `folder` when given. */
export function prescriptionShapefile(map: PrescriptionMap, name: string, folder = ''): ZipEntry[] {
  const columns = rateColumns(map);
  const single = map.inputs.length === 1 ? map.inputs[0] : null;
  const counts = (i: VraMapInputView) => ['seeds/ha', 'plants/ha'].includes(terminalUnit(i)) && map.unitSystem === 'metric';
  const fields: DbfField[] = [
    ...map.inputs.map((i, k) => ({ name: columns[k], length: 14, decimals: counts(i) ? 0 : 2 })),
    { name: 'ZONE', length: 2, decimals: 0 },
    { name: 'AREA_HA', length: 12, decimals: 4 },
    ...(single ? [{ name: 'UNIT', length: 12, decimals: 0, type: 'C' as const }, { name: 'PRODUCT', length: 40, decimals: 0, type: 'C' as const }] : []),
  ];
  const shape = polygonShapefile(
    fields,
    map.zones.map((z) => ({
      geometry: z.geometry,
      values: {
        ZONE: z.zoneNo,
        AREA_HA: z.areaHa,
        ...zoneValues(map, z.zoneNo),
        ...(single ? { UNIT: terminalRate(single, 0, map.unitSystem).unit, PRODUCT: productOf(single) } : {}),
      },
    })),
  );
  const at = folder ? `${folder}/` : '';
  return [
    { name: `${at}${name}.shp`, data: shape.shp },
    { name: `${at}${name}.shx`, data: shape.shx },
    { name: `${at}${name}.dbf`, data: shape.dbf },
    { name: `${at}${name}.prj`, data: shape.prj },
    { name: `${at}${name}.cpg`, data: shape.cpg },
  ];
}

/** The ISO-XML task of a map; ISO-XML always uses SI process data, whatever the display units. */
export function prescriptionTask(map: PrescriptionMap, meta: PrescriptionMeta): TaskDataTask {
  return {
    farm: meta.farm,
    field: { name: meta.field, areaM2: meta.areaHa * 10_000, boundary: meta.boundary },
    task: map.title,
    inputs: map.inputs.map((i) => ({
      productName: productOf(i),
      unit: terminalUnit(i),
      standardRate: i.standardRate == null ? null : exportRate(i.standardRate, i.unit, i.germinationPct).rate,
    })),
    zones: map.zones.map((z) => ({
      zoneNo: z.zoneNo,
      geometry: z.geometry as MultiPolygon,
      rates: map.inputs.map((i) => exportRate(i.rates[String(z.zoneNo)] ?? 0, i.unit, i.germinationPct).rate),
    })),
  };
}
