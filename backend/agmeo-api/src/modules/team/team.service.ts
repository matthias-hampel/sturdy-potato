import { Injectable } from '@nestjs/common';
import type {
  AcquisitionType,
  DepreciationMethod,
  Employee,
  EmployeeInput,
  EmployeeRole,
  Equipment,
  EquipmentCategory,
  EquipmentClass,
  EquipmentInput,
  EquipmentKind,
  EquipmentStatus,
  EquipmentUsage,
  FinancingType,
  IrrigationType,
  MaintenanceInput,
  MaintenanceRecord,
  MountType,
  OperationAction,
  OperationActionInput,
  TyreSpec,
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
      role: r.role as EmployeeRole,
      staffNumber: r.staff_number,
      jobTitle: r.job_title,
      email: r.email,
      phone: r.phone,
      hourlyRate: r.hourly_rate,
      notes: r.notes,
      active: r.active,
      hoursThisYear: Number(r.hours ?? 0),
    }));
  }

  private employeeValues(input: Out<typeof EmployeeInput>) {
    return {
      name: input.name,
      user_id: input.userId ?? null,
      role: input.role,
      staff_number: input.staffNumber ?? null,
      job_title: input.jobTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      hourly_rate: input.hourlyRate ?? null,
      notes: input.notes ?? null,
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

  equipment(ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<Equipment[]> {
    return this.db.run(ctx, (trx) => this.queryEquipment(trx, opts));
  }

  getEquipment(ctx: Ctx, id: string): Promise<Equipment> {
    return this.db.run(ctx, async (trx) => {
      const [eq] = await this.queryEquipment(trx, { id });
      if (!eq) throw notFound('Equipment');
      return eq;
    });
  }

  async queryEquipment(trx: Trx, opts: { id?: string; includeArchived?: boolean }): Promise<Equipment[]> {
    const from = new Date(yearStart());
    let q = trx
      .selectFrom('equipment as e')
      .leftJoin('employees as de', 'de.id', 'e.default_employee_id')
      .selectAll('e')
      .select('de.name as default_employee_name')
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
      .orderBy(sql`e.archived_at IS NOT NULL OR e.status IN ('sold', 'scrapped', 'decommissioned')`)
      .orderBy('e.class')
      .orderBy('e.name');
    if (opts.id) q = q.where('e.id', '=', opts.id);
    else if (!opts.includeArchived) q = q.where('e.archived_at', 'is', null);
    const rows = await q.execute();
    const now = today();
    return rows.map((r) => {
      const due = r.next_due_on != null || r.next_due_hours != null;
      return {
        id: r.id,
        farmId: r.farm_id,
        name: r.name,
        class: r.class as EquipmentClass,
        category: r.category as EquipmentCategory,
        kind: r.kind as EquipmentKind,
        mountType: r.mount_type as MountType | null,
        manufacturer: r.manufacturer,
        model: r.model,
        modelYear: r.model_year,
        registration: r.registration,
        serialNumber: r.serial_number,
        inventoryNumber: r.inventory_number,
        catalogueId: r.catalogue_id,
        powerKw: r.power_kw,
        emptyMassKg: r.empty_mass_kg,
        operatingMassKg: r.operating_mass_kg,
        frontAxleFraction: r.front_axle_fraction,
        tankCapacityL: r.tank_capacity_l,
        frontTyre: r.front_tyre as TyreSpec | null,
        rearTyre: r.rear_tyre as TyreSpec | null,
        maxFillMassKg: r.max_fill_mass_kg,
        workingWidthM: r.working_width_m,
        hourMeter: r.hour_meter,
        hourlyCost: r.hourly_cost,
        fuelLPerH: r.fuel_l_per_h,
        purchaseDate: r.purchase_date,
        purchasePriceNet: r.purchase_price_net,
        acquisitionType: r.acquisition_type as AcquisitionType | null,
        depreciationMethod: r.depreciation_method as DepreciationMethod | null,
        usefulLifeYears: r.useful_life_years,
        residualValue: r.residual_value,
        insuranceAnnual: r.insurance_annual,
        financingType: r.financing_type as FinancingType | null,
        financingMonthlyPayment: r.financing_monthly_payment,
        financingEndDate: r.financing_end_date,
        leaseEndDate: r.lease_end_date,
        machineRingMemberNumber: r.machine_ring_member_number,
        inspectionUntil: r.inspection_until,
        insuranceUntil: r.insurance_until,
        irrigationType: r.irrigation_type as IrrigationType | null,
        irrigationFlowLPerMin: r.irrigation_flow_l_per_min,
        irrigationCoverageHa: r.irrigation_coverage_ha,
        irrigationPressureBar: r.irrigation_pressure_bar,
        defaultEmployeeId: r.default_employee_id,
        defaultEmployeeName: r.default_employee_name,
        status: r.status as EquipmentStatus,
        notes: r.notes,
        archivedAt: iso(r.archived_at),
        sciReady: r.class === 'machine' && r.front_tyre != null && r.rear_tyre != null && r.operating_mass_kg != null && r.front_axle_fraction != null,
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
      class: input.class,
      category: input.category,
      mount_type: input.class === 'implement' ? (input.mountType ?? null) : null,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      model_year: input.modelYear ?? null,
      registration: input.registration ?? null,
      serial_number: input.serialNumber ?? null,
      inventory_number: input.inventoryNumber ?? null,
      catalogue_id: input.catalogueId ?? null,
      power_kw: input.class === 'machine' ? (input.powerKw ?? null) : null,
      empty_mass_kg: input.emptyMassKg ?? null,
      operating_mass_kg: input.class === 'machine' ? (input.operatingMassKg ?? null) : null,
      front_axle_fraction: input.class === 'machine' ? (input.frontAxleFraction ?? null) : null,
      tank_capacity_l: input.tankCapacityL ?? null,
      front_tyre: input.class === 'machine' && input.frontTyre ? JSON.stringify(input.frontTyre) : null,
      rear_tyre: input.class === 'machine' && input.rearTyre ? JSON.stringify(input.rearTyre) : null,
      max_fill_mass_kg: input.class === 'implement' ? (input.maxFillMassKg ?? null) : null,
      working_width_m: input.class === 'implement' ? (input.workingWidthM ?? null) : null,
      hour_meter: input.hourMeter,
      hourly_cost: input.hourlyCost ?? null,
      fuel_l_per_h: input.fuelLPerH ?? null,
      purchase_date: input.purchaseDate ?? null,
      purchase_price_net: input.purchasePriceNet ?? null,
      acquisition_type: input.acquisitionType ?? null,
      depreciation_method: input.depreciationMethod ?? null,
      useful_life_years: input.usefulLifeYears ?? null,
      residual_value: input.residualValue ?? null,
      insurance_annual: input.insuranceAnnual ?? null,
      financing_type: input.financingType ?? null,
      financing_monthly_payment: input.financingMonthlyPayment ?? null,
      financing_end_date: input.financingEndDate ?? null,
      lease_end_date: input.leaseEndDate ?? null,
      machine_ring_member_number: input.machineRingMemberNumber ?? null,
      inspection_until: input.inspectionUntil ?? null,
      insurance_until: input.insuranceUntil ?? null,
      irrigation_type: input.irrigationType ?? null,
      irrigation_flow_l_per_min: input.irrigationFlowLPerMin ?? null,
      irrigation_coverage_ha: input.irrigationCoverageHa ?? null,
      irrigation_pressure_bar: input.irrigationPressureBar ?? null,
      default_employee_id: input.class === 'machine' ? (input.defaultEmployeeId ?? null) : null,
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
      const archived_at = input.archived === undefined ? before.archived_at : input.archived ? (before.archived_at ?? new Date()) : null;
      await trx.updateTable('equipment').set({ ...values, archived_at }).where('id', '=', id).execute();
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

  // ---------------------------------------------------------------------------
  // Action catalogue
  // ---------------------------------------------------------------------------

  actions(ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<OperationAction[]> {
    return this.db.run(ctx, (trx) => this.queryActions(trx, opts));
  }

  private async queryActions(trx: Trx, opts: { id?: string; includeArchived?: boolean }): Promise<OperationAction[]> {
    let q = trx
      .selectFrom('operation_actions as a')
      .leftJoin('equipment as m', 'm.id', 'a.machine_id')
      .leftJoin('equipment as i', 'i.id', 'a.implement_id')
      .leftJoin('employees as e', 'e.id', 'a.employee_id')
      .selectAll('a')
      .select(['m.name as machine_name', 'i.name as implement_name', 'e.name as employee_name'])
      .select((eb) => eb.selectFrom('operations as o').select(sql<number>`count(*)::int`.as('n')).whereRef('o.action_id', '=', 'a.id').as('usage_count'))
      .orderBy('a.operation_type')
      .orderBy('a.name');
    if (opts.id) q = q.where('a.id', '=', opts.id);
    else if (!opts.includeArchived) q = q.where('a.archived_at', 'is', null);
    return (await q.execute()).map((r) => ({
      id: r.id,
      name: r.name,
      operationType: r.operation_type as OperationAction['operationType'],
      dieselLPerHa: r.diesel_l_per_ha,
      hoursPerHa: r.hours_per_ha,
      machineId: r.machine_id,
      machineName: r.machine_name,
      implementId: r.implement_id,
      implementName: r.implement_name,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      notes: r.notes,
      archivedAt: iso(r.archived_at),
      usageCount: Number(r.usage_count ?? 0),
    }));
  }

  /** The machine must be a machine and the implement an implement. */
  private async checkActionRefs(trx: Trx, input: Out<typeof OperationActionInput>) {
    const ids = [input.machineId, input.implementId].filter((x): x is string => !!x);
    if (!ids.length) return;
    const rows = await trx.selectFrom('equipment').select(['id', 'class']).where('id', 'in', ids).execute();
    const cls = new Map(rows.map((r) => [r.id, r.class]));
    if (input.machineId && cls.get(input.machineId) !== 'machine') throw badRequest('invalid_machine', 'Choose a machine for the machine');
    if (input.implementId && cls.get(input.implementId) !== 'implement') throw badRequest('invalid_implement', 'Choose an implement for the implement');
  }

  private actionValues(input: Out<typeof OperationActionInput>) {
    return {
      name: input.name,
      operation_type: input.operationType,
      diesel_l_per_ha: input.dieselLPerHa ?? null,
      hours_per_ha: input.hoursPerHa ?? null,
      machine_id: input.machineId ?? null,
      implement_id: input.implementId ?? null,
      employee_id: input.employeeId ?? null,
      notes: input.notes ?? null,
    };
  }

  createAction(ctx: Ctx, input: Out<typeof OperationActionInput>): Promise<OperationAction> {
    return this.db.run(ctx, async (trx) => {
      await this.checkActionRefs(trx, input);
      const { id } = await trx
        .insertInto('operation_actions')
        .values({ organization_id: ctx.orgId, ...this.actionValues(input) })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch(uniqueName);
      await record(trx, ctx, { entityType: 'operation_action', entityId: id, action: 'created', changes: { name: input.name } });
      return (await this.queryActions(trx, { id }))[0];
    });
  }

  updateAction(ctx: Ctx, id: string, input: Out<typeof OperationActionInput>): Promise<OperationAction> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('operation_actions').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Action');
      await this.checkActionRefs(trx, input);
      const values = this.actionValues(input);
      const archived_at = input.archived === undefined ? before.archived_at : input.archived ? (before.archived_at ?? new Date()) : null;
      await trx.updateTable('operation_actions').set({ ...values, archived_at }).where('id', '=', id).execute().catch(uniqueName);
      await record(trx, ctx, { entityType: 'operation_action', entityId: id, action: 'updated', changes: diff(before, values) });
      return (await this.queryActions(trx, { id }))[0];
    });
  }

  /** Deletes an unused action; one that operations were planned from is archived instead. */
  deleteAction(ctx: Ctx, id: string): Promise<{ archived: boolean }> {
    return this.db.run(ctx, async (trx) => {
      const [a] = await this.queryActions(trx, { id });
      if (!a) throw notFound('Action');
      if (a.usageCount > 0) {
        await trx.updateTable('operation_actions').set({ archived_at: new Date() }).where('id', '=', id).execute();
      } else {
        await trx.deleteFrom('operation_actions').where('id', '=', id).execute();
      }
      await record(trx, ctx, { entityType: 'operation_action', entityId: id, action: a.usageCount > 0 ? 'archived' : 'deleted', changes: { name: a.name } });
      return { archived: a.usageCount > 0 };
    });
  }
}

function uniqueName(e: unknown): never {
  if ((e as { code?: string }).code === '23505') throw badRequest('action_exists', 'An action with this name already exists');
  throw e;
}
