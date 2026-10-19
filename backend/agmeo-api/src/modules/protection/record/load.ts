/**
 * The farm's plant-protection applications of one year, assembled once for the readiness check
 * and the record files — one loader, because the two must not disagree.
 *
 * Ported from agmeo `src/lib/protection/load.ts`, adapted to the rewrite's schema:
 *
 * - The unit of the law is the application, one pass over a field. Here an operation may cover
 *   several fields and field parts, so every field line of a completed crop-protection operation
 *   is one pass (`passId` = the operation_fields row); its crop-protection input lines are the
 *   products of that pass. A pass without any product is still a documented, incomplete
 *   application.
 * - The year is the calendar year of the application day (Europe/Berlin), for planned passes the
 *   planned day — operations are not tied to a crop year, and a pass on a field without a crop
 *   must still show up (with the crop as gap).
 * - Deviations from the approval and the approved use come from `ProtectionService.check`, the
 *   port of `bvlChecks.ts` the operation page uses. The approved use is taken where it is
 *   determined (chosen on the operation, or the only one for the crop); with several candidates
 *   the target organism and waiting period stay open rather than guessed.
 * - The applicator is the operation's responsible employee, else its workers, else the
 *   contractor. The time of day is the time entered with the performed date.
 * - BVL Auflagen are not part of the rewrite's register copy, so no application is marked as
 *   needing the time of day (NT127); `timeOfDayRequired` stays false until they are synced.
 */
import { type PsmAttestations, PSM_USAGE_TYPES, type PsmUsageType } from '@agmeo/contracts';
import { sql } from 'kysely';
import { dateIn, round } from '../../../core/mappers.js';
import type { Trx } from '../../../db/database.js';
import type { OperationsService } from '../../operations/operations.service.js';
import type { ProtectionService } from '../protection.service.js';
import { parseBbch } from '../psm-checks.js';
import type { PlannedPass } from './conversion.js';
import { type BvlFinding, USAGE_TYPE_CODES } from './eu-export.js';
import type { ApplicationRecord } from './records.js';

export interface ProtectionLoad {
  year: number;
  /** Documented applications — the ones the law is about. */
  documented: ApplicationRecord[];
  /** Planned passes, counted so the answer can say they are not records yet. */
  planned: number;
  /** The planned passes themselves, for the Art. 3 conversion window. */
  plannedPasses: PlannedPass[];
  /** Crop cycle per documented pass. */
  cultivationOf: Map<string, string>;
  /** Sachkundenachweis and sprayer inspection. */
  attestations: PsmAttestations | undefined;
  /** Deviations from the BVL approval of the documented applications. */
  bvl: BvlFinding[];
}

const TIME_ZONE = 'Europe/Berlin';
const performedDay = sql<string>`(o.performed_at AT TIME ZONE 'Europe/Berlin')::date`;
const plannedDay = sql<string>`coalesce(o.planned_on, o.due_on)`;

