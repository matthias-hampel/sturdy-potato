import { Injectable } from '@nestjs/common';
import {
  BOARD_DONE_DAYS,
  type BoardCard,
  type BulkOperationMetaInput,
  type OperationBoard,
  type OperationBoardQuery,
  type OperationMetaInput,
  type OperationStatus,
  type OperationType,
  type SetOperationStatusInput,
  type TaskPriority,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropColor, cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';

const PLANNED_LIMIT = 500;

/** Operations as a task board: planned, in progress, and completed in the last two weeks. */
@Injectable()
export class BoardService {
  constructor(private readonly db: Database) {}

  board(ctx: Ctx, q: Out<typeof OperationBoardQuery>): Promise<OperationBoard> {
    return this.db.run(ctx, async (trx) => {
      const season = q.from || q.to ? null : await resolveSeason(trx, q.seasonId);
      let base = trx.selectFrom('operations as o').select(['o.id', 'o.status']).where('o.status', '<>', 'canceled');
      const date = sql<string>`coalesce(o.performed_at::date, o.planned_on)`;
      if (q.from) base = base.where(date, '>=', q.from);
      if (q.to) base = base.where(date, '<=', q.to);
      if (season) base = base.where((eb) => eb.or([eb(date, 'is', null), eb.between(date, season.start_date, season.end_date)]));
      if (q.type) base = base.where('o.type', '=', q.type);
      if (q.assigneeEmployeeId) base = base.where('o.responsible_employee_id', '=', q.assigneeEmployeeId);
      if (q.unassigned) base = base.where('o.responsible_employee_id', 'is', null);
      if (q.fieldId) base = base.where('o.id', 'in', (eb) => eb.selectFrom('operation_fields').select('operation_id').where('field_id', '=', q.fieldId!));
      if (q.cropId) {
        base = base.where('o.id', 'in', (eb) =>
          eb.selectFrom('operation_fields as of').innerJoin('crop_cycles as cc', 'cc.id', 'of.crop_cycle_id').select('of.operation_id').where('cc.crop_id', '=', q.cropId!),
        );
      }
      const doneSince = new Date(Date.now() - BOARD_DONE_DAYS * 86_400_000);
      const [planned, inProgress, completed] = await Promise.all([
        base.where('o.status', '=', 'planned').orderBy(sql`o.planned_on nulls last`).limit(PLANNED_LIMIT).execute(),
        base.where('o.status', '=', 'in_progress').execute(),
        base.where('o.status', '=', 'completed').where('o.completed_at', '>=', doneSince).orderBy('o.completed_at', 'desc').execute(),
      ]);
      const cards = await this.cards(trx, [...planned, ...inProgress, ...completed].map((r) => r.id));
      const pick = (rows: { id: string }[]) => rows.flatMap((r) => (cards.has(r.id) ? [cards.get(r.id)!] : []));
      return { planned: pick(planned), in_progress: pick(inProgress), completed: pick(completed) };
    });
  }

  async cards(trx: Trx, ids: string[]): Promise<Map<string, BoardCard>> {
    const out = new Map<string, BoardCard>();
    if (!ids.length) return out;
    const [ops, fields, inputs, equipment, comments] = await Promise.all([
      trx
        .selectFrom('operations as o')
        .leftJoin('employees as e', 'e.id', 'o.responsible_employee_id')
        .select(['o.id', 'o.type', 'o.title', 'o.status', 'o.planned_on', 'o.performed_at', 'o.completed_at', 'o.priority', 'o.due_on', 'o.responsible_employee_id', 'e.name as employee_name', 'o.version'])
        .where('o.id', 'in', ids)
        .execute(),
      trx
        .selectFrom('operation_fields as of')
        .innerJoin('fields as f', 'f.id', 'of.field_id')
        .leftJoin('crop_cycles as cc', 'cc.id', 'of.crop_cycle_id')
        .leftJoin('crops as c', 'c.id', 'cc.crop_id')
        .select(['of.operation_id', 'of.field_id', 'f.name as field_name', 'of.treated_area_ha', cropName<string | null>('c').as('crop_name'), cropColor<string | null>('c').as('crop_color')])
        .where('of.operation_id', 'in', ids)
        .orderBy('f.name')
        .execute(),
      trx.selectFrom('operation_inputs as oi').innerJoin('products as p', 'p.id', 'oi.product_id').select(['oi.operation_id', 'p.name']).where('oi.operation_id', 'in', ids).execute(),
      trx.selectFrom('operation_equipment as q').innerJoin('equipment as eq', 'eq.id', 'q.equipment_id').select(['q.operation_id', 'eq.name']).where('q.operation_id', 'in', ids).execute(),
      trx
        .selectFrom('comments')
        .select(['entity_id', sql<number>`count(*)::int`.as('n')])
        .where('entity_type', '=', 'operation')
        .where('entity_id', 'in', ids)
        .where('deleted_at', 'is', null)
        .groupBy('entity_id')
        .execute(),
    ]);
    const commentCount = new Map(comments.map((c) => [c.entity_id, c.n]));
    for (const o of ops) {
      const of = fields.filter((f) => f.operation_id === o.id);
      const crops = new Map<string, string>();
      for (const f of of) if (f.crop_name) crops.set(f.crop_name, f.crop_color ?? '#9aa392');
      out.set(o.id, {
        id: o.id,
        type: o.type as OperationType,
        title: o.title,
        status: o.status as OperationStatus,
        plannedOn: o.planned_on,
        performedAt: iso(o.performed_at),
        completedAt: iso(o.completed_at),
        priority: o.priority as TaskPriority,
        dueOn: o.due_on,
        assignee: o.responsible_employee_id ? { id: o.responsible_employee_id, name: o.employee_name! } : null,
        crops: [...crops].map(([name, color]) => ({ name, color })),
        fields: [...new Map(of.map((f) => [f.field_id, { id: f.field_id, name: f.field_name }])).values()],
        inputs: [...new Set(inputs.filter((i) => i.operation_id === o.id).map((i) => i.name))],
        equipment: [...new Set(equipment.filter((e) => e.operation_id === o.id).map((e) => e.name))],
        totalAreaHa: round(of.reduce((s, f) => s + f.treated_area_ha, 0), 4),
        commentCount: commentCount.get(o.id) ?? 0,
        version: o.version,
      });
    }
    return out;
  }

  /** Title, priority, due date and assignee: board metadata that never changes stock or costs. */
  updateMeta(ctx: Ctx, id: string, input: Out<typeof OperationMetaInput>): Promise<BoardCard> {
    return this.db.run(ctx, async (trx) => {
      await this.applyMeta(trx, ctx, [id], input);
      return (await this.cards(trx, [id])).get(id)!;
    });
  }

  bulkMeta(ctx: Ctx, input: Out<typeof BulkOperationMetaInput>): Promise<BoardCard[]> {
    return this.db.run(ctx, async (trx) => {
      await this.applyMeta(trx, ctx, input.operationIds, input);
      return [...(await this.cards(trx, input.operationIds)).values()];
    });
  }

  private async applyMeta(trx: Trx, ctx: Ctx, ids: string[], input: Out<typeof OperationMetaInput>) {
    if (input.responsibleEmployeeId) {
      const e = await trx.selectFrom('employees').select('id').where('id', '=', input.responsibleEmployeeId).executeTakeFirst();
      if (!e) throw notFound('Employee');
    }
    const values = { title: input.title, priority: input.priority, due_on: input.dueOn, responsible_employee_id: input.responsibleEmployeeId };
    for (const id of ids) {
      const before = await trx.selectFrom('operations').select(['title', 'priority', 'due_on', 'responsible_employee_id']).where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Operation');
      await trx.updateTable('operations').set(values).where('id', '=', id).execute();
      const changes = diff(before, values);
      if (Object.keys(changes).length) {
        await record(trx, ctx, { entityType: 'operation', entityId: id, action: 'task_updated', changes, event: { type: 'operation.updated', payload: { operationId: id } } });
      }
    }
  }

  /** Moves an open operation between planned and in progress. */
  setStatus(ctx: Ctx, id: string, input: Out<typeof SetOperationStatusInput>): Promise<BoardCard> {
    return this.db.run(ctx, async (trx) => {
      const op = await trx.selectFrom('operations').select(['status', 'version']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!op) throw notFound('Operation');
      if (op.version !== input.version) throw conflict('version_conflict', 'The operation was changed in the meantime; reload and try again');
      if (op.status !== 'planned' && op.status !== 'in_progress') {
        throw badRequest('invalid_status_change', op.status === 'completed' ? 'Reopen the completed operation instead' : 'A canceled operation cannot be started');
      }
      if (op.status !== input.status) {
        await trx.updateTable('operations').set({ status: input.status, version: op.version + 1 }).where('id', '=', id).execute();
        await record(trx, ctx, {
          entityType: 'operation',
          entityId: id,
          action: input.status === 'in_progress' ? 'started' : 'unstarted',
          changes: { status: { from: op.status, to: input.status } },
          event: { type: 'operation.updated', payload: { operationId: id, status: input.status } },
        });
      }
      return (await this.cards(trx, [id])).get(id)!;
    });
  }
}
