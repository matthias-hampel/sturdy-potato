import { Injectable } from '@nestjs/common';
import {
  can,
  type ApplicationTechnique,
  type BaseUnit,
  type CancelOperationInput,
  type CompleteOperationInput,
  type FertilizerType,
  nutrientKgPerHa,
  type NutrientRates,
  sumNutrients,
  type Operation,
  type OperationInput,
  type OperationListQuery,
  type OperationStatus,
  type OperationType,
  type ProductCategory,
  type ReopenOperationInput,
  type StockShortage,
  type TaskPriority,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { dateIn, iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { writeOperationEmissions } from '../carbon/ledger.js';
import { cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';

type Input = Out<typeof OperationInput>;

/**
 * Field operations are the central transactional records (ADR-004). Planned operations
 * have no side effects. Completion atomically records stock consumption, cost entries,
 * the audit event and an outbox event; each completion is numbered (completion_seq) and
 * unique indexes make its side effects exactly-once. Reopening a completed operation
 * appends compensating entries instead of deleting history.
 */
@Injectable()
export class OperationsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, q: Out<typeof OperationListQuery>): Promise<Operation[]> {
    return this.db.run(ctx, async (trx) => {
      let query = trx.selectFrom('operations as o').select('o.id');
      if (q.status) query = query.where('o.status', '=', q.status);
      if (q.type) query = query.where('o.type', '=', q.type);
      if (q.farmId) query = query.where('o.farm_id', '=', q.farmId);
      if (q.fieldId) {
        query = query.where((eb) =>
          eb.exists(eb.selectFrom('operation_fields as f').select('f.id').whereRef('f.operation_id', '=', 'o.id').where('f.field_id', '=', q.fieldId!)),
        );
      }
      const day = sql<string>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)`;
      if (q.seasonId) {
        const season = await resolveSeason(trx, q.seasonId);
        query = query.where(day, '>=', season!.start_date).where(day, '<=', season!.end_date);
      }
      if (q.from) query = query.where(day, '>=', q.from);
      if (q.to) query = query.where(day, '<=', q.to);
      const rows = await query.orderBy(day, 'desc').orderBy('o.created_at', 'desc').limit(500).execute();
      return this.load(trx, rows.map((r) => r.id));
    });
  }

  get(ctx: Ctx, id: string): Promise<Operation> {
    return this.db.run(ctx, (trx) => this.getIn(trx, id));
  }

  private async getIn(trx: Trx, id: string): Promise<Operation> {
    const [op] = await this.load(trx, [id]);
    if (!op) throw notFound('Operation');
    return op;
  }

  create(ctx: Ctx, input: Input, taskId?: string): Promise<Operation> {
    return this.db.run(ctx, (trx) => this.createIn(trx, ctx, input, taskId));
  }

  async createIn(trx: Trx, ctx: Ctx, input: Input, taskId?: string): Promise<Operation> {
    const farm = await trx.selectFrom('farms').select('id').where('id', '=', input.farmId).executeTakeFirst();
    if (!farm) throw notFound('Farm');
    const { id } = await trx
      .insertInto('operations')
      .values({ organization_id: ctx.orgId, created_by: ctx.userId, ...this.headerValues(input) })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.writeLines(trx, ctx, id, input);
    if (taskId) await trx.updateTable('tasks').set({ operation_id: id }).where('id', '=', taskId).execute();
    await record(trx, ctx, {
      entityType: 'operation',
      entityId: id,
      action: 'created',
      changes: { type: input.type, title: input.title, fields: input.fields.length },
      event: { type: 'operation.planned', payload: { operationId: id, type: input.type, fieldIds: input.fields.map((f) => f.fieldId) } },
    });
    return this.getIn(trx, id);
  }

  update(ctx: Ctx, id: string, input: Input): Promise<Operation> {
    return this.db.run(ctx, async (trx) => {
      const current = await this.lock(trx, id);
      if (current.status === 'completed' || current.status === 'canceled') {
        throw conflict('operation_locked', `A ${current.status} operation cannot be edited; reopen it first`);
      }
      if (input.version !== current.version) throw this.versionConflict();
      if (input.farmId !== current.farm_id) throw badRequest('farm_change', 'An operation cannot be moved to another farm');

      await trx
        .updateTable('operations')
        .set({ ...this.headerValues(input), version: current.version + 1 })
        .where('id', '=', id)
        .execute();
      await trx.deleteFrom('operation_fields').where('operation_id', '=', id).execute();
      await trx.deleteFrom('operation_inputs').where('operation_id', '=', id).execute();
      await trx.deleteFrom('operation_labor').where('operation_id', '=', id).execute();
      await trx.deleteFrom('operation_equipment').where('operation_id', '=', id).execute();
      await this.writeLines(trx, ctx, id, input);
      await record(trx, ctx, {
        entityType: 'operation',
        entityId: id,
        action: 'updated',
        changes: { title: input.title, status: input.status, fields: input.fields.length, inputs: input.inputs.length },
        event: { type: 'operation.updated', payload: { operationId: id } },
      });
      return this.getIn(trx, id);
    });
  }

  complete(ctx: Ctx, id: string, input: Out<typeof CompleteOperationInput>): Promise<Operation> {
    return this.db.run(ctx, async (trx) => {
      const op = await this.lock(trx, id);
      // Idempotent: repeating a completion (e.g. a retried request) has no further effect.
      if (op.status === 'completed') return this.getIn(trx, id);
      if (op.status === 'canceled') throw conflict('operation_canceled', 'A canceled operation cannot be completed');
      if (input.version !== op.version) throw this.versionConflict();
      if (input.allowNegativeStock && !can(ctx.role, 'inventory.write')) {
        throw forbidden('Only users who manage inventory may complete operations without sufficient stock');
      }

      const performedAt = input.performedAt ? new Date(input.performedAt) : (op.performed_at ?? new Date());
      if (performedAt.getTime() > Date.now() + 5 * 60_000) {
        throw badRequest('performed_in_future', 'Work cannot be recorded as completed in the future');
      }
      const seq = op.completion_seq + 1;

      const shortages = await this.shortages(trx, id);
      if (shortages.length && !input.allowNegativeStock) {
        throw conflict('insufficient_stock', 'Recorded stock is not sufficient for this operation', shortages);
      }

      const org = await trx.selectFrom('organizations').select('currency').where('id', '=', ctx.orgId).executeTakeFirstOrThrow();
      const season = await resolveSeason(trx, null, dateIn(performedAt));

      // Crops were defaulted from the planned date; the actual date decides. A crop cycle
      // whose season does not contain the work date is replaced by the field's crop in the
      // season that does, when there is one.
      if (season) {
        await sql`
          UPDATE operation_fields ofl
          SET crop_cycle_id = cc.id
          FROM crop_cycles cc
          WHERE ofl.operation_id = ${id}
            AND ofl.field_part_id IS NULL
            AND cc.field_id = ofl.field_id
            AND cc.field_part_id IS NULL
            AND cc.season_id = ${season.id}
            AND (ofl.crop_cycle_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM crop_cycles cur JOIN growing_seasons s ON s.id = cur.season_id
              WHERE cur.id = ofl.crop_cycle_id AND ${dateIn(performedAt)}::date BETWEEN s.start_date AND s.end_date))`.execute(trx);
      }

      // 1. Stock consumption, valued at the application's unit cost or the product's price of the year.
      await sql`
        INSERT INTO stock_movements (organization_id, product_id, storage_location_id, kind, quantity_delta,
                                     unit_cost, occurred_at, operation_id, operation_input_id, completion_seq, created_by)
        SELECT oi.organization_id, oi.product_id, oi.storage_location_id, 'consumption', -oi.total_quantity,
               coalesce(oi.unit_cost, app.product_price(oi.product_id, ${Number(dateIn(performedAt).slice(0, 4))})), ${performedAt}, oi.operation_id, oi.id, ${seq}, ${ctx.userId}
        FROM operation_inputs oi
        WHERE oi.operation_id = ${id}`.execute(trx);

      // 2. Direct costs, allocated to fields (and their crop cycles) by treated area.
      await sql`
        WITH f AS (
          SELECT ofl.field_id, ofl.field_part_id, ofl.crop_cycle_id, cc.season_id,
                 ofl.treated_area_ha / sum(ofl.treated_area_ha) OVER () AS share
          FROM operation_fields ofl
          LEFT JOIN crop_cycles cc ON cc.id = ofl.crop_cycle_id
          WHERE ofl.operation_id = ${id}
        ), c AS (
          SELECT CASE p.category
                   WHEN 'seed' THEN 'seed' WHEN 'fertilizer' THEN 'fertilizer'
                   WHEN 'crop_protection' THEN 'crop_protection' WHEN 'fuel' THEN 'fuel'
                   ELSE 'other_input' END AS category,
                 sum(oi.total_quantity * coalesce(oi.unit_cost, app.product_price(oi.product_id, ${Number(dateIn(performedAt).slice(0, 4))}), 0)) AS amount
          FROM operation_inputs oi JOIN products p ON p.id = oi.product_id
          WHERE oi.operation_id = ${id}
          GROUP BY 1
          UNION ALL
          -- Employees without their own rate cost the season's salary per hour (farm economics).
          SELECT 'labor', sum(l.hours * coalesce(l.hourly_rate, e.hourly_rate, (SELECT fo.salary_per_hour FROM farm_overheads fo WHERE fo.season_id = ${season?.id ?? null}), 0))
          FROM operation_labor l JOIN employees e ON e.id = l.employee_id
          WHERE l.operation_id = ${id}
          UNION ALL
          SELECT 'machinery', sum(q.hours * coalesce(q.hourly_cost, eq.hourly_cost, 0))
          FROM operation_equipment q JOIN equipment eq ON eq.id = q.equipment_id
          WHERE q.operation_id = ${id}
          UNION ALL
          SELECT 'contractor', o.contractor_cost FROM operations o WHERE o.id = ${id}
        )
        INSERT INTO cost_entries (organization_id, season_id, crop_cycle_id, field_id, field_part_id, operation_id, category,
                                  amount, currency, basis, source, completion_seq, description, incurred_on, created_by)
        SELECT ${ctx.orgId}, coalesce(f.season_id, ${season?.id ?? null}::uuid), f.crop_cycle_id, f.field_id, f.field_part_id, ${id},
               c.category, round(c.amount * f.share, 2), ${org.currency}, 'actual', 'operation', ${seq},
               ${op.title}, ${dateIn(performedAt)}::date, ${ctx.userId}
        FROM c CROSS JOIN f
        WHERE coalesce(c.amount, 0) > 0 AND round(c.amount * f.share, 2) <> 0`.execute(trx);

      // 2b. Greenhouse-gas emissions, allocated like the costs.
      await this.writeEmissions(trx, ctx, id, seq, season?.id ?? null);

      // 3. Status change.
      await trx
        .updateTable('operations')
        .set({
          status: 'completed',
          performed_at: performedAt,
          completion_seq: seq,
          version: op.version + 1,
          completed_at: new Date(),
          completed_by: ctx.userId,
        })
        .where('id', '=', id)
        .execute();

      // 4. Follow-on state: linked tasks are done; completed sowing activates the crop.
      await trx
        .updateTable('tasks')
        .set({ status: 'done', completed_at: new Date() })
        .where('operation_id', '=', id)
        .where('status', 'in', ['open', 'in_progress'])
        .execute();
      if (op.type === 'sowing') {
        await sql`
          UPDATE crop_cycles cc SET status = 'active', sowing_date = coalesce(cc.sowing_date, ${dateIn(performedAt)}::date)
          FROM operation_fields ofl
          WHERE ofl.operation_id = ${id} AND ofl.crop_cycle_id = cc.id AND cc.status = 'planned'`.execute(trx);
      }

      const fieldIds = (await trx.selectFrom('operation_fields').select('field_id').where('operation_id', '=', id).execute()).map((r) => r.field_id);
      await record(trx, ctx, {
        entityType: 'operation',
        entityId: id,
        action: 'completed',
        changes: { completionSeq: seq, performedAt: performedAt.toISOString(), stockOverride: shortages.length > 0 },
        event: {
          type: 'operation.completed',
          payload: { operationId: id, type: op.type, fieldIds, performedAt: performedAt.toISOString(), completionSeq: seq },
        },
      });
      await this.emitLowStock(trx, ctx, id);
      return this.getIn(trx, id);
    });
  }

  /** Reverses the side effects of the last completion and makes the operation editable. */
  reopen(ctx: Ctx, id: string, input: Out<typeof ReopenOperationInput>): Promise<Operation> {
    return this.db.run(ctx, async (trx) => {
      const op = await this.lock(trx, id);
      if (op.status !== 'completed') throw conflict('not_completed', 'Only completed operations can be reopened');
      if (input.version !== op.version) throw this.versionConflict();
      const seq = op.completion_seq;

      await sql`
        INSERT INTO stock_movements (organization_id, product_id, storage_location_id, kind, quantity_delta,
                                     unit_cost, occurred_at, operation_id, operation_input_id, completion_seq, note, created_by)
        SELECT organization_id, product_id, storage_location_id, 'reversal', -quantity_delta,
               unit_cost, now(), operation_id, operation_input_id, completion_seq, ${input.reason}, ${ctx.userId}
        FROM stock_movements
        WHERE operation_id = ${id} AND completion_seq = ${seq} AND kind = 'consumption'`.execute(trx);
      await sql`
        INSERT INTO cost_entries (organization_id, season_id, crop_cycle_id, field_id, field_part_id, operation_id, category,
                                  amount, currency, basis, source, completion_seq, description, incurred_on, created_by)
        SELECT organization_id, season_id, crop_cycle_id, field_id, field_part_id, operation_id, category,
               -amount, currency, basis, 'reversal', completion_seq, ${'Reversal: ' + input.reason}, incurred_on, ${ctx.userId}
        FROM cost_entries
        WHERE operation_id = ${id} AND completion_seq = ${seq} AND source = 'operation'`.execute(trx);

      await sql`
        INSERT INTO emission_entries (organization_id, operation_id, completion_seq, kind, season_id, crop_cycle_id, field_id,
                                      field_part_id, source, kg_co2e, factor_set)
        SELECT organization_id, operation_id, completion_seq, 'reversal', season_id, crop_cycle_id, field_id,
               field_part_id, source, -kg_co2e, factor_set
        FROM emission_entries
        WHERE operation_id = ${id} AND completion_seq = ${seq} AND kind = 'operation'`.execute(trx);

      await trx
        .updateTable('operations')
        .set({ status: 'in_progress', version: op.version + 1, completed_at: null, completed_by: null })
        .where('id', '=', id)
        .execute();
      await record(trx, ctx, {
        entityType: 'operation',
        entityId: id,
        action: 'reopened',
        changes: { reason: input.reason, reversedCompletion: seq },
        event: { type: 'operation.reopened', payload: { operationId: id, reversedCompletionSeq: seq, reason: input.reason } },
      });
      return this.getIn(trx, id);
    });
  }

  cancel(ctx: Ctx, id: string, input: Out<typeof CancelOperationInput>): Promise<Operation> {
    return this.db.run(ctx, async (trx) => {
      const op = await this.lock(trx, id);
      if (op.status === 'completed') throw conflict('operation_completed', 'Reopen the operation before canceling it');
      if (op.status === 'canceled') return this.getIn(trx, id);
      if (input.version !== op.version) throw this.versionConflict();
      await trx.updateTable('operations').set({ status: 'canceled', version: op.version + 1 }).where('id', '=', id).execute();
      await trx.updateTable('tasks').set({ status: 'canceled' }).where('operation_id', '=', id).where('status', 'in', ['open', 'in_progress']).execute();
      await record(trx, ctx, {
        entityType: 'operation',
        entityId: id,
        action: 'canceled',
        event: { type: 'operation.canceled', payload: { operationId: id } },
      });
      return this.getIn(trx, id);
    });
  }

  /** Only operations that never had side effects can be deleted. */
  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const op = await this.lock(trx, id);
      if (op.completion_seq > 0 || op.status === 'completed') {
        throw conflict('operation_has_history', 'This operation has been completed before; cancel it instead');
      }
      await trx.deleteFrom('operations').where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'operation', entityId: id, action: 'deleted', changes: { title: op.title } });
    });
  }

  // ---------------------------------------------------------------------------

  private versionConflict() {
    return conflict('version_conflict', 'This operation was changed by someone else. Reload and try again.');
  }

  private async lock(trx: Trx, id: string) {
    const op = await trx.selectFrom('operations').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!op) throw notFound('Operation');
    return op;
  }

  private headerValues(input: Input) {
    return {
      farm_id: input.farmId,
      type: input.type,
      title: input.title,
      status: input.status,
      planned_on: input.plannedOn ?? null,
      performed_at: input.performedAt ? new Date(input.performedAt) : null,
      responsible_employee_id: input.responsibleEmployeeId ?? null,
      contractor_name: input.contractorName ?? null,
      contractor_cost: input.contractorCost ?? null,
      action_id: input.actionId ?? null,
      diesel_l_per_ha: input.dieselLPerHa ?? null,
      bbch_stage: input.bbchStage ?? null,
      target_organism: input.targetOrganism ?? null,
      weather_conditions: input.weatherConditions ?? null,
      details: JSON.stringify(input.details ?? {}),
      notes: input.notes ?? null,
    };
  }

  /** Resolves per-field defaults (area, crop cycle, geometry version) and quantities. */
  private async writeLines(trx: Trx, ctx: Ctx, operationId: string, input: Input) {
    const fieldIds = [...new Set(input.fields.map((f) => f.fieldId))];

    const fields = await trx
      .selectFrom('fields as f')
      .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .select(['f.id', 'f.name', 'f.farm_id', 'g.id as geometry_version_id', 'g.area_ha'])
      .where('f.id', 'in', fieldIds)
      .execute();
    const byId = new Map(fields.map((f) => [f.id, f]));
    const date = input.performedAt ? dateIn(new Date(input.performedAt)) : (input.plannedOn ?? null);
    const season = await resolveSeason(trx, null, date);

    // Part fields of the listed fields in the season of the operation date.
    const parts = season
      ? await trx
          .selectFrom('field_parts')
          .select(['id', 'field_id', 'name', 'usage', 'area_ha'])
          .where('field_id', 'in', fieldIds)
          .where('season_id', '=', season.id)
          .orderBy('sort_order')
          .execute()
      : [];
    const cycleOf = async (fieldId: string, partId: string | null) => {
      if (!season) return null;
      let q = trx
        .selectFrom('crop_cycles')
        .select('id')
        .where('field_id', '=', fieldId)
        .where('season_id', '=', season.id)
        .orderBy(sql`array_position(array['active','planned','harvested','closed'], status)`)
        .limit(1);
      q = partId ? q.where('field_part_id', '=', partId) : q.where('field_part_id', 'is', null);
      return (await q.executeTakeFirst())?.id ?? null;
    };

    const rows = [];
    for (const line of input.fields) {
      const field = byId.get(line.fieldId);
      if (!field) throw notFound('Field');
      if (field.farm_id !== input.farmId) throw badRequest('field_farm_mismatch', `Field ${field.name} belongs to another farm`);

      let cycle: { id: string; field_id: string; field_part_id: string | null } | undefined;
      if (line.cropCycleId) {
        cycle = await trx.selectFrom('crop_cycles').select(['id', 'field_id', 'field_part_id']).where('id', '=', line.cropCycleId).executeTakeFirst();
        if (!cycle || cycle.field_id !== line.fieldId) throw badRequest('crop_cycle_mismatch', `The crop does not belong to field ${field.name}`);
      }

      // Which parts the line covers: the given part, the crop's part, the cropped parts of a
      // divided field, or none (the whole field).
      const fieldParts = parts.filter((p) => p.field_id === line.fieldId);
      let targets: { id: string; name: string; area_ha: number }[] = [];
      const partId = line.fieldPartId ?? cycle?.field_part_id ?? null;
      if (partId) {
        const part = fieldParts.find((p) => p.id === partId)
          ?? (await trx.selectFrom('field_parts').select(['id', 'field_id', 'name', 'usage', 'area_ha']).where('id', '=', partId).executeTakeFirst());
        if (!part || part.field_id !== line.fieldId) throw badRequest('field_part_mismatch', `The part does not belong to field ${field.name}`);
        targets = [part];
      } else if (fieldParts.length) {
        targets = fieldParts.filter((p) => p.usage === 'cropped');
        if (!targets.length) throw badRequest('no_cropped_part', `${field.name} has no cropped part this season; choose the part to treat`);
      }

      if (!targets.length) {
        const cropCycleId = cycle?.id ?? (await cycleOf(line.fieldId, null));
        const area = line.treatedAreaHa ?? field.area_ha!;
        if (area > field.area_ha! * 1.05) {
          throw badRequest('area_exceeds_field', `Treated area on ${field.name} exceeds the field area (${field.area_ha} ha)`);
        }
        rows.push({ organization_id: ctx.orgId, operation_id: operationId, field_id: line.fieldId, field_part_id: null as string | null, crop_cycle_id: cropCycleId, geometry_version_id: field.geometry_version_id, treated_area_ha: round(area, 4) });
        continue;
      }

      // A treated area entered for the field is shared among its parts by area.
      const partsArea = targets.reduce((sum, p) => sum + p.area_ha, 0);
      if (line.treatedAreaHa != null && line.treatedAreaHa > partsArea * 1.05) {
        throw badRequest('area_exceeds_field', `Treated area on ${field.name} exceeds the area of the treated parts (${round(partsArea, 4)} ha)`);
      }
      for (const part of targets) {
        const area = line.treatedAreaHa != null ? (line.treatedAreaHa * part.area_ha) / partsArea : part.area_ha;
        const cropCycleId = cycle && cycle.field_part_id === part.id ? cycle.id : await cycleOf(line.fieldId, part.id);
        rows.push({ organization_id: ctx.orgId, operation_id: operationId, field_id: line.fieldId, field_part_id: part.id as string | null, crop_cycle_id: cropCycleId, geometry_version_id: field.geometry_version_id, treated_area_ha: round(area, 4) });
      }
    }
    const keys = rows.map((r) => `${r.field_id}:${r.field_part_id}`);
    if (new Set(keys).size !== keys.length) throw badRequest('duplicate_field', 'Each field and part can only be listed once');
    for (const r of rows) {
      if (r.field_part_id === null && rows.some((o) => o.field_id === r.field_id && o.field_part_id !== null)) {
        throw badRequest('duplicate_field', `${byId.get(r.field_id)!.name} is listed both as a whole and by parts`);
      }
    }
    await trx.insertInto('operation_fields').values(rows).execute();

    const totalArea = rows.reduce((s, r) => s + r.treated_area_ha, 0);
    if (input.inputs.length) {
      const products = await trx
        .selectFrom('products')
        .select('id')
        .where('id', 'in', input.inputs.map((i) => i.productId))
        .execute();
      if (products.length !== new Set(input.inputs.map((i) => i.productId)).size) throw notFound('Product');
      await trx
        .insertInto('operation_inputs')
        .values(
          input.inputs.map((i) => {
            const total = i.totalQuantity ?? round((i.ratePerHa ?? 0) * totalArea, 4);
            if (!(total > 0)) throw badRequest('invalid_quantity', 'Input quantities must be greater than zero');
            return {
              organization_id: ctx.orgId,
              operation_id: operationId,
              product_id: i.productId,
              storage_location_id: i.storageLocationId ?? null,
              rate_per_ha: i.ratePerHa ?? round(total / totalArea, 4),
              total_quantity: total,
              unit_cost: i.unitCost ?? null,
            };
          }),
        )
        .execute();
    }
    if (input.labor.length) {
      await trx
        .insertInto('operation_labor')
        .values(input.labor.map((l) => ({ organization_id: ctx.orgId, operation_id: operationId, employee_id: l.employeeId, hours: l.hours, hourly_rate: l.hourlyRate ?? null })))
        .execute();
    }
    if (input.equipment.length) {
      await trx
        .insertInto('operation_equipment')
        .values(input.equipment.map((e) => ({ organization_id: ctx.orgId, operation_id: operationId, equipment_id: e.equipmentId, hours: e.hours, hourly_cost: e.hourlyCost ?? null })))
        .execute();
    }
  }

  /**
   * Writes the emissions of completed operations that have none (completed before the emission
   * ledger existed, or with an earlier factor set missing). Returns the number of operations.
   */
  recordMissingEmissions(ctx: Ctx): Promise<number> {
    return this.db.run(ctx, async (trx) => {
      const ops = await trx
        .selectFrom('operations as o')
        .select(['o.id', 'o.completion_seq', 'o.details', sql<string>`(o.performed_at AT TIME ZONE 'Europe/Berlin')::date::text`.as('day')])
        .where('o.status', '=', 'completed')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('emission_entries as e').select('e.id').whereRef('e.operation_id', '=', 'o.id').whereRef('e.completion_seq', '=', 'o.completion_seq'))))
        .execute();
      for (const op of ops) {
        const season = await resolveSeason(trx, null, op.day);
        await this.writeEmissions(trx, ctx, op.id, op.completion_seq, season?.id ?? null);
      }
      return ops.length;
    });
  }

  /** Emissions of a completion by BEK source and treated field (see carbon/ledger.ts). */
  private async writeEmissions(trx: Trx, ctx: Ctx, operationId: string, seq: number, seasonId: string | null) {
    await writeOperationEmissions(trx, ctx, operationId, seq, seasonId);
  }

  /** Required vs. recorded stock per product (and storage location, where one is chosen). */
  private async shortages(trx: Trx, operationId: string): Promise<StockShortage[]> {
    const { rows } = await sql<{ product_id: string; name: string; base_unit: string; required: number; available: number }>`
      WITH need AS (
        SELECT product_id, storage_location_id, sum(total_quantity) AS required
        FROM operation_inputs WHERE operation_id = ${operationId}
        GROUP BY product_id, storage_location_id
      )
      SELECT n.product_id, p.name, p.base_unit, n.required,
             coalesce((SELECT sum(m.quantity_delta) FROM stock_movements m
                       WHERE m.product_id = n.product_id
                         AND (n.storage_location_id IS NULL OR m.storage_location_id = n.storage_location_id)), 0) AS available
      FROM need n JOIN products p ON p.id = n.product_id`.execute(trx);
    return rows
      .filter((r) => r.available < r.required)
      .map((r) => ({ productId: r.product_id, productName: r.name, baseUnit: r.base_unit as BaseUnit, required: r.required, available: r.available }));
  }

  private async emitLowStock(trx: Trx, ctx: Ctx, operationId: string) {
    const { rows } = await sql<{ id: string; name: string; stock: number; threshold: number }>`
      SELECT p.id, p.name, coalesce(sum(m.quantity_delta), 0) AS stock, p.low_stock_threshold AS threshold
      FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
      WHERE p.id IN (SELECT product_id FROM operation_inputs WHERE operation_id = ${operationId})
        AND p.low_stock_threshold IS NOT NULL
      GROUP BY p.id
      HAVING coalesce(sum(m.quantity_delta), 0) <= p.low_stock_threshold`.execute(trx);
    for (const p of rows) {
      await record(trx, ctx, {
        entityType: 'product',
        entityId: p.id,
        action: 'low_stock',
        changes: { stock: p.stock, threshold: p.threshold },
        event: { type: 'inventory.low_stock', payload: { productId: p.id, name: p.name, stock: p.stock, threshold: p.threshold } },
      });
    }
  }

  /** Loads complete operations in the order of `ids`. */
  async load(trx: Trx, ids: string[]): Promise<Operation[]> {
    if (!ids.length) return [];
    const [ops, fields, inputs, labor, equipment, costs] = await Promise.all([
      trx
        .selectFrom('operations as o')
        .innerJoin('farms as fa', 'fa.id', 'o.farm_id')
        .leftJoin('employees as e', 'e.id', 'o.responsible_employee_id')
        .selectAll('o')
        .select(['fa.name as farm_name', 'e.name as employee_name'])
        .where('o.id', 'in', ids)
        .execute(),
      trx
        .selectFrom('operation_fields as of')
        .innerJoin('fields as f', 'f.id', 'of.field_id')
        .leftJoin('field_parts as fp', 'fp.id', 'of.field_part_id')
        .leftJoin('crop_cycles as cc', 'cc.id', 'of.crop_cycle_id')
        .leftJoin('crops as c', 'c.id', 'cc.crop_id')
        .select(['of.operation_id', 'of.field_id', 'f.name as field_name', 'of.field_part_id', 'fp.name as field_part_name', 'of.crop_cycle_id', cropName<string | null>('c').as('crop_name'), 'of.treated_area_ha'])
        .where('of.operation_id', 'in', ids)
        .orderBy('f.name')
        .orderBy(sql`fp.sort_order nulls first`)
        .execute(),
      trx
        .selectFrom('operation_inputs as oi')
        .innerJoin('products as p', 'p.id', 'oi.product_id')
        .select([
          'oi.id',
          'oi.operation_id',
          'oi.product_id',
          'p.name',
          'p.category',
          'p.base_unit',
          'p.n_pct',
          'p.nh4_n_pct',
          'p.p2o5_pct',
          'p.k2o_pct',
          'p.mgo_pct',
          'p.s_pct',
          'p.cao_pct',
          'p.density_t_m3',
          'p.fertilizer_type',
          'oi.storage_location_id',
          'oi.rate_per_ha',
          'oi.total_quantity',
          sql<number | null>`coalesce(oi.unit_cost, app.product_price(oi.product_id, (SELECT extract(year FROM coalesce(o.performed_at::date, o.planned_on, current_date))::int FROM operations o WHERE o.id = oi.operation_id)))`.as('unit_cost'),
          (eb) =>
            eb
              .selectFrom('stock_movements as m')
              .select(sql<number>`coalesce(sum(m.quantity_delta), 0)`.as('s'))
              .whereRef('m.product_id', '=', 'oi.product_id')
              .as('stock'),
        ])
        .where('oi.operation_id', 'in', ids)
        .execute(),
      trx
        .selectFrom('operation_labor as l')
        .innerJoin('employees as e', 'e.id', 'l.employee_id')
        .select(['l.operation_id', 'l.employee_id', 'e.name', 'l.hours', 'l.hourly_rate'])
        .where('l.operation_id', 'in', ids)
        .execute(),
      trx
        .selectFrom('operation_equipment as q')
        .innerJoin('equipment as eq', 'eq.id', 'q.equipment_id')
        .select(['q.operation_id', 'q.equipment_id', 'eq.name', 'q.hours', 'q.hourly_cost'])
        .where('q.operation_id', 'in', ids)
        .execute(),
      trx
        .selectFrom('cost_entries')
        .select(['operation_id', 'category', sql<number>`sum(amount)`.as('amount')])
        .where('operation_id', 'in', ids)
        .groupBy(['operation_id', 'category'])
        .execute(),
    ]);

    const group = <T extends { operation_id: string | null }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.operation_id!, [...(m.get(r.operation_id!) ?? []), r]);
      return m;
    };
    const F = group(fields), I = group(inputs), L = group(labor), E = group(equipment), C = group(costs);
    const byId = new Map(ops.map((o) => [o.id, o]));

    return ids.flatMap((id) => {
      const o = byId.get(id);
      if (!o) return [];
      const opFields = F.get(id) ?? [];
      const opInputs = (I.get(id) ?? []).map((i) => {
        const hasContents = i.category === 'fertilizer' && [i.n_pct, i.p2o5_pct, i.k2o_pct, i.mgo_pct, i.s_pct, i.cao_pct].some((v) => v != null);
        const rate = i.rate_per_ha ?? 0;
        const n = hasContents
          ? nutrientKgPerHa(
              { nPct: i.n_pct, nh4NPct: i.nh4_n_pct, p2o5Pct: i.p2o5_pct, k2oPct: i.k2o_pct, mgoPct: i.mgo_pct, sPct: i.s_pct, caoPct: i.cao_pct, densityTM3: i.density_t_m3, fertilizerType: i.fertilizer_type as FertilizerType | null },
              rate,
              i.base_unit as BaseUnit,
            )
          : null;
        const { densityAssumed = false, ...nutrients } = n ?? {};
        return { i, nutrients: n ? (nutrients as NutrientRates) : null, densityAssumed };
      });
      const withNutrients = opInputs.filter((x) => x.nutrients);
      return [{
        id: o.id,
        farmId: o.farm_id,
        farmName: o.farm_name,
        type: o.type as OperationType,
        title: o.title,
        status: o.status as OperationStatus,
        plannedOn: o.planned_on,
        performedAt: iso(o.performed_at),
        priority: o.priority as TaskPriority,
        dueOn: o.due_on,
        responsibleEmployee: o.responsible_employee_id ? { id: o.responsible_employee_id, name: o.employee_name! } : null,
        contractorName: o.contractor_name,
        contractorCost: o.contractor_cost,
        actionId: o.action_id,
        dieselLPerHa: o.diesel_l_per_ha,
        bbchStage: o.bbch_stage,
        targetOrganism: o.target_organism,
        weatherConditions: o.weather_conditions,
        details: o.details as Operation['details'],
        notes: o.notes,
        version: o.version,
        completionSeq: o.completion_seq,
        completedAt: iso(o.completed_at),
        totalAreaHa: round(opFields.reduce((s, f) => s + f.treated_area_ha, 0), 4),
        fields: opFields.map((f) => ({
          fieldId: f.field_id,
          fieldName: f.field_name,
          fieldPartId: f.field_part_id,
          fieldPartName: f.field_part_name,
          cropCycleId: f.crop_cycle_id,
          cropName: f.crop_name,
          treatedAreaHa: f.treated_area_ha,
        })),
        inputs: opInputs.map(({ i, nutrients, densityAssumed }) => ({
          id: i.id,
          productId: i.product_id,
          productName: i.name,
          category: i.category as ProductCategory,
          baseUnit: i.base_unit as BaseUnit,
          storageLocationId: i.storage_location_id,
          ratePerHa: i.rate_per_ha,
          totalQuantity: i.total_quantity,
          unitCost: i.unit_cost,
          availableStock: Number(i.stock ?? 0),
          nutrients,
          densityAssumed,
        })),
        nutrientTotals: withNutrients.length ? sumNutrients(withNutrients.map((x) => x.nutrients!)) : null,
        templateStepId: o.template_step_id,
        labor: (L.get(id) ?? []).map((l) => ({ employeeId: l.employee_id, employeeName: l.name, hours: l.hours, hourlyRate: l.hourly_rate })),
        equipment: (E.get(id) ?? []).map((e) => ({ equipmentId: e.equipment_id, equipmentName: e.name, hours: e.hours, hourlyCost: e.hourly_cost })),
        costs: (C.get(id) ?? []).filter((c) => round(c.amount) !== 0).map((c) => ({ category: c.category, amount: round(c.amount) })),
        createdAt: iso(o.created_at),
        updatedAt: iso(o.updated_at),
      }];
    });
  }
}
