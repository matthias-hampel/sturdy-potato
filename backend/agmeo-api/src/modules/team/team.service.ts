import { Injectable } from '@nestjs/common';
import type {
  Employee,
  EmployeeInput,
  Equipment,
  EquipmentInput,
  EquipmentKind,
  EquipmentStatus,
  EquipmentUsage,
  MaintenanceInput,
  MaintenanceRecord,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

const yearStart = () => `${today().slice(0, 4)}-01-01`;

/** Employees (people doing farm work) and machinery. */
@Injectable()
export class TeamService {
  constructor(private readonly db: Database) {}

  employees(ctx: Ctx, includeInactive = true): Promise<Employee[]> {
    return this.db.run(ctx, (trx) => this.queryEmployees(trx, { includeInactive }));
  }

  private async queryEmployees(trx: Trx, opts: { id?: string; includeInactive?: boolean }): Promise<Employee[]> {
    let q = trx
      .selectFrom('employees as e')
      .selectAll('e')
      .select((eb) =>
        eb
          .selectFrom('operation_labor as l')
          .innerJoin('operations as o', 'o.id', 'l.operation_id')
          .select(sql<number>`coalesce(sum(l.hours), 0)`.as('h'))
          .whereRef('l.employee_id', '=', 'e.id')
          .where('o.status', '=', 'completed')
          .where('o.performed_at', '>=', new Date(yearStart()))
          .as('hours'),
      )
      .orderBy('e.active', 'desc')
      .orderBy('e.name');
    if (opts.id) q = q.where('e.id', '=', opts.id);
    if (!opts.includeInactive) q = q.where('e.active', '=', true);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      jobTitle: r.job_title,
      email: r.email,
      phone: r.phone,
      hourlyRate: r.hourly_rate,
      active: r.active,
      hoursThisYear: Number(r.hours ?? 0),
    }));
  }

  private employeeValues(input: Out<typeof EmployeeInput>) {
    return {
      name: input.name,
      user_id: input.userId ?? null,
      job_title: input.jobTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      hourly_rate: input.hourlyRate ?? null,
      active: input.active,
    };
  }

  createEmployee(ctx: Ctx, input: Out<typeof EmployeeInput>): Promise<Employee> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('employees')
        .values({ organization_id: ctx.orgId, ...this.employeeValues(input) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'employee', entityId: id, action: 'created', changes: { name: input.name } });
      return (await this.queryEmployees(trx, { id, includeInactive: true }))[0];
    });
  }

  updateEmployee(ctx: Ctx, id: string, input: Out<typeof EmployeeInput>): Promise<Employee> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Employee');
      const values = this.employeeValues(input);
      await trx.updateTable('employees').set(values).where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'employee', entityId: id, action: 'updated', changes: diff(before, values) });
      return (await this.queryEmployees(trx, { id, includeInactive: true }))[0];
    });
  }

  // ---------------------------------------------------------------------------
  // Machinery
  // ---------------------------------------------------------------------------

  equipment(ctx: Ctx): Promise<Equipment[]> {
    return this.db.run(ctx, (trx) => this.queryEquipment(trx, {}));
  }

  getEquipment(ctx: Ctx, id: string): Promise<Equipment> {
    return this.db.run(ctx, async (trx) => {
      const [eq] = await this.queryEquipment(trx, { id });
      if (!eq) throw notFound('Equipment');
      return eq;
    });
  }

  async queryEquipment(trx: Trx, opts: { id?: string }): Promise<Equipment[]> {
    const from = new Date(yearStart());
    let q = trx
      .selectFrom('equipment as e')
      .selectAll('e')
      .select((eb) => [
        eb
          .selectFrom('operation_equipment as oe')
          .innerJoin('operations as o', 'o.id', 'oe.operation_id')
          .select(sql<number>`coalesce(sum(oe.hours), 0)`.as('h'))
          .whereRef('oe.equipment_id', '=', 'e.id')
          .where('o.status', '=', 'completed')
          .where('o.performed_at', '>=', from)
          .as('hours'),
        eb
          .selectFrom('maintenance_records as m')
          .select(sql<number>`coalesce(sum(m.cost), 0)`.as('c'))
          .whereRef('m.equipment_id', '=', 'e.id')
          .where('m.performed_on', '>=', yearStart())
          .as('maintenance_cost'),
      ])
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('maintenance_records as m')
            .select(['m.next_due_on', 'm.next_due_hours'])
            .whereRef('m.equipment_id', '=', 'e.id')
            .orderBy('m.performed_on', 'desc')
            .orderBy('m.created_at', 'desc')
            .limit(1)
            .as('nm'),
        (join) => join.onTrue(),
      )
      .select(['nm.next_due_on', 'nm.next_due_hours'])
      .orderBy(sql`e.status = 'retired'`)
      .orderBy('e.name');
    if (opts.id) q = q.where('e.id', '=', opts.id);
    const rows = await q.execute();
    const now = today();
    return rows.map((r) => {
      const due = r.next_due_on != null || r.next_due_hours != null;
      return {
        id: r.id,
        farmId: r.farm_id,
        name: r.name,
        kind: r.kind as EquipmentKind,
        manufacturer: r.manufacturer,
        model: r.model,
        modelYear: r.model_year,
        registration: r.registration,
        hourMeter: r.hour_meter,
        hourlyCost: r.hourly_cost,
        fuelLPerH: r.fuel_l_per_h,
        status: r.status as EquipmentStatus,
        notes: r.notes,
        hoursThisYear: Number(r.hours ?? 0),
        maintenanceCostThisYear: Number(r.maintenance_cost ?? 0),
        nextMaintenance: due
          ? {
              dueOn: r.next_due_on,
              dueHours: r.next_due_hours,
              overdue: (r.next_due_on != null && r.next_due_on <= now) || (r.next_due_hours != null && r.hour_meter >= r.next_due_hours),
            }
          : null,
      };
    });
  }

  private equipmentValues(input: Out<typeof EquipmentInput>) {
    return {
      name: input.name,
      farm_id: input.farmId ?? null,
      kind: input.kind,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      model_year: input.modelYear ?? null,
      registration: input.registration ?? null,
      hour_meter: input.hourMeter,
      hourly_cost: input.hourlyCost ?? null,
      fuel_l_per_h: input.fuelLPerH ?? null,
      status: input.status,
      notes: input.notes ?? null,
    };
  }

  createEquipment(ctx: Ctx, input: Out<typeof EquipmentInput>): Promise<Equipment> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('equipment')
        .values({ organization_id: ctx.orgId, ...this.equipmentValues(input) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'equipment', entityId: id, action: 'created', changes: { name: input.name } });
      return (await this.queryEquipment(trx, { id }))[0];
    });
  }

  updateEquipment(ctx: Ctx, id: string, input: Out<typeof EquipmentInput>): Promise<Equipment> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('equipment').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Equipment');
      const values = this.equipmentValues(input);
      await trx.updateTable('equipment').set(values).where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'equipment', entityId: id, action: 'updated', changes: diff(before, values) });
      return (await this.queryEquipment(trx, { id }))[0];
    });
  }

  maintenance(ctx: Ctx, equipmentId: string): Promise<MaintenanceRecord[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('maintenance_records')
        .selectAll()
        .where('equipment_id', '=', equipmentId)
        .orderBy('performed_on', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        equipmentId: r.equipment_id,
        performedOn: r.performed_on,
        description: r.description,
        cost: r.cost,
        hourMeter: r.hour_meter,
        nextDueOn: r.next_due_on,
        nextDueHours: r.next_due_hours,
        createdAt: iso(r.created_at),
      }));
    });
  }

  addMaintenance(ctx: Ctx, equipmentId: string, input: Out<typeof MaintenanceInput>): Promise<MaintenanceRecord[]> {
    return this.db
      .run(ctx, async (trx) => {
        const eq = await trx.selectFrom('equipment').select(['id', 'hour_meter']).where('id', '=', equipmentId).executeTakeFirst();
        if (!eq) throw notFound('Equipment');
        if (input.nextDueHours != null && input.hourMeter != null && input.nextDueHours <= input.hourMeter) {
          throw badRequest('invalid_due_hours', 'The next service must be due after the current hour meter reading');
        }
        const { id } = await trx
          .insertInto('maintenance_records')
          .values({
            organization_id: ctx.orgId,
            equipment_id: equipmentId,
            performed_on: input.performedOn,
            description: input.description,
            cost: input.cost ?? null,
            hour_meter: input.hourMeter ?? null,
            next_due_on: input.nextDueOn ?? null,
            next_due_hours: input.nextDueHours ?? null,
            created_by: ctx.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // A service reading is the authoritative hour meter value.
        if (input.hourMeter != null && input.hourMeter > eq.hour_meter) {
          await trx.updateTable('equipment').set({ hour_meter: input.hourMeter }).where('id', '=', equipmentId).execute();
        }
        await record(trx, ctx, {
          entityType: 'equipment',
          entityId: equipmentId,
          action: 'maintenance_recorded',
          changes: { maintenanceId: id, description: input.description, cost: input.cost ?? null },
        });
      })
      .then(() => this.maintenance(ctx, equipmentId));
  }

  usage(ctx: Ctx, equipmentId: string): Promise<EquipmentUsage[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('operation_equipment as oe')
        .innerJoin('operations as o', 'o.id', 'oe.operation_id')
        .select(['o.id', 'o.title', 'o.type', 'o.performed_at', 'o.planned_on', 'o.status', 'oe.hours'])
        .where('oe.equipment_id', '=', equipmentId)
        .orderBy(sql`coalesce(o.performed_at::date, o.planned_on)`, 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        operationId: r.id,
        title: r.title,
        type: r.type,
        performedAt: iso(r.performed_at) ?? r.planned_on,
        status: r.status,
        hours: r.hours,
      }));
    });
  }
}
