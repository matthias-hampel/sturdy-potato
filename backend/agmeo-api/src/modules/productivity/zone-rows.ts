import { sql } from 'kysely';
import type { Trx } from '../../db/database.js';

export interface ZoneRow {
  zoning_id: string;
  zone_no: number;
  area_ha: number;
  relative_productivity: number | null;
  /** GeoJSON MultiPolygon. */
  geometry: string;
}

/**
 * The zones of zonings. With field parts given, each zone is clipped to the parts and its area
 * recomputed, and zones outside them (or slivers under 1 m²) are left out: a crop on a part is
 * optimized and spread on that part only. Relative productivity stays that of the whole zone.
 */
export async function zoneRows(trx: Trx, zoningIds: string[], partIds: string[] | null, precision = 7): Promise<ZoneRow[]> {
  if (!zoningIds.length) return [];
  if (!partIds) {
    const { rows } = await sql<ZoneRow>`
      SELECT zoning_id, zone_no, area_ha, relative_productivity, ST_AsGeoJSON(geometry, ${precision}::int) AS geometry
      FROM zoning_zones WHERE zoning_id = ANY(${zoningIds}::uuid[])
      ORDER BY zoning_id, zone_no`.execute(trx);
    return rows;
  }
  const { rows } = await sql<ZoneRow>`
    WITH clip AS (SELECT ST_Union(geometry) AS g FROM field_parts WHERE id = ANY(${partIds}::uuid[])),
    c AS (
      SELECT zz.zoning_id, zz.zone_no, zz.relative_productivity,
             ST_Multi(ST_CollectionExtract(ST_Intersection(zz.geometry, clip.g), 3)) AS g
      FROM zoning_zones zz CROSS JOIN clip
      WHERE zz.zoning_id = ANY(${zoningIds}::uuid[]) AND ST_Intersects(zz.geometry, clip.g))
    SELECT zoning_id, zone_no, round((ST_Area(g::geography) / 10000)::numeric, 4) AS area_ha, relative_productivity,
           ST_AsGeoJSON(g, ${precision}::int) AS geometry
    FROM c WHERE ST_Area(g::geography) >= 1
    ORDER BY zoning_id, zone_no`.execute(trx);
  return rows;
}
