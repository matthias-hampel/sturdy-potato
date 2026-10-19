import { Injectable } from '@nestjs/common';
import {
  can,
  type ApplyTemplateInput,
  type ApplyTemplateResult,
  type AssignRotationInput,
  type BaseUnit,
  type CalendarRow,
  type CropCalendar,
  type CropRole,
  type CropRotation,
  type CultivationTemplate,
  type OperationStatus,
  type OperationType,
  type CalendarYearsQuery,
  type CarryForwardInput,
  type CropCalendarYears,
  type CropUsage,
  type CarryForwardResult,
  type RollOverInput,
  type RollOverResult,
  type RotationInput,
  type TemplateAnchor,
  type TemplateInput,
  type CopyTemplateInput,
  type CopyTemplateResult,
  type SaveAsTemplateInput,
  type SharedTemplates,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropColor, cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';
import { OperationsService } from '../operations/operations.service.js';
import { defaultDateInSeason, nextRotationPosition, stepDate } from './dates.js';

/**
 * Cultivation planning: templates (reusable work plans per crop that become planned operations),
 * crop rotations with season roll-over, and the crop calendar.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly db: Database,
    private readonly operations: OperationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  templates(ctx: Ctx): Promise<CultivationTemplate[]> {
    return this.db.run(ctx, (trx) => this.loadTemplates(trx));
  }

  template(ctx: Ctx, id: string): Promise<CultivationTemplate> {
    return this.db.run(ctx, async (trx) => {
      const [t] = await this.loadTemplates(trx, id);
      if (!t) throw notFound('Template');
      return t;
    });
  }

  createTemplate(ctx: Ctx, input: Out<typeof TemplateInput>): Promise<CultivationTemplate> {
    return this.db.run(ctx, (trx) => this.createIn(trx, ctx, input));
  }


  /**
   * Replaces a template's steps. Planned operations already created from removed steps keep their
   * data; they only lose the link to the template.
   */
  updateTemplate(ctx: Ctx, id: string, input: Out<typeof TemplateInput>): Promise<CultivationTemplate> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('cultivation_templates').select(['id', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound('Template');
      await this.assertCrop(trx, input.cropId);
      await this.assertUniqueName(trx, input.cropId, input.name, id);
      const used = await trx.selectFrom('crop_cycles').select('crop_id').where('template_id', '=', id).where('crop_id', '<>', input.cropId).limit(1).executeTakeFirst();
      if (used) throw badRequest('template_in_use', 'The template is applied to crops of another kind; create a new template instead');
      await trx.updateTable('cultivation_templates').set({ crop_id: input.cropId, name: input.name, notes: input.notes ?? null }).where('id', '=', id).execute();
      await this.writeSteps(trx, ctx, id, input);
      await record(trx, ctx, { entityType: 'template', entityId: id, action: 'updated', changes: { name: input.name, steps: input.steps.length } });
      return (await this.loadTemplates(trx, id))[0];
    });
  }

  deleteTemplate(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      // As in the reference: a template crops were planned from stays (it documents their plan).
      const used = await trx.selectFrom('crop_cycles').select('id').where('template_id', '=', id).limit(1).executeTakeFirst();
      if (used) throw conflict('template_in_use', 'The template is used by crops and cannot be deleted');
      const res = await trx.deleteFrom('cultivation_templates').where('id', '=', id).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Template');
      await record(trx, ctx, { entityType: 'template', entityId: id, action: 'deleted' });
    });
  }

  /** Templates of the other organizations the user is an active member of, read-only. */
  async sharedTemplates(ctx: Ctx): Promise<SharedTemplates[]> {
    const orgs = await this.db.run({ userId: ctx.userId }, (trx) =>
      trx
        .selectFrom('memberships as m')
        .innerJoin('organizations as o', 'o.id', 'm.organization_id')
        .select(['o.id', 'o.name'])
        .where('m.user_id', '=', ctx.userId)
        .where('m.status', '=', 'active')
        .where('o.id', '<>', ctx.orgId)
        .orderBy('o.name')
        .execute(),
    );
    const out: SharedTemplates[] = [];
    for (const org of orgs) {
      const templates = await this.db.run({ userId: ctx.userId, orgId: org.id }, (trx) => this.loadTemplates(trx));
      if (templates.length) out.push({ organization: { id: org.id, name: org.name }, templates });
    }
    return out;
  }

  /**
   * Copies a template into this organization (reference duplicateTemplate). From another of the
   * user's organizations, product lines are matched by product name and category; lines without a
   * match are left out and counted.
   */
  async copyTemplate(ctx: Ctx, id: string, input: Out<typeof CopyTemplateInput>): Promise<CopyTemplateResult> {
    const sourceOrg = input.sourceOrgId ?? ctx.orgId;
    const source = await this.db.run({ userId: ctx.userId, orgId: sourceOrg }, async (trx) => {
      const [t] = await this.loadTemplates(trx, id);
      if (!t) throw notFound('Template');
      const productIds = [...new Set(t.steps.flatMap((s) => s.inputs.map((i) => i.productId)))];
      const products = productIds.length ? await trx.selectFrom('products').select(['id', 'name', 'category']).where('id', 'in', productIds).execute() : [];
      return { t, products };
    });
    return this.db.run(ctx, async (trx) => {
      let productOf = (pid: string): string | null => pid;
      if (sourceOrg !== ctx.orgId) {
        const names = source.products.map((p) => p.name);
        const own = names.length ? await trx.selectFrom('products').select(['id', 'name', 'category']).where('name', 'in', names).where('archived_at', 'is', null).execute() : [];
        productOf = (pid) => {
          const p = source.products.find((x) => x.id === pid);
          return own.find((o) => p && o.name === p.name && o.category === p.category)?.id ?? null;
        };
      }
      let droppedInputs = 0;
      const steps = source.t.steps.map((s) => ({
        type: s.type,
        title: s.title,
        anchor: s.anchor,
        offsetDays: s.offsetDays,
        bbchStage: s.bbchStage,
        notes: s.notes,
        inputs: s.inputs.flatMap((i) => {
          const productId = productOf(i.productId);
          if (!productId) {
            droppedInputs++;
            return [];
          }
          return [{ productId, ratePerHa: i.ratePerHa }];
        }),
      }));
      const template = await this.createIn(trx, ctx, { cropId: source.t.cropId, name: input.name, notes: source.t.notes, steps });
      return { template, droppedInputs };
    });
  }

  /**
   * A crop's operations (not canceled) as a new template (reference
   * createNewTemplateFromCultivationId): harvests count from the harvest, everything else from
   * the sowing date, else from the season start.
   */
  saveCycleAsTemplate(ctx: Ctx, cropCycleId: string, input: Out<typeof SaveAsTemplateInput>): Promise<CultivationTemplate> {
    return this.db.run(ctx, async (trx) => {
      const cycle = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .select(['cc.id', 'cc.crop_id', 'cc.sowing_date', 's.start_date'])
        .where('cc.id', '=', cropCycleId)
        .executeTakeFirst();
      if (!cycle) throw notFound('Crop cycle');
      const { rows } = await sql<{ id: string; day: string | null }>`
        SELECT DISTINCT o.id, coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)::text AS day
        FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
        WHERE ofl.crop_cycle_id = ${cropCycleId} AND o.status <> 'canceled'
        ORDER BY day NULLS LAST`.execute(trx);
      const ops = (await this.operations.load(trx, rows.map((r) => r.id))).filter((o) => o.performedAt || o.plannedOn);
      if (!ops.length) throw badRequest('no_operations', 'The crop has no dated operations to save as a template');
      const dayOf = (o: (typeof ops)[number]) => (o.performedAt ? o.performedAt.slice(0, 10) : o.plannedOn!);
      const sowing = ops.find((o) => o.type === 'sowing') ? dayOf(ops.find((o) => o.type === 'sowing')!) : cycle.sowing_date;
      const harvest = ops.find((o) => o.type === 'harvest') ? dayOf(ops.find((o) => o.type === 'harvest')!) : null;
      const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
      const steps = ops.map((o) => {
        const day = dayOf(o);
        const [anchor, offsetDays] = o.type === 'harvest' && harvest ? (['harvest', diff(day, harvest)] as const) : sowing ? (['sowing', diff(day, sowing)] as const) : (['season_start', diff(day, cycle.start_date)] as const);
        return {
          type: o.type,
          title: o.title,
          anchor,
          offsetDays: Math.max(-400, Math.min(400, offsetDays)),
          bbchStage: o.bbchStage,
          notes: null,
          inputs: o.inputs.filter((i) => i.ratePerHa != null && i.ratePerHa > 0).map((i) => ({ productId: i.productId, ratePerHa: i.ratePerHa! })),
        };
      });
      return this.createIn(trx, ctx, { cropId: cycle.crop_id, name: input.name, notes: null, steps });
    });
  }

  private async createIn(trx: Trx, ctx: Ctx, input: Out<typeof TemplateInput>): Promise<CultivationTemplate> {
    await this.assertCrop(trx, input.cropId);
    await this.assertUniqueName(trx, input.cropId, input.name);
    const { id } = await trx
      .insertInto('cultivation_templates')
      .values({ organization_id: ctx.orgId, crop_id: input.cropId, name: input.name, notes: input.notes ?? null, created_by: ctx.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.writeSteps(trx, ctx, id, input);
    await record(trx, ctx, { entityType: 'template', entityId: id, action: 'created', changes: { name: input.name, steps: input.steps.length } });
    return (await this.loadTemplates(trx, id))[0];
  }

  /** One name per crop in the organization (reference: unique per organization and crop). */
  private async assertUniqueName(trx: Trx, cropId: string, name: string, except?: string) {
    let q = trx
      .selectFrom('cultivation_templates')
      .select('id')
      .where('crop_id', '=', cropId)
      .where('archived_at', 'is', null)
      .where(sql<boolean>`lower(name) = lower(${name})`);
    if (except) q = q.where('id', '<>', except);
    if (await q.executeTakeFirst()) throw conflict('template_exists', 'A template with this name already exists for this crop');
  }

  private async writeSteps(trx: Trx, ctx: Ctx, templateId: string, input: Out<typeof TemplateInput>) {
    const productIds = [...new Set(input.steps.flatMap((s) => s.inputs.map((i) => i.productId)))];
    if (productIds.length) {
      const found = await trx.selectFrom('products').select('id').where('id', 'in', productIds).execute();
      if (found.length !== productIds.length) throw notFound('Product');
    }
    // Steps are kept by position, so operations planned from a template stay linked to it when it is edited.
    const existing = new Map((await trx.selectFrom('template_steps').select(['id', 'position']).where('template_id', '=', templateId).execute()).map((r) => [r.position, r.id]));
    await trx.deleteFrom('template_steps').where('template_id', '=', templateId).where('position', '>=', input.steps.length).execute();
    for (const [position, step] of input.steps.entries()) {
      const values = {
        type: step.type,
        title: step.title,
        anchor: step.anchor,
        offset_days: step.offsetDays,
        bbch_stage: step.bbchStage ?? null,
        notes: step.notes ?? null,
      };
      let stepId = existing.get(position);
      if (stepId) {
        await trx.updateTable('template_steps').set(values).where('id', '=', stepId).execute();
        await trx.deleteFrom('template_step_inputs').where('step_id', '=', stepId).execute();
      } else {
        stepId = (
          await trx
            .insertInto('template_steps')
            .values({ organization_id: ctx.orgId, template_id: templateId, position, ...values })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      }
      if (step.inputs.length) {
        await trx
          .insertInto('template_step_inputs')
          .values(step.inputs.map((i) => ({ organization_id: ctx.orgId, step_id: stepId, product_id: i.productId, rate_per_ha: i.ratePerHa })))
          .execute();
      }
    }
  }

  private async loadTemplates(trx: Trx, id?: string): Promise<CultivationTemplate[]> {
    let q = trx
      .selectFrom('cultivation_templates as t')
      .innerJoin('crops as c', 'c.id', 't.crop_id')
      .select([
        't.id',
        't.crop_id',
        cropName('c').as('crop_name'),
        cropColor('c').as('color'),
        't.name',
        't.notes',
        't.updated_at',
        (eb) => eb.selectFrom('crop_cycles as cc').select((e) => e.fn.countAll<number>().as('n')).whereRef('cc.template_id', '=', 't.id').as('used_by'),
      ])
      .where('t.archived_at', 'is', null)
      .orderBy('t.name');
    if (id) q = q.where('t.id', '=', id);
    const rows = await q.execute();
    if (!rows.length) return [];
    const steps = await trx
      .selectFrom('template_steps')
      .selectAll()
      .where('template_id', 'in', rows.map((r) => r.id))
      .orderBy('position')
      .execute();
    const inputs = steps.length
      ? await trx
          .selectFrom('template_step_inputs as i')
          .innerJoin('products as p', 'p.id', 'i.product_id')
          .select(['i.step_id', 'i.product_id', 'p.name', 'p.base_unit', 'i.rate_per_ha'])
          .where('i.step_id', 'in', steps.map((s) => s.id))
          .orderBy('p.name')
          .execute()
      : [];
    return rows.map((r) => ({
      id: r.id,
      cropId: r.crop_id,
      cropName: r.crop_name,
      cropColor: r.color,
      name: r.name,
      notes: r.notes,
      usedBy: Number(r.used_by ?? 0),
      updatedAt: iso(r.updated_at),
      steps: steps
        .filter((s) => s.template_id === r.id)
        .map((s) => ({
          id: s.id,
          position: s.position,
          type: s.type as OperationType,
          title: s.title,
          anchor: s.anchor as TemplateAnchor,
          offsetDays: s.offset_days,
          bbchStage: s.bbch_stage,
          notes: s.notes,
          inputs: inputs
            .filter((i) => i.step_id === s.id)
            .map((i) => ({ productId: i.product_id, productName: i.name, baseUnit: i.base_unit as BaseUnit, ratePerHa: i.rate_per_ha })),
        })),
    }));
  }

  /**
   * Creates the template's steps as planned operations of the crop cycle. Dates are counted from
   * the crop's sowing or expected harvest date, falling back to the crop's typical dates in the season.
   */
  applyTemplate(ctx: Ctx, cropCycleId: string, input: Out<typeof ApplyTemplateInput>): Promise<ApplyTemplateResult> {
    return this.db.run(ctx, (trx) => this.applyTemplateIn(trx, ctx, cropCycleId, input.templateId, input.replace));
  }

  private async applyTemplateIn(trx: Trx, ctx: Ctx, cropCycleId: string, templateId: string, replace: boolean): Promise<ApplyTemplateResult> {
    const cycle = await trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('fields as f', 'f.id', 'cc.field_id')
      .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .select([
        'cc.id',
        'cc.field_id',
        'cc.field_part_id',
        'cc.crop_id',
        'cc.role',
        'cc.status',
        'cc.template_id',
        'cc.sowing_date',
        'cc.expected_harvest_date',
        'f.farm_id',
        's.harvest_year',
        's.start_date',
        's.end_date',
        'c.default_sowing_md',
        'c.default_harvest_md',
        'c.is_winter_crop',
      ])
      .where('cc.id', '=', cropCycleId)
      // Only the crop cycle is locked; catalogue crops are read-only for the API.
      .forUpdate('cc')
      .executeTakeFirst();
    if (!cycle) throw notFound('Crop cycle');
    if (cycle.status === 'closed') throw badRequest('crop_cycle_closed', 'This crop cycle is closed');
    const [template] = await this.loadTemplates(trx, templateId);
    if (!template) throw notFound('Template');
    if (template.cropId !== cycle.crop_id) throw badRequest('template_crop_mismatch', 'The template is for a different crop');

    const existing = await trx
      .selectFrom('operations as o')
      .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
      .select(['o.id', 'o.status'])
      .where('ofl.crop_cycle_id', '=', cropCycleId)
      .where('o.template_step_id', 'is not', null)
      .execute();
    if (existing.length && !replace) {
      throw conflict('template_applied', 'A template was already applied to this crop; replace its planned operations instead');
    }
    let removed = 0;
    const plannedIds = existing.filter((o) => o.status === 'planned').map((o) => o.id);
    if (plannedIds.length) {
      removed = Number((await trx.deleteFrom('operations').where('id', 'in', plannedIds).executeTakeFirst()).numDeletedRows);
    }

    const season = { harvestYear: cycle.harvest_year, startDate: cycle.start_date, endDate: cycle.end_date };
    const sownEarly = cycle.is_winter_crop || cycle.role !== 'main';
    const sowing = cycle.sowing_date ?? (cycle.default_sowing_md ? defaultDateInSeason(cycle.default_sowing_md, season, sownEarly) : null);
    let harvest = cycle.expected_harvest_date ?? (cycle.default_harvest_md ? defaultDateInSeason(cycle.default_harvest_md, season) : null);
    if (harvest && sowing && harvest <= sowing) harvest = null;

    let created = 0;
    for (const step of template.steps) {
      const date = stepDate(step.anchor, step.offsetDays, { sowing, harvest, seasonStart: cycle.start_date });
      const op = await this.operations.createIn(trx, ctx, {
        farmId: cycle.farm_id,
        type: step.type,
        title: step.title,
        status: 'planned',
        plannedOn: date,
        bbchStage: step.bbchStage ?? null,
        notes: step.notes ?? null,
        details: {},
        fields: [{ fieldId: cycle.field_id, fieldPartId: cycle.field_part_id, cropCycleId: cycle.id }],
        inputs: step.inputs.map((i) => ({ productId: i.productId, ratePerHa: i.ratePerHa })),
        labor: [],
        equipment: [],
      });
      await trx.updateTable('operations').set({ template_step_id: step.id }).where('id', '=', op.id).execute();
      created += 1;
    }
    await trx.updateTable('crop_cycles').set({ template_id: template.id }).where('id', '=', cropCycleId).execute();
    await record(trx, ctx, {
      entityType: 'crop_cycle',
      entityId: cropCycleId,
      action: 'template_applied',
      changes: { templateId: template.id, created, removed },
      event: { type: 'crop_cycle.updated', payload: { cropCycleId, templateId: template.id } },
    });
    return { cropCycleId, created, removed };
  }

  // ---------------------------------------------------------------------------
  // Rotations
  // ---------------------------------------------------------------------------

  rotations(ctx: Ctx): Promise<CropRotation[]> {
    return this.db.run(ctx, (trx) => this.loadRotations(trx));
  }

  createRotation(ctx: Ctx, input: Out<typeof RotationInput>): Promise<CropRotation> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('crop_rotations')
        .values({ organization_id: ctx.orgId, name: input.name, notes: input.notes ?? null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.writeEntries(trx, ctx, id, input);
      await record(trx, ctx, { entityType: 'crop_rotation', entityId: id, action: 'created', changes: { name: input.name, years: input.entries.length } });
      return (await this.loadRotations(trx, id))[0];
    });
  }

  updateRotation(ctx: Ctx, id: string, input: Out<typeof RotationInput>): Promise<CropRotation> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.updateTable('crop_rotations').set({ name: input.name, notes: input.notes ?? null }).where('id', '=', id).executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Crop rotation');
      await trx.deleteFrom('crop_rotation_entries').where('rotation_id', '=', id).execute();
      await this.writeEntries(trx, ctx, id, input);
      await record(trx, ctx, { entityType: 'crop_rotation', entityId: id, action: 'updated', changes: { name: input.name, years: input.entries.length } });
      return (await this.loadRotations(trx, id))[0];
    });
  }

  deleteRotation(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('crop_rotations').where('id', '=', id).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Crop rotation');
      await record(trx, ctx, { entityType: 'crop_rotation', entityId: id, action: 'deleted' });
    });
  }

  /** Puts fields on a rotation from a harvest year on; an open-ended period of the field ends the year before. */
  assignRotation(ctx: Ctx, rotationId: string, input: Out<typeof AssignRotationInput>): Promise<CropRotation> {
    return this.db.run(ctx, async (trx) => {
      const rotation = await trx.selectFrom('crop_rotations').select('id').where('id', '=', rotationId).executeTakeFirst();
      if (!rotation) throw notFound('Crop rotation');
      const fieldIds = [...new Set(input.fieldIds)];
      const fields = await trx.selectFrom('fields').select('id').where('id', 'in', fieldIds).execute();
      if (fields.length !== fieldIds.length) throw notFound('Field');
      // Close open periods that started earlier; later or overlapping fixed periods are a conflict (exclusion constraint).
      await trx
        .updateTable('field_crop_rotations')
        .set({ end_year: input.startYear - 1 })
        .where('field_id', 'in', fieldIds)
        .where('end_year', 'is', null)
        .where('start_year', '<', input.startYear)
        .execute();
      await trx.deleteFrom('field_crop_rotations').where('field_id', 'in', fieldIds).where('start_year', '>=', input.startYear).where('end_year', 'is', null).execute();
      await trx
        .insertInto('field_crop_rotations')
        .values(fieldIds.map((fieldId) => ({ organization_id: ctx.orgId, field_id: fieldId, rotation_id: rotationId, start_year: input.startYear, end_year: input.endYear ?? null })))
        .execute();
      await record(trx, ctx, { entityType: 'crop_rotation', entityId: rotationId, action: 'fields_assigned', changes: { fields: fieldIds.length, startYear: input.startYear } });
      return (await this.loadRotations(trx, rotationId))[0];
    });
  }

  unassignRotation(ctx: Ctx, assignmentId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.deleteFrom('field_crop_rotations').where('id', '=', assignmentId).returning(['rotation_id', 'field_id']).executeTakeFirst();
      if (!row) throw notFound('Rotation assignment');
      await record(trx, ctx, { entityType: 'crop_rotation', entityId: row.rotation_id, action: 'field_removed', changes: { fieldId: row.field_id } });
    });
  }

  /**
   * Plans a season from the rotations: every field following a rotation in the season's harvest
   * year gets the rotation's next crop (and the catch crop sown ahead of it), unless it already has
   * a main crop there. Repeating the roll-over creates nothing new.
   */
  /**
   * Plans a season by repeating last season's crops: for each field without a crop in the
   * target season, its whole-field crops of the previous harvest year are copied (crop,
   * variety, role, template, expected yield; no dates). Divided fields are skipped.
   */
  carryForward(ctx: Ctx, input: Out<typeof CarryForwardInput>): Promise<CarryForwardResult> {
    return this.db.run(ctx, async (trx) => {
      if (input.applyTemplates && !can(ctx.role, 'operation.write')) throw forbidden('Applying templates needs permission to plan operations');
      const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year']).where('id', '=', input.targetSeasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      let fq = trx.selectFrom('fields').select(['id', 'name']).where('status', '=', 'active').orderBy('name');
      if (input.fieldIds) fq = fq.where('id', 'in', input.fieldIds.length ? input.fieldIds : ['00000000-0000-0000-0000-000000000000']);
      const fields = await fq.execute();
      const result: CarryForwardResult = { created: 0, fields: [] };
      if (!fields.length) return result;
      const ids = fields.map((f) => f.id);
      const planned = new Set((await trx.selectFrom('crop_cycles').select('field_id').where('season_id', '=', season.id).where('field_id', 'in', ids).execute()).map((r) => r.field_id));
      const divided = new Set((await trx.selectFrom('field_parts').select('field_id').where('season_id', '=', season.id).where('field_id', 'in', ids).execute()).map((r) => r.field_id));
      const previous = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .innerJoin('crops as c', 'c.id', 'cc.crop_id')
        .select(['cc.field_id', 'cc.crop_id', 'cc.variety_id', 'cc.role', 'cc.template_id', 'cc.expected_yield_t_ha', 'cc.land_use_code', cropName('c').as('crop_name')])
        .where('s.harvest_year', '=', season.harvest_year - 1)
        .where('cc.field_part_id', 'is', null)
        .where('cc.field_id', 'in', ids)
        .orderBy(sql`array_position(array['catch_crop','main','undersown'], cc.role)`)
        .execute();
      for (const f of fields) {
        const prev = previous.filter((p) => p.field_id === f.id)
        const main = prev.find((p) => p.role === 'main') ?? prev[0]
        if (planned.has(f.id) || divided.has(f.id)) {
          result.fields.push({ fieldId: f.id, fieldName: f.name, cropName: main?.crop_name ?? null, outcome: divided.has(f.id) ? 'field_divided' : 'already_planned' });
          continue;
        }
        if (!prev.length) {
          result.fields.push({ fieldId: f.id, fieldName: f.name, cropName: null, outcome: 'no_previous' });
          continue;
        }
        for (const p of prev) {
          const { id } = await trx
            .insertInto('crop_cycles')
            .values({
              organization_id: ctx.orgId,
              field_id: f.id,
              season_id: season.id,
              crop_id: p.crop_id,
              variety_id: p.variety_id,
              role: p.role,
              status: 'planned',
              expected_yield_t_ha: p.expected_yield_t_ha,
              land_use_code: p.land_use_code,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await record(trx, ctx, {
            entityType: 'crop_cycle',
            entityId: id,
            action: 'created',
            changes: { fieldId: f.id, cropId: p.crop_id, seasonId: season.id, role: p.role, carriedForward: true },
            event: { type: 'crop_cycle.created', payload: { cropCycleId: id, fieldId: f.id, fieldPartId: null, cropId: p.crop_id, seasonId: season.id } },
          });
          if (p.template_id && input.applyTemplates) await this.applyTemplateIn(trx, ctx, id, p.template_id, false);
          result.created += 1;
        }
        result.fields.push({ fieldId: f.id, fieldName: f.name, cropName: main.crop_name, outcome: 'created' });
      }
      return result;
    });
  }

  rollOver(ctx: Ctx, input: Out<typeof RollOverInput>): Promise<RollOverResult> {
    return this.db.run(ctx, async (trx) => {
      // Applying templates plans operations, which needs the right to plan work.
      if (input.applyTemplates && !can(ctx.role, 'operation.write')) throw forbidden('Applying templates needs permission to plan operations');
      const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year']).where('id', '=', input.targetSeasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const year = season.harvest_year;
      const assignments = await trx
        .selectFrom('field_crop_rotations as a')
        .innerJoin('fields as f', 'f.id', 'a.field_id')
        .select(['a.field_id', 'a.rotation_id', 'a.start_year', 'f.name as field_name'])
        .where('f.status', '=', 'active')
        .where('a.start_year', '<=', year)
        .where((eb) => eb.or([eb('a.end_year', 'is', null), eb('a.end_year', '>=', year)]))
        .orderBy('f.name')
        .execute();
      const result: RollOverResult = { created: 0, skipped: 0, fields: [] };
      if (!assignments.length) return result;

      const entries = await trx
        .selectFrom('crop_rotation_entries as e')
        .innerJoin('crops as c', 'c.id', 'e.crop_id')
        .select(['e.rotation_id', 'e.position', 'e.crop_id', 'e.template_id', 'e.catch_crop_id', 'e.expected_yield_t_ha', cropName('c').as('crop_name')])
        .where('e.rotation_id', 'in', [...new Set(assignments.map((a) => a.rotation_id))])
        .execute();
      const fieldIds = assignments.map((a) => a.field_id);
      const existing = await trx
        .selectFrom('crop_cycles')
        .select('field_id')
        .where('season_id', '=', season.id)
        .where('role', '=', 'main')
        .where('field_id', 'in', fieldIds)
        .execute();
      const planned = new Set(existing.map((r) => r.field_id));
      const divided = new Set(
        (await trx.selectFrom('field_parts').select('field_id').where('season_id', '=', season.id).where('field_id', 'in', fieldIds).execute()).map((r) => r.field_id),
      );
      const previous = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .select(['cc.field_id', 'cc.crop_id', 'cc.template_id'])
        .where('s.harvest_year', '=', year - 1)
        .where('cc.role', '=', 'main')
        .where('cc.field_id', 'in', fieldIds)
        .orderBy('cc.area_ha', sql`desc nulls first`)
        .execute();
      const prevOf = new Map<string, { cropId: string; templateId: string | null }>();
      for (const p of previous) if (!prevOf.has(p.field_id)) prevOf.set(p.field_id, { cropId: p.crop_id, templateId: p.template_id });

      for (const a of assignments) {
        const rotationEntries = entries.filter((e) => e.rotation_id === a.rotation_id);
        if (!rotationEntries.length) continue;
        const prev = prevOf.get(a.field_id) ?? null;
        const pos = nextRotationPosition(
          rotationEntries.map((e) => ({ position: e.position, cropId: e.crop_id, templateId: e.template_id })),
          prev,
          year,
          a.start_year,
        );
        const entry = rotationEntries.find((e) => e.position === pos)!;
        if (planned.has(a.field_id) || divided.has(a.field_id)) {
          result.skipped += 1;
          result.fields.push({ fieldId: a.field_id, fieldName: a.field_name, cropName: entry.crop_name, outcome: divided.has(a.field_id) ? 'field_divided' : 'already_planned' });
          continue;
        }
        // The catch crop of the entry the field grew last season is sown ahead of this season's crop.
        const prevEntry = prev ? rotationEntries.find((e) => e.crop_id === prev.cropId && e.catch_crop_id) : undefined;
        const toCreate: { cropId: string; role: CropRole; templateId: string | null; yield: number | null }[] = [];
        if (prevEntry?.catch_crop_id) toCreate.push({ cropId: prevEntry.catch_crop_id, role: 'catch_crop', templateId: null, yield: null });
        toCreate.push({ cropId: entry.crop_id, role: 'main', templateId: entry.template_id, yield: entry.expected_yield_t_ha });
        for (const c of toCreate) {
          const { id } = await trx
            .insertInto('crop_cycles')
            .values({
              organization_id: ctx.orgId,
              field_id: a.field_id,
              season_id: season.id,
              crop_id: c.cropId,
              role: c.role,
              status: 'planned',
              expected_yield_t_ha: c.yield,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await record(trx, ctx, {
            entityType: 'crop_cycle',
            entityId: id,
            action: 'created',
            changes: { fieldId: a.field_id, cropId: c.cropId, seasonId: season.id, role: c.role, rotationId: a.rotation_id },
            event: { type: 'crop_cycle.created', payload: { cropCycleId: id, fieldId: a.field_id, fieldPartId: null, cropId: c.cropId, seasonId: season.id } },
          });
          if (c.templateId && input.applyTemplates) await this.applyTemplateIn(trx, ctx, id, c.templateId, false);
          result.created += 1;
        }
        result.fields.push({ fieldId: a.field_id, fieldName: a.field_name, cropName: entry.crop_name, outcome: 'created' });
      }
      return result;
    });
  }

  private async writeEntries(trx: Trx, ctx: Ctx, rotationId: string, input: Out<typeof RotationInput>) {
    const cropIds = [...new Set(input.entries.flatMap((e) => [e.cropId, e.catchCropId].filter((x): x is string => !!x)))];
    const crops = await trx.selectFrom('crops').select('id').where('id', 'in', cropIds).execute();
    if (crops.length !== cropIds.length) throw notFound('Crop');
    await trx
      .insertInto('crop_rotation_entries')
      .values(
        input.entries.map((e, position) => ({
          organization_id: ctx.orgId,
          rotation_id: rotationId,
          position,
          crop_id: e.cropId,
          template_id: e.templateId ?? null,
          catch_crop_id: e.catchCropId ?? null,
          expected_yield_t_ha: e.expectedYieldTHa ?? null,
        })),
      )
      .execute();
  }

  private async loadRotations(trx: Trx, id?: string): Promise<CropRotation[]> {
    let q = trx.selectFrom('crop_rotations').select(['id', 'name', 'notes']).orderBy('name');
    if (id) q = q.where('id', '=', id);
    const rows = await q.execute();
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const entries = await trx
      .selectFrom('crop_rotation_entries as e')
      .innerJoin('crops as c', 'c.id', 'e.crop_id')
      .leftJoin('crops as cc', 'cc.id', 'e.catch_crop_id')
      .leftJoin('cultivation_templates as t', 't.id', 'e.template_id')
      .select([
        'e.rotation_id',
        'e.position',
        'e.crop_id',
        cropName('c').as('crop_name'),
        cropColor('c').as('color'),
        'e.template_id',
        't.name as template_name',
        'e.catch_crop_id',
        cropName<string | null>('cc').as('catch_crop_name'),
        'e.expected_yield_t_ha',
      ])
      .where('e.rotation_id', 'in', ids)
      .orderBy('e.position')
      .execute();
    const fields = await trx
      .selectFrom('field_crop_rotations as a')
      .innerJoin('fields as f', 'f.id', 'a.field_id')
      .select(['a.id', 'a.rotation_id', 'a.field_id', 'f.name', 'a.start_year', 'a.end_year'])
      .where('a.rotation_id', 'in', ids)
      .orderBy('f.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes,
      entries: entries
        .filter((e) => e.rotation_id === r.id)
        .map((e) => ({
          position: e.position,
          cropId: e.crop_id,
          cropName: e.crop_name,
          cropColor: e.color,
          templateId: e.template_id,
          templateName: e.template_name,
          catchCropId: e.catch_crop_id,
          catchCropName: e.catch_crop_name,
          expectedYieldTHa: e.expected_yield_t_ha,
        })),
      fields: fields
        .filter((f) => f.rotation_id === r.id)
        .map((f) => ({ id: f.id, fieldId: f.field_id, fieldName: f.name, startYear: f.start_year, endYear: f.end_year })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Crop calendar
  // ---------------------------------------------------------------------------

  calendar(ctx: Ctx, seasonId?: string): Promise<CropCalendar> {
    return this.db.run(ctx, async (trx) => {
      const ref = await resolveSeason(trx, seasonId);
      if (!ref) throw notFound('Season');
      const s = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year', 'start_date', 'end_date']).where('id', '=', ref.id).executeTakeFirstOrThrow();
      const rows = await this.calendarRows(trx, s);
      const dates = rows.flatMap((r) => [r.sowing?.date, r.harvest?.date, ...r.operations.map((o) => o.date)]).filter((d): d is string => !!d);
      const from = [s.start_date, ...dates].sort()[0];
      const to = [s.end_date, ...dates].sort().at(-1)!;
      return { seasonId: s.id, from, to, rows };
    });
  }

  /** The calendar of several harvest years, with every active field as a row. */
  calendarYears(ctx: Ctx, q: Out<typeof CalendarYearsQuery>): Promise<CropCalendarYears> {
    if (q.toYear < q.fromYear || q.toYear - q.fromYear > 10) throw badRequest('invalid_range', 'Choose up to ten consecutive years');
    return this.db.run(ctx, async (trx) => {
      const seasons = await trx
        .selectFrom('growing_seasons')
        .select(['id', 'name', 'harvest_year', 'start_date', 'end_date'])
        .where('harvest_year', '>=', q.fromYear)
        .where('harvest_year', '<=', q.toYear)
        .orderBy('harvest_year')
        .execute();
      const rows: CalendarRow[] = [];
      for (const s of seasons) rows.push(...(await this.calendarRows(trx, s)));
      const fields = await trx
        .selectFrom('fields as f')
        .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select(['f.id', 'f.name', 'g.area_ha'])
        .where('f.status', '=', 'active')
        .orderBy('f.name')
        .execute();
      return {
        seasons: seasons.map((s) => ({ id: s.id, name: s.name, harvestYear: s.harvest_year, startDate: s.start_date, endDate: s.end_date })),
        fields: fields.map((f) => ({ id: f.id, name: f.name, areaHa: f.area_ha ?? 0 })),
        rows,
      };
    });
  }

  private async calendarRows(trx: Trx, s: { id: string; harvest_year: number; start_date: string; end_date: string }): Promise<CalendarRow[]> {
    const season = { harvestYear: s.harvest_year, startDate: s.start_date, endDate: s.end_date };
    const cycles = await trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('fields as f', 'f.id', 'cc.field_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .leftJoin('crop_varieties as v', 'v.id', 'cc.variety_id')
      .select([
        'cc.id',
        'cc.crop_id',
        'cc.variety_id',
        'v.name as variety_name',
        'cc.field_part_id',
        'cc.usage',
        'cc.seed_lot',
        'cc.multiplication_generation',
        'cc.template_id',
        'cc.field_id',
        'f.name as field_name',
        'fp.name as part_name',
        sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)`.as('area_ha'),
        cropName('c').as('crop_name'),
        cropColor('c').as('color'),
        'c.is_winter_crop',
        'c.default_sowing_md',
        'c.default_harvest_md',
        'cc.role',
        'cc.sowing_date',
        'cc.expected_harvest_date',
      ])
      .where('cc.season_id', '=', s.id)
      .orderBy('f.name')
      .orderBy(sql`fp.sort_order nulls first`)
      .orderBy(sql`array_position(array['catch_crop','undersown','main'], cc.role)`)
      .execute();
    const ops = cycles.length
      ? await trx
          .selectFrom('operations as o')
          .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
          .select([
            'o.id',
            'o.type',
            'o.title',
            'o.status',
            'ofl.crop_cycle_id',
            sql<string>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)::text`.as('day'),
          ])
          .where('ofl.crop_cycle_id', 'in', cycles.map((c) => c.id))
          .where('o.status', '<>', 'canceled')
          .where(sql<boolean>`coalesce(o.performed_at::date, o.planned_on) IS NOT NULL`)
          .orderBy('day')
          .execute()
      : [];
    const harvests = cycles.length
      ? await trx.selectFrom('harvests').select(['crop_cycle_id', (eb) => eb.fn.max('harvest_date').as('last')]).where('crop_cycle_id', 'in', cycles.map((c) => c.id)).groupBy('crop_cycle_id').execute()
      : [];
    const harvestOf = new Map(harvests.map((h) => [h.crop_cycle_id, h.last as string]));

    return cycles.map((c) => {
      const own = ops.filter((o) => o.crop_cycle_id === c.id);
      const done = (type: string) => own.filter((o) => o.type === type && o.status === 'completed').map((o) => o.day);
      const plannedOp = (type: string) => own.find((o) => o.type === type && o.status !== 'completed')?.day ?? null;
      const sownEarly = c.is_winter_crop || c.role !== 'main';
      const recordedSowing = done('sowing')[0];
      const recordedHarvest = harvestOf.get(c.id) ?? done('harvest').at(-1);
      const sowing = recordedSowing
        ? { date: recordedSowing, source: 'recorded' as const }
        : (c.sowing_date ?? plannedOp('sowing'))
          ? { date: (c.sowing_date ?? plannedOp('sowing'))!, source: 'planned' as const }
          : c.default_sowing_md
            ? { date: defaultDateInSeason(c.default_sowing_md, season, sownEarly), source: 'default' as const }
            : null;
      let harvest = recordedHarvest
        ? { date: recordedHarvest, source: 'recorded' as const }
        : (c.expected_harvest_date ?? plannedOp('harvest'))
          ? { date: (c.expected_harvest_date ?? plannedOp('harvest'))!, source: 'planned' as const }
          : c.default_harvest_md
            ? { date: defaultDateInSeason(c.default_harvest_md, season), source: 'default' as const }
            : null;
      // A default that would end before the crop is sown is no information.
      if (harvest && sowing && harvest.date < sowing.date) harvest = harvest.source === 'default' ? null : harvest;
      return {
        cropCycleId: c.id,
        seasonId: s.id,
        harvestYear: s.harvest_year,
        cropId: c.crop_id,
        varietyId: c.variety_id,
        varietyName: c.variety_name,
        fieldPartId: c.field_part_id,
        usage: c.usage as CropUsage,
        seedLot: c.seed_lot,
        multiplicationGeneration: c.multiplication_generation,
        templateId: c.template_id,
        fieldId: c.field_id,
        fieldName: c.field_name,
        fieldPartName: c.part_name,
        areaHa: c.area_ha,
        cropName: c.crop_name,
        cropColor: c.color,
        role: c.role as CropRole,
        sowing,
        harvest,
        operations: own.map((o) => ({ id: o.id, type: o.type as OperationType, title: o.title, status: o.status as OperationStatus, date: o.day })),
      };
    });
  }

  private async assertCrop(trx: Trx, cropId: string) {
    const crop = await trx.selectFrom('crops').select('id').where('id', '=', cropId).executeTakeFirst();
    if (!crop) throw notFound('Crop');
  }
}
