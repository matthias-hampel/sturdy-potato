import { Injectable } from '@nestjs/common';
import type { ComplianceIssue, ComplianceReport, Operation, OperationType } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { csvCell } from '../../core/csv.js';
import { record } from '../../core/events.js';
import { dateIn, round, today } from '../../core/mappers.js';
import { Database } from '../../db/database.js';
import { resolveSeason } from '../crops/seasons.js';
import { OperationsService } from '../operations/operations.service.js';
import { NutrientsService } from '../nutrients/nutrients.service.js';
import { ProtectionService } from '../protection/protection.service.js';

/**
 * Record-completeness checks for application records. Rule sets are versioned so exports
 * can state which rules they were checked against (ADR-007). These checks find missing
 * documentation; they are not a legal compliance assessment and must be reviewed by
 * domain experts before being relied upon.
 */
const RULESET = {
  id: 'DE-2026.1-preliminary',
  // DüV §10 (2): fertilization measures are to be recorded no later than two days after application.
  fertilizationRecordDeadlineDays: 2,
};

const RECORDED_TYPES: OperationType[] = ['fertilization', 'crop_protection'];

@Injectable()
export class ComplianceService {
  constructor(
    private readonly db: Database,
    private readonly operations: OperationsService,
    private readonly protection: ProtectionService,
    private readonly nutrients: NutrientsService,
  ) {}

  report(ctx: Ctx, seasonId?: string): Promise<ComplianceReport> {
    return this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx, seasonId);
      const ids = await this.operationIds(trx, season, ['completed', 'planned', 'in_progress']);
      const ops = await this.operations.load(trx, ids);
      const registration = await this.productRegistrations(trx, ops);

      const issues: ComplianceIssue[] = [];
      let checked = 0;
      let complete = 0;
      const now = today();
      for (const op of ops) {
        const add = (severity: ComplianceIssue['severity'], code: string, message: string) =>
          issues.push({
            operationId: op.id,
            operationTitle: op.title,
            operationType: op.type,
            performedAt: op.performedAt,
            severity,
            code,
            message,
            fieldNames: op.fields.map(fieldLabel),
          });

        if (op.status !== 'completed') {
          const overdueBy = op.plannedOn ? daysBetween(op.plannedOn, now) : 0;
          if (overdueBy > RULESET.fertilizationRecordDeadlineDays) {
            add('warning', 'unrecorded_application', `Planned for ${op.plannedOn} but not recorded as completed. Record it if the work was carried out.`);
          }
          continue;
        }

        checked += 1;
        const before = issues.length;
        if (op.inputs.length === 0) add('error', 'missing_product', 'No product and quantity recorded.');
        if (!op.responsibleEmployee && !op.contractorName) add('error', 'missing_operator', 'No responsible person or contractor recorded.');
        const withoutCrop = op.fields.filter((f) => !f.cropCycleId);
        if (withoutCrop.length) {
          add(
            op.type === 'crop_protection' ? 'error' : 'warning',
            'missing_crop',
            `No crop assigned on ${withoutCrop.map(fieldLabel).join(', ')}.`,
          );
        }
        if (op.type === 'crop_protection') {
          const unregistered = op.inputs.filter((i) => i.category === 'crop_protection' && !registration.get(i.productId)?.registration);
          if (unregistered.length) {
            add('warning', 'missing_registration_number', `Authorization number missing for ${unregistered.map((i) => i.productName).join(', ')}.`);
          }
          if (!op.bbchStage) add('warning', 'missing_bbch', 'Crop growth stage (BBCH) not recorded.');
          if (!op.targetOrganism) add('warning', 'missing_target', 'Target organism / indication not recorded.');
        }
        if (op.type === 'fertilization') {
          const noNutrients = op.inputs.filter((i) => i.category === 'fertilizer' && !registration.get(i.productId)?.hasNutrients);
          if (noNutrients.length) {
            add('warning', 'missing_nutrient_content', `Nutrient content missing for ${noNutrients.map((i) => i.productName).join(', ')}; nutrient totals cannot be calculated.`);
          }
          if (op.performedAt && op.completedAt) {
            const delay = daysBetween(dateIn(new Date(op.performedAt)), dateIn(new Date(op.completedAt)));
            if (delay > RULESET.fertilizationRecordDeadlineDays) {
              add('warning', 'late_record', `Recorded ${delay} days after application (DüV §10 deadline: ${RULESET.fertilizationRecordDeadlineDays} days).`);
            }
          }
        }
        if (issues.length === before) complete += 1;
      }

      // Fertilization in a closed period (Sperrfrist): a breach when recorded, a warning when planned.
      const fieldNames = new Map(ops.flatMap((o) => o.fields.map((f) => [f.fieldId, f.fieldName] as const)));
      for (const f of await this.nutrients.closedPeriodFindings(trx, ops.filter((o) => o.type === 'fertilization').map((o) => o.id))) {
        const op = ops.find((o) => o.id === f.operationId)!;
        const from = `${f.period.from.slice(3)}.${f.period.from.slice(0, 2)}.`;
        const to = `${f.period.to.slice(3)}.${f.period.to.slice(0, 2)}.`;
        issues.push({
          operationId: op.id,
          operationTitle: op.title,
          operationType: op.type,
          performedAt: op.performedAt,
          severity: op.status === 'completed' ? 'error' : 'warning',
          code: 'closed_period',
          message: `${f.date} is in the closed period ${from}–${to} (${f.period.rule}).`,
          fieldNames: [fieldNames.get(f.fieldId) ?? ''],
        });
      }