const timeOfDay = (instant: string) => new Date(instant).toLocaleTimeString('de-DE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });

export async function loadProtection(trx: Trx, services: { operations: OperationsService; protection: ProtectionService }, year: number): Promise<ProtectionLoad> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const ids = await trx
    .selectFrom('operations as o')
    .select(['o.id', 'o.status'])
    .where('o.type', '=', 'crop_protection')
    .where((eb) =>
      eb.or([
        eb.and([eb('o.status', '=', 'completed'), eb(performedDay, '>=', from), eb(performedDay, '<=', to)]),
        eb.and([eb('o.status', 'in', ['planned', 'in_progress']), eb(plannedDay, '>=', from), eb(plannedDay, '<=', to)]),
      ]),
    )
    .execute();
  const attestations = await loadAttestations(trx);
  const load: ProtectionLoad = { year, documented: [], planned: 0, plannedPasses: [], cultivationOf: new Map(), attestations, bvl: [] };
  if (!ids.length) return load;

  const documentedIds = ids.filter((r) => r.status === 'completed').map((r) => r.id);
  const ops = await services.operations.load(trx, ids.map((r) => r.id));
  const passes = await trx
    .selectFrom('operation_fields as ofl')
    .innerJoin('fields as f', 'f.id', 'ofl.field_id')
    .leftJoin('field_parts as fp', 'fp.id', 'ofl.field_part_id')
    .leftJoin('crop_cycles as cc', 'cc.id', 'ofl.crop_cycle_id')
    .leftJoin('crops as c', 'c.id', 'cc.crop_id')
    .select([
      'ofl.id',
      'ofl.operation_id',
      'ofl.field_id',
      'ofl.field_part_id',
      'ofl.crop_cycle_id',
      'ofl.treated_area_ha',
      'f.name as field_name',
      'fp.name as part_name',
      'f.identifier',
      'c.eppo_code',
      sql<boolean>`exists (SELECT 1 FROM field_geometry_versions g WHERE g.field_id = f.id)`.as('has_geometry'),
    ])
    .where(
      'ofl.operation_id',
      'in',
      ids.map((r) => r.id),
    )
    .orderBy('f.name')
    .orderBy('fp.name')
    .execute();
  const passesOf = new Map<string, typeof passes>();
  for (const p of passes) passesOf.set(p.operation_id, [...(passesOf.get(p.operation_id) ?? []), p]);

  const productIds = [...new Set(ops.flatMap((o) => o.inputs.map((i) => i.productId)))];
  const registration = new Map(
    productIds.length ? (await trx.selectFrom('products').select(['id', 'registration_number']).where('id', 'in', productIds).execute()).map((p) => [p.id, p.registration_number]) : [],
  );
  const { findings, uses } = await services.protection.check(trx, documentedIds);
  const targetCodes = [...new Set(uses.flatMap((u) => u.targetCodes))];
  const targetText = new Map(
    targetCodes.length ? (await trx.selectFrom('psm_codes').select(['code', 'text']).where('code', 'in', targetCodes).execute()).map((c) => [c.code, c.text]) : [],
  );

  for (const op of ops) {
    const lines = passesOf.get(op.id) ?? [];
    const fieldName = (p: (typeof passes)[number]) => (p.part_name ? `${p.field_name} · ${p.part_name}` : p.field_name);
    if (op.status !== 'completed') {
      for (const p of lines) {
        load.plannedPasses.push({ operationId: op.id, passId: p.id, date: op.plannedOn ?? op.dueOn, cropCycleId: p.crop_cycle_id, fieldId: p.field_id, fieldName: fieldName(p) });
      }
      continue;
    }

    const usage = op.details.usageType;
    const inputs = op.inputs.filter((i) => i.category === 'crop_protection');
    const base = {
      operationId: op.id,
      date: op.performedAt ? dateIn(new Date(op.performedAt)) : null,
      timeOfDay: op.performedAt ? timeOfDay(op.performedAt) : null,
      applicatorName: op.responsibleEmployee?.name ?? (op.labor.map((l) => l.employeeName).join(', ') || null) ?? op.contractorName,
      usageType: typeof usage === 'string' && (PSM_USAGE_TYPES as readonly string[]).includes(usage) ? USAGE_TYPE_CODES[usage as PsmUsageType] : null,
      bbch: parseBbch(op.bbchStage),
      timeOfDayRequired: false,
    };

    for (const p of lines) {
      if (p.crop_cycle_id) load.cultivationOf.set(p.id, p.crop_cycle_id);
      const pass = {
        ...base,
        passId: p.id,
        areaHa: p.treated_area_ha,
        fieldName: fieldName(p),
        fieldId: p.field_id,
        // A field part is drawn, so it always has a geometry.
        hasGeometry: !!p.field_part_id || p.has_geometry,
        flik: p.identifier,
        crop: op.fields.find((f) => f.fieldId === p.field_id && f.fieldPartId === p.field_part_id)?.cropName ?? null,
        cropEppo: p.eppo_code,
      };
      if (!inputs.length) {
        // A pass without a product is still a documented application, and an incomplete one.
        load.documented.push({
          ...pass,
          inputId: null,
          product: null,
          kennr: null,
          awgId: null,
          dose: null,
          doseUnit: null,
          targetOrganism: op.targetOrganism,
          preHarvestIntervalDays: null,
        });
        continue;
      }
      for (const input of inputs) {
        const use = uses.find((u) => u.operationId === op.id && u.productId === input.productId && u.fieldId === p.field_id && u.cropCycleId === p.crop_cycle_id);
        const useTargets = use?.targetCodes.map((c) => targetText.get(c) ?? c).join(', ');
        load.documented.push({
          ...pass,
          inputId: input.id,
          product: input.productName,
          kennr: registration.get(input.productId) ?? null,
          awgId: use?.awgId ?? null,
          dose: input.ratePerHa ?? (op.totalAreaHa ? round(input.totalQuantity / op.totalAreaHa, 4) : null),
          doseUnit: `${input.baseUnit}/ha`,
          targetOrganism: op.targetOrganism ?? (useTargets || null),
          preHarvestIntervalDays: use?.waitingDays ?? null,
        });
      }
    }
  }
  load.planned = load.plannedPasses.length;

  load.bvl = findings.map((f) => ({
    operationId: f.operationId,
    passId: passesOf.get(f.operationId)?.find((p) => p.field_id === f.fieldId && p.crop_cycle_id === f.cropCycleId)?.id ?? null,
    code: f.code,
    severity: f.severity,
    message: f.message,
    measuredAgainst: [f.productName, f.kennr && `Zulassung ${f.kennr}`, f.awgId && `Anwendung ${f.awgId}`].filter(Boolean).join(', '),
  }));
  return load;
}

/** The farm's certificates (RLS scopes the row to the organization). */
export async function loadAttestations(trx: Trx): Promise<PsmAttestations | undefined> {
  const row = await trx.selectFrom('psm_attestations').selectAll().executeTakeFirst();
  if (!row) return undefined;
  return {
    certificateNumber: row.certificate_number,
    certificateHolder: row.certificate_holder,
    certificateValidUntil: row.certificate_valid_until,
    sprayerInspectionNumber: row.sprayer_inspection_number,
    sprayerInspectedOn: row.sprayer_inspected_on,
    updatedAt: new Date(row.updated_at as unknown as string).toISOString(),
  };
}
