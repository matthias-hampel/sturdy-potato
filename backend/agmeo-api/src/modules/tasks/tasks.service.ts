import { Injectable } from '@nestjs/common';
import {
  OPERATION_TYPE_LABELS,
  type OperationStatus,
  type PlanTaskOperationInput,
  type Task,
  type TaskInput,
  type TaskListQuery,
  type TaskPriority,
  type TaskStatus,
  type TaskSync,
  type UpdateTaskInput,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { OperationsService } from '../operations/operations.service.js';

@Injectable()
export class TasksService {
  constructor(
    private readonly db: Database,
    private readonly operations: OperationsService,
  ) {}

  list(ctx: Ctx, q: Out<typeof TaskListQuery>): Promise<Task[]> {
    return this.db.run(ctx, (trx) => this.query(trx, q));
  }

  async query(trx: Trx, q: Out<typeof TaskListQuery> & { ids?: string[]; overdueOnly?: boolean; limit?: number }): Promise<Task[]> {
    let query = trx
      .selectFrom('tasks as t')
      .innerJoin('farms as fa', 'fa.id', 't.farm_id')
      .leftJoin('fields as f', 'f.id', 't.field_id')
      .leftJoin('operations as o', 'o.id', 't.operation_id')
      .leftJoin('employees as e', 'e.id', 't.assignee_employee_id')
      .selectAll('t')
      .select(['fa.name as farm_name', 'f.name as field_name', 'o.title as operation_title', 'o.status as operation_status', 'e.name as assignee_name'])
      .select((eb) =>
        eb
          .selectFrom('comments as cm')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('cm.entity_type', '=', 'task')
          .whereRef('cm.entity_id', '=', 't.id')
          .where('cm.deleted_at', 'is', null)
          .as('comment_count'),
      )
      .where('t.deleted_at', 'is', null)
      .orderBy(sql`t.status IN ('done', 'canceled')`)
      .orderBy('t.due_on', (ob) => ob.asc().nullsLast())
      .orderBy(sql`array_position(array['urgent','high','normal','low'], t.priority)`)
      .limit(q.limit ?? 1000);
    if (q.ids) query = query.where('t.id', 'in', q.ids.length ? q.ids : ['00000000-0000-0000-0000-000000000000']);
    if (q.status === 'active') query = query.where('t.status', 'in', ['open', 'in_progress']);
    else if (q.status) query = query.where('t.status', '=', q.status);
    if (q.farmId) query = query.where('t.farm_id', '=', q.farmId);
    if (q.fieldId) query = query.where('t.field_id', '=', q.fieldId);
    if (q.assigneeEmployeeId) query = query.where('t.assignee_employee_id', '=', q.assigneeEmployeeId);
    if (q.from) query = query.where('t.due_on', '>=', q.from);
    if (q.to) query = query.where('t.due_on', '<=', q.to);
    const now = today();
    if (q.overdueOnly) query = query.where('t.due_on', '<', now).where('t.status', 'in', ['open', 'in_progress']);
    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      farmName: r.farm_name,
      field: r.field_id ? { id: r.field_id, name: r.field_name! } : null,
      operation: r.operation_id ? { id: r.operation_id, title: r.operation_title!, status: r.operation_status as OperationStatus } : null,
      title: r.title,
      description: r.description,
      assignee: r.assignee_employee_id ? { id: r.assignee_employee_id, name: r.assignee_name! } : null,
      dueOn: r.due_on,
      priority: r.priority as TaskPriority,
      status: r.status as TaskStatus,
      overdue: r.due_on != null && r.due_on < now && (r.status === 'open' || r.status === 'in_progress'),
      completedAt: iso(r.completed_at),
      commentCount: r.comment_count ?? 0,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    }));
  }

  /** Tasks changed since `since` (all when left out) and the ids of tasks deleted since then. */
  sync(ctx: Ctx, since?: string): Promise<TaskSync> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ now: Date }>`SELECT now() AS now`.execute(trx);
      let changed = trx.selectFrom('tasks').select('id').where('deleted_at', 'is', null);
      if (since) changed = changed.where('updated_at', '>', new Date(since));
      const ids = (await changed.execute()).map((r) => r.id);
      const deleted = since
        ? (await trx.selectFrom('tasks').select('id').where('deleted_at', 'is not', null).where('deleted_at', '>', new Date(since)).execute()).map((r) => r.id)
        : [];
      return { tasks: ids.length ? await this.query(trx, { ids }) : [], deleted, serverTime: rows[0].now.toISOString() };
    });
  }

  private async getIn(trx: Trx, id: string): Promise<Task> {
    const [task] = await this.query(trx, { ids: [id] });
    if (!task) throw notFound('Task');
    return task;
  }

  private async assertField(trx: Trx, farmId: string, fieldId?: string | null) {
    if (!fieldId) return;
    const field = await trx.selectFrom('fields').select('farm_id').where('id', '=', fieldId).executeTakeFirst();
    if (!field) throw notFound('Field');
    if (field.farm_id !== farmId) throw badRequest('field_farm_mismatch', 'The field belongs to another farm');
  }

  create(ctx: Ctx, input: Out<typeof TaskInput>): Promise<Task> {
    return this.db.run(ctx, async (trx) => {
      await this.assertField(trx, input.farmId, input.fieldId);
      const { id } = await trx
        .insertInto('tasks')
        .values({
          organization_id: ctx.orgId,
          farm_id: input.farmId,
          field_id: input.fieldId ?? null,
          title: input.title,
          description: input.description ?? null,
          assignee_employee_id: input.assigneeEmployeeId ?? null,
          due_on: input.dueOn ?? null,
          priority: input.priority,
          status: input.status,
          completed_at: input.status === 'done' ? new Date() : null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, {
        entityType: 'task',
        entityId: id,
        action: 'created',
        changes: { title: input.title },
        event: { type: 'task.created', payload: { taskId: id, assigneeEmployeeId: input.assigneeEmployeeId ?? null, dueOn: input.dueOn ?? null } },
      });
      return this.getIn(trx, id);
    });
  }

  update(ctx: Ctx, id: string, input: Out<typeof UpdateTaskInput>): Promise<Task> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('tasks').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!before) throw notFound('Task');
      await this.assertField(trx, input.farmId ?? before.farm_id, input.fieldId === undefined ? before.field_id : input.fieldId);

      if (input.status === 'done' && before.operation_id) {
        const op = await trx.selectFrom('operations').select('status').where('id', '=', before.operation_id).executeTakeFirst();
        if (op && op.status !== 'completed' && op.status !== 'canceled') {
          throw conflict('operation_open', 'Complete the linked operation to finish this task');
        }
      }
      const values = {
        farm_id: input.farmId,
        field_id: input.fieldId,
        title: input.title,
        description: input.description,
        assignee_employee_id: input.assigneeEmployeeId,
        due_on: input.dueOn,
        priority: input.priority,
        status: input.status,
      };
      const completed_at = input.status === undefined ? before.completed_at : input.status === 'done' ? (before.completed_at ?? new Date()) : null;
      await trx.updateTable('tasks').set({ ...values, completed_at }).where('id', '=', id).execute();
      await record(trx, ctx, {
        entityType: 'task',
        entityId: id,
        action: input.status && input.status !== before.status ? `status_${input.status}` : 'updated',
        changes: diff(before, values),
        event: { type: 'task.updated', payload: { taskId: id, status: input.status ?? before.status } },
      });
      return this.getIn(trx, id);
    });
  }

  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      // Soft delete: syncing clients learn about it through the tombstone.
      const res = await trx.updateTable('tasks').set({ deleted_at: sql<Date>`now()` }).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Task');
      await record(trx, ctx, { entityType: 'task', entityId: id, action: 'deleted' });
    });
  }

  /** Creates a planned operation from the task so the work is recorded without re-entry. */
  planOperation(ctx: Ctx, id: string, input: Out<typeof PlanTaskOperationInput>) {
    return this.db.run(ctx, async (trx) => {
      const task = await trx.selectFrom('tasks').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!task) throw notFound('Task');
      if (task.operation_id) throw conflict('already_planned', 'This task already has an operation');
      if (!task.field_id) throw badRequest('task_without_field', 'Assign a field to the task before planning an operation');
      const op = await this.operations.createIn(
        trx,
        ctx,
        {
          farmId: task.farm_id,
          type: input.type,
          title: task.title || OPERATION_TYPE_LABELS[input.type],
          status: 'planned',
          plannedOn: task.due_on,
          responsibleEmployeeId: task.assignee_employee_id,
          notes: task.description,
          details: {},
          fields: [{ fieldId: task.field_id }],
          inputs: [],
          labor: [],
          equipment: [],
        },
        id,
      );
      await trx.updateTable('tasks').set({ status: task.status === 'open' ? 'in_progress' : task.status }).where('id', '=', id).execute();
      return op;
    });
  }
}
