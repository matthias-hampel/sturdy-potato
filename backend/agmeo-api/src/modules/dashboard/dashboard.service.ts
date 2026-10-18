import { Injectable } from '@nestjs/common';
import type { Dashboard, DashboardOperation, OperationStatus, OperationType } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { today } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { resolveSeason } from '../crops/seasons.js';
import { TasksService } from '../tasks/tasks.service.js';
import { TeamService } from '../team/team.service.js';

/** Action-oriented overview: what needs attention today. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly team: TeamService,
    private readonly compliance: ComplianceService,
  ) {}

  async get(ctx: Ctx, seasonId?: string): Promise<Dashboard> {
    const dashboard = await this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx, seasonId);
      const now = today();

      const totals = await trx
        .selectFrom('fields as f')
        .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select([sql<number>`count(*)`.as('fields'), sql<number>`coalesce(sum(g.area_ha), 0)`.as('area')])
        .where('f.status', '=', 'active')
        .executeTakeFirstOrThrow();
      const farms = await trx
        .selectFrom('farms')
        .select(sql<number>`count(*)`.as('n'))
        .where('archived_at', 'is', null)
        .executeTakeFirstOrThrow();

      const crops = season
        ? (
            await sql<{ crop_id: string; name: string; color: string; area: number }>`
              SELECT c.id AS crop_id, coalesce(c.name_de, c.name) AS name, c.color, sum(coalesce(cc.area_ha, fp.area_ha, g.area_ha)) AS area
              FROM crop_cycles cc
              JOIN crops c ON c.id = cc.crop_id
              JOIN fields f ON f.id = cc.field_id AND f.status = 'active'
              LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
              LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
              WHERE cc.season_id = ${season.id}
              GROUP BY c.id ORDER BY area DESC`.execute(trx)
          ).rows
        : [];

      const openTasks = await trx
        .selectFrom('tasks')
        .select(sql<number>`count(*)`.as('n'))
        .where('status', 'in', ['open', 'in_progress'])
        .executeTakeFirstOrThrow();

      const in14 = new Date(Date.parse(now) + 14 * 86_400_000).toISOString().slice(0, 10);
      const upcoming = await this.operations(trx, (q) =>
        q.where('o.status', 'in', ['planned', 'in_progress']).where('o.planned_on', '>=', now).where('o.planned_on', '<=', in14).orderBy('o.planned_on'),
      );
      const overdue = await this.operations(trx, (q) =>
        q.where('o.status', 'in', ['planned', 'in_progress']).where('o.planned_on', '<', now).orderBy('o.planned_on'),
      );

      const { rows: lowStock } = await sql<{ id: string; name: string; stock: number; threshold: number; base_unit: string }>`
        SELECT p.id, p.name, coalesce(sum(m.quantity_delta), 0) AS stock, p.low_stock_threshold AS threshold, p.base_unit
        FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
        WHERE p.archived_at IS NULL AND p.low_stock_threshold IS NOT NULL
        GROUP BY p.id
        HAVING coalesce(sum(m.quantity_delta), 0) <= p.low_stock_threshold
        ORDER BY p.name`.execute(trx);

      const equipment = await this.team.queryEquipment(trx, {});
      const hasCycle = await trx.selectFrom('crop_cycles').select('id').limit(1).executeTakeFirst();

      return {
        season: season ? { id: season.id, name: season.name } : null,
        farmCount: Number(farms.n),
        fieldCount: Number(totals.fields),
        totalAreaHa: Number(totals.area),
        plantedAreaHa: crops.reduce((s, c) => s + Number(c.area ?? 0), 0),
        cropsByArea: crops.map((c) => ({ cropId: c.crop_id, cropName: c.name, color: c.color, areaHa: Number(c.area ?? 0) })),
        openTaskCount: Number(openTasks.n),
        overdueTasks: await this.tasks.query(trx, { overdueOnly: true, limit: 10 }),
        upcomingOperations: upcoming,
        overdueOperations: overdue,
        lowStock: lowStock.map((p) => ({ productId: p.id, name: p.name, stock: p.stock, threshold: p.threshold, baseUnit: p.base_unit })),
        maintenanceDue: equipment
          .filter((e) => e.status !== 'retired' && e.nextMaintenance?.overdue)
          .map((e) => ({ equipmentId: e.id, name: e.name, dueOn: e.nextMaintenance!.dueOn, dueHours: e.nextMaintenance!.dueHours })),
        complianceIssueCount: 0,
        setup: {
          hasFarm: Number(farms.n) > 0,
          hasFields: Number(totals.fields) > 0,
          hasSeason: season != null,
          hasCropCycles: hasCycle != null,
        },
      };
    });
    const report = await this.compliance.report(ctx, dashboard.season?.id);
    return { ...dashboard, complianceIssueCount: report.issues.length };
  }

  private async operations(
    trx: Trx,
    filter: (q: ReturnType<DashboardService['baseOperations']>) => ReturnType<DashboardService['baseOperations']>,
  ): Promise<DashboardOperation[]> {
    const rows = await filter(this.baseOperations(trx)).limit(10).execute();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as OperationType,
      status: r.status as OperationStatus,
      plannedOn: r.planned_on,
      fieldNames: r.field_names ?? [],
    }));
  }

  private baseOperations(trx: Trx) {
    return trx
      .selectFrom('operations as o')
      .select([
        'o.id',
        'o.title',
        'o.type',
        'o.status',
        'o.planned_on',
        (eb) =>
          eb
            .selectFrom('operation_fields as of')
            .innerJoin('fields as f', 'f.id', 'of.field_id')
            .select(sql<string[]>`array_agg(f.name ORDER BY f.name)`.as('names'))
            .whereRef('of.operation_id', '=', 'o.id')
            .as('field_names'),
      ]);
  }
}