      // Deviations from the plant-protection approvals (BVL register), for recorded and planned work.
      const psm = await this.protection.check(trx, ops.filter((o) => o.type === 'crop_protection').map((o) => o.id));
      const opById = new Map(ops.map((o) => [o.id, o]));
      for (const f of psm.findings) {
        const op = opById.get(f.operationId);
        if (!op) continue;
        issues.push({
          operationId: op.id,
          operationTitle: op.title,
          operationType: op.type,
          performedAt: op.performedAt,
          severity: f.severity === 'deviation' ? 'error' : 'warning',
          code: `psm.${f.code}`,
          message: `${f.productName}${f.fieldName ? ` (${f.fieldName})` : ''}: ${f.message}`,
          fieldNames: f.fieldName ? [f.fieldName] : [],
        });
      }
      return { seasonId: season?.id ?? null, checkedOperations: checked, completeOperations: complete, issues, ruleset: RULESET.id };
    });
  }

  /** Application records (fertilization and crop protection) as CSV, one row per field (or part field) and product. */
  applicationRecordsCsv(ctx: Ctx, seasonId?: string): Promise<{ filename: string; csv: string }> {
    return this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx, seasonId);
      const ops = await this.operations.load(trx, await this.operationIds(trx, season, ['completed']));
      const products = await this.productRegistrations(trx, ops);
      const header = [
        'operation_id', 'type', 'performed_at', 'farm', 'field', 'field_part', 'field_identifier', 'crop', 'treated_area_ha', 'bbch_stage',
        'target_organism', 'product', 'registration_number', 'rate_per_ha', 'quantity', 'unit', 'n_kg_ha', 'nh4_n_kg_ha', 'p2o5_kg_ha',
        'k2o_kg_ha', 'mgo_kg_ha', 'responsible', 'contractor', 'weather', 'ruleset',
      ];
      const fieldIds = [...new Set(ops.flatMap((o) => o.fields.map((f) => f.fieldId)))];
      const identifiers = new Map(
        fieldIds.length
          ? (await trx.selectFrom('fields').select(['id', 'identifier']).where('id', 'in', fieldIds).execute()).map((f) => [f.id, f.identifier])
          : [],
      );

      const rows: (string | number | null)[][] = [];
      for (const op of ops) {
        for (const f of op.fields) {
          const share = op.totalAreaHa ? f.treatedAreaHa / op.totalAreaHa : 0;
          for (const i of op.inputs) {
            const p = products.get(i.productId);
            const rate = i.ratePerHa ?? (f.treatedAreaHa ? (i.totalQuantity * share) / f.treatedAreaHa : null);
            const nutrients = i.nutrients;
            rows.push([
              op.id, op.type, op.performedAt, op.farmName, f.fieldName, f.fieldPartName, identifiers.get(f.fieldId) ?? null, f.cropName,
              f.treatedAreaHa, op.bbchStage, op.targetOrganism, i.productName, p?.registration ?? null,
              rate == null ? null : round(rate, 4), round(i.totalQuantity * share, 4), i.baseUnit,
              nutrients?.n ?? null, nutrients?.nh4N ?? null, nutrients?.p2o5 ?? null, nutrients?.k2o ?? null, nutrients?.mgo ?? null, op.responsibleEmployee?.name ?? null, op.contractorName,
              op.weatherConditions, RULESET.id,
            ]);
          }
        }
      }
      await record(trx, ctx, {
        entityType: 'organization',
        entityId: ctx.orgId,
        action: 'application_records_exported',
        changes: { seasonId: season?.id ?? null, rows: rows.length, ruleset: RULESET.id },
      });
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
      return { filename: `application-records-${season?.name.replace(/\s+/g, '-').toLowerCase() ?? 'all'}.csv`, csv };
    });
  }

  private async operationIds(trx: Parameters<OperationsService['load']>[0], season: { start_date: string; end_date: string } | null, statuses: string[]) {
    let q = trx
      .selectFrom('operations as o')
      .select('o.id')
      .where('o.type', 'in', RECORDED_TYPES)
      .where('o.status', 'in', statuses)
      .orderBy(sql`coalesce(o.performed_at::date, o.planned_on)`);
    if (season) {
      const day = sql<string>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)`;
      q = q.where(day, '>=', season.start_date).where(day, '<=', season.end_date);
    }
    return (await q.execute()).map((r) => r.id);
  }

  private async productRegistrations(trx: Parameters<OperationsService['load']>[0], ops: Operation[]) {
    const ids = [...new Set(ops.flatMap((o) => o.inputs.map((i) => i.productId)))];
    if (!ids.length) return new Map<string, { registration: string | null; hasNutrients: boolean; n: number | null; p: number | null; k: number | null }>();
    const rows = await trx
      .selectFrom('products')
      .select(['id', 'registration_number', 'n_pct', 'p2o5_pct', 'k2o_pct'])
      .where('id', 'in', ids)
      .execute();
    return new Map(
      rows.map((r) => [
        r.id,
        {
          registration: r.registration_number,
          hasNutrients: r.n_pct != null || r.p2o5_pct != null || r.k2o_pct != null,
          n: r.n_pct,
          p: r.p2o5_pct,
          k: r.k2o_pct,
        },
      ]),
    );
  }
}

/** The field, with the part (Teilschlag) when the operation was recorded on one. */
function fieldLabel(f: Operation['fields'][number]) {
  return f.fieldPartName ? `${f.fieldName} · ${f.fieldPartName}` : f.fieldName;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
