import { Injectable } from '@nestjs/common';
import type {
  ProductivityAnalysis,
  ProductivityScene,
  ProductivityState,
  RecalculateProductivityInput,
  Zoning,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { zoneRows } from './zone-rows.js';

interface AnalysisRow {
  id: string;
  field_id: string;
  status: ProductivityAnalysis['status'];
  status_code: ProductivityAnalysis['statusCode'];
  suitability: number | null;
  suitability_status: ProductivityAnalysis['suitabilityStatus'];
  season_count: number | null;
  scene_count: number | null;
  scenes: Omit<ProductivityScene, 'excluded'>[];
  excluded_scene_ids: string[];
  current: boolean;
  created_at: Date;
  finished_at: Date | null;
  error: string | null;
}

/**
 * Productivity analyses are computed by the geospatial worker (backend/agmeo-geo); the API
 * reads them and queues new ones, e.g. with acquisitions excluded by the user.
 */
@Injectable()
export class ProductivityService {
  constructor(private readonly db: Database) {}

  /** The latest analysis; with a field part, its zones are clipped to the part (see zoneRows). */
  state(ctx: Ctx, fieldId: string, fieldPartId?: string): Promise<ProductivityState> {
    return this.db.run(ctx, async (trx) => {
      if (fieldPartId) {
        const part = await trx.selectFrom('field_parts').select('id').where('id', '=', fieldPartId).where('field_id', '=', fieldId).executeTakeFirst();
        if (!part) throw notFound('Field part');
      }
      const { rows } = await sql<AnalysisRow>`
        SELECT a.id, a.field_id, a.status, a.status_code, a.suitability, a.suitability_status, a.season_count,
               a.scene_count, a.scenes, a.excluded_scene_ids, a.created_at, a.finished_at, a.error,
               (a.geometry_version_id = g.id) AS current
        FROM productivity_analyses a
        JOIN field_current_geometry g ON g.field_id = a.field_id
        WHERE a.field_id = ${fieldId}::uuid
        ORDER BY a.created_at DESC
        LIMIT 20`.execute(trx);
      const pending = rows.find((r) => r.current && (r.status === 'queued' || r.status === 'running')) ?? null;
      const done = rows.find((r) => r.status === 'finished' || r.status === 'failed') ?? null;
      return {
        analysis: done ? await this.toAnalysis(trx, done, fieldPartId ? [fieldPartId] : null) : null,
        pending: pending ? { id: pending.id, status: pending.status as 'queued' | 'running', createdAt: iso(pending.created_at) } : null,
      };
    });
  }

  private async toAnalysis(trx: Trx, r: AnalysisRow, partIds: string[] | null): Promise<ProductivityAnalysis> {
    const { rows: list } = await sql<{ id: string; zone_count: number; is_custom: boolean }>`
      SELECT id, zone_count, is_custom FROM zonings WHERE analysis_id = ${r.id}::uuid ORDER BY zone_count, is_custom`.execute(trx);
    const zonings = new Map<string, Zoning>(list.map((z) => [z.id, { id: z.id, zoneCount: z.zone_count, isCustom: z.is_custom, zones: [] }]));
    for (const row of await zoneRows(trx, [...zonings.keys()], partIds)) {
      zonings.get(row.zoning_id)!.zones.push({
        zoneNo: row.zone_no,
        areaHa: row.area_ha,
        sharePct: 0,
        relativeProductivity: row.relative_productivity,
        geometry: JSON.parse(row.geometry) as MultiPolygon,
      });
    }
    for (const zoning of zonings.values()) {
      const total = zoning.zones.reduce((s, z) => s + z.areaHa, 0);
      for (const z of zoning.zones) z.sharePct = total ? round((100 * z.areaHa) / total, 1) : 0;
    }
    const excluded = new Set(r.excluded_scene_ids ?? []);
    return {
      id: r.id,
      fieldId: r.field_id,
      status: r.status,
      statusCode: r.status_code,
      suitability: r.suitability,
      suitabilityStatus: r.suitability_status,
      seasonCount: r.season_count,
      sceneCount: r.scene_count,
      scenes: (r.scenes ?? []).map((s) => ({ ...s, excluded: excluded.has(s.sceneId) })),
      current: r.current,
      createdAt: iso(r.created_at),
      finishedAt: r.finished_at ? iso(r.finished_at) : null,
      error: r.error,
      zonings: [...zonings.values()],
    };
  }

  /** Queues an analysis of the current boundary; a still-queued one is updated instead. */
  request(ctx: Ctx, fieldId: string, input: RecalculateProductivityInput): Promise<ProductivityState> {
    return this.db
      .run(ctx, async (trx) => {
        const field = await trx
          .selectFrom('field_current_geometry as g')
          .innerJoin('fields as f', 'f.id', 'g.field_id')
          .select(['g.id as geometry_version_id', 'f.id'])
          .where('f.id', '=', fieldId)
          .executeTakeFirst();
        if (!field) throw notFound('Field');
        const excluded = [...new Set(input.excludedSceneIds ?? [])];
        const queued = await trx
          .selectFrom('productivity_analyses')
          .select('id')
          .where('field_id', '=', fieldId)
          .where('geometry_version_id', '=', field.geometry_version_id)
          .where('status', '=', 'queued')
          .executeTakeFirst();
        let id: string;
        if (queued) {
          // Still waiting: take the latest exclusions instead of queueing twice.
          await sql`UPDATE productivity_analyses SET excluded_scene_ids = ${excluded}::uuid[] WHERE id = ${queued.id}::uuid`.execute(trx);
          id = queued.id;
        } else {
          const { rows } = await sql<{ id: string }>`
            INSERT INTO productivity_analyses (organization_id, field_id, geometry_version_id, excluded_scene_ids, requested_by)
            VALUES (${ctx.orgId}::uuid, ${fieldId}::uuid, ${field.geometry_version_id}::uuid, ${excluded}::uuid[], ${ctx.userId}::uuid)
            RETURNING id`.execute(trx);
          id = rows[0].id;
        }
        await record(trx, ctx, {
          entityType: 'field',
          entityId: fieldId,
          action: 'productivity.requested',
          changes: { analysisId: id, excludedScenes: excluded.length },
        });
      })
      .then(() => this.state(ctx, fieldId));
  }

  /** The productivity raster of an analysis can only be rendered for its organization. */
  async assertAnalysis(ctx: Ctx, fieldId: string, analysisId: string): Promise<void> {
    const found = await this.db.run(ctx, (trx) =>
      trx
        .selectFrom('productivity_analyses')
        .select('id')
        .where('id', '=', analysisId)
        .where('field_id', '=', fieldId)
        .where('raster_path', 'is not', null)
        .executeTakeFirst(),
    );
    if (!found) throw notFound('Productivity map');
  }
}
