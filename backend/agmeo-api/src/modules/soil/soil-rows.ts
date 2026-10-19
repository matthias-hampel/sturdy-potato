import {
  isSoilParameter,
  PH_METHODS,
  type PhMethod,
  type SoilParameter,
  type SoilTexture,
  type SoilZonation,
  type SoilZone,
  soilClassOf,
  type ZoneLabExtras,
} from '@agmeo/contracts';
import type { MultiPolygon, Point } from 'geojson';
import { sql } from 'kysely';
import { iso } from '../../core/mappers.js';
import type { Trx } from '../../db/database.js';
import { kClass, mgClass, pClass, phClass } from '../nutrients/lib/base-fertilization.js';

export interface ZoneRow {
  id: string;
  zonation_id: string;
  zone_no: number;
  label: string;
  color: string;
  area_ha: number;
  probe_nr: number | null;
  mean_value: number | null;
  geojson: MultiPolygon;
  point: Point | null;
  properties: Record<string, unknown>;
  property_methods: Record<string, unknown>;
  property_dates: Record<string, unknown>;
  lab_extras: ZoneLabExtras | null;
}

export interface ZonationRow {
  id: string;
  field_id: string;
  method: string;
  source: string;
  params: Record<string, unknown>;
  zone_count: number | null;
  status: string;
  status_code: string | null;
  error: string | null;
  scene_date: string | null;
  batch_id: string | null;
  created_at: Date;
  finished_at: Date | null;
  superseded_at: Date | null;
  sampled_on?: string | null;
}

/** Only numbers (or numeric strings) of known parameters are values; nothing else is published. */
export function zoneValues(raw: unknown): Partial<Record<SoilParameter, number>> {
  const out: Partial<Record<SoilParameter, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSoilParameter(k)) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function zoneStrings(raw: unknown): Partial<Record<SoilParameter, string>> {
  const out: Partial<Record<SoilParameter, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isSoilParameter(k) && typeof v === 'string' && v) out[k] = v;
  return out;
}

/** VDLUFA content classes of a zone's values, with the rules nutrient planning uses. */
export function zoneClasses(values: Partial<Record<SoilParameter, number>>, methods: Partial<Record<SoilParameter, string>>, texture: SoilTexture | null): SoilZone['classes'] {
  const soil = soilClassOf(texture);
  const phMethod = (PH_METHODS as readonly string[]).includes(methods.ph ?? '') ? (methods.ph as PhMethod) : null;
  return {
    ph: values.ph != null ? phClass(values.ph, phMethod, soil, values.humus ?? null) : null,
    p: values.p2o5 != null ? pClass(values.p2o5) : null,
    k: values.k2o != null ? kClass(values.k2o, soil) : null,
    mg: values.mgo != null ? mgClass(values.mgo, soil) : null,
  };
}

export function zoneOut(r: ZoneRow, texture: SoilTexture | null): SoilZone {
  const values = zoneValues(r.properties);
  const methods = zoneStrings(r.property_methods);
  return {
    id: r.id,
    zoneNo: r.zone_no,
    label: r.label,
    color: r.color,
    areaHa: Number(r.area_ha),
    probeNr: r.probe_nr,
    meanValue: r.mean_value,
    geometry: r.geojson,
    samplePoint: r.point ? (r.point.coordinates.slice(0, 2) as [number, number]) : null,
    values,
    methods,
    dates: zoneStrings(r.property_dates),
    lab: r.lab_extras,
    classes: zoneClasses(values, methods, texture),
  };
}

export function zonationOut(r: ZonationRow): SoilZonation {
  return {
    id: r.id,
    fieldId: r.field_id,
    method: r.method as SoilZonation['method'],
    source: r.source,
    params: r.params ?? {},
    zoneCount: r.zone_count,
    status: r.status as SoilZonation['status'],
    statusCode: r.status_code,
    error: r.error,
    sceneDate: r.scene_date,
    batchId: r.batch_id,
    createdAt: iso(r.created_at),
    finishedAt: iso(r.finished_at),
    supersededAt: iso(r.superseded_at),
    active: r.status === 'ready' && r.superseded_at == null,
    sampledOn: r.sampled_on ?? null,
  };
}

export const ZONE_COLUMNS = sql`z.id, z.zonation_id, z.zone_no, z.label, z.color, z.area_ha, z.probe_nr, z.mean_value,
  ST_AsGeoJSON(z.geometry, 7)::json AS geojson, ST_AsGeoJSON(z.sample_point, 7)::json AS point,
  z.properties, z.property_methods, z.property_dates, z.lab_extras`;

export async function zonesOf(trx: Trx, zonationIds: string[]): Promise<ZoneRow[]> {
  if (!zonationIds.length) return [];
  const { rows } = await sql<ZoneRow>`
    SELECT ${ZONE_COLUMNS} FROM soil_zones z
    WHERE z.zonation_id = ANY(${zonationIds}::uuid[])
    ORDER BY z.zonation_id, z.zone_no`.execute(trx);
  return rows;
}

export const ZONATION_COLUMNS = sql`n.id, n.field_id, n.method, n.source, n.params, n.zone_count, n.status, n.status_code, n.error,
  n.scene_date, n.batch_id, n.created_at, n.finished_at, n.superseded_at,
  (SELECT max(d.value) FROM soil_zones s, jsonb_each_text(s.property_dates) d WHERE s.zonation_id = n.id) AS sampled_on`;
