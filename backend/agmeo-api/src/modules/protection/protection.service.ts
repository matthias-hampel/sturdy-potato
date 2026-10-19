import { Injectable } from '@nestjs/common';
import type { OperationChecks, PsmFinding } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { cropName } from '../crops/crop-name.js';
import { psmUnit } from '../inventory/inventory.service.js';
import { type ApprovalFacts, type AppliedRecord, checkApplication, checkSeries, earliestHarvest, parseBbch, type RawFinding } from './psm-checks.js';

interface UseRow {
  awg_id: string;
  target_codes: string[];
  professional: boolean;
  crop_codes: string[];
  excluded_crop_codes: string[];
  bbch_from: number | null;
  bbch_to: number | null;
  max_applications: number | null;
  min_interval_days: number | null;
  dose_max: number | null;
  dose_unit: string | null;
  waiting_days: unknown;
}

/**
 * The approved use one application line was made under, where it is determined: chosen on the
 * operation (`details.psmUseId`) or the only professional use of the product for the crop. When
 * several uses fit, which one applied is the farmer's statement, so there is none.
 */
export interface ResolvedPsmUse {
  operationId: string;
  productId: string;
  fieldId: string;
  cropCycleId: string | null;
  awgId: string;
  waitingDays: number | null;
  targetCodes: string[];
}

/**
 * Checks plant-protection applications against the BVL register: product approval, approved use
 * for the crop, dose, growth stage, waiting period, number of applications and interval.
 */
@Injectable()
export class ProtectionService {
  constructor(private readonly db: Database) {}

  operationChecks(ctx: Ctx, operationId: string): Promise<OperationChecks> {
    return this.db.run(ctx, async (trx) => {
      const op = await trx.selectFrom('operations').select('id').where('id', '=', operationId).executeTakeFirst();
      if (!op) throw notFound('Operation');
      const { findings, earliest } = await this.check(trx, [operationId]);
      return { operationId, psm: findings, earliestHarvest: earliest };
    });
  }

  /** Findings for crop-protection operations among `operationIds` (other operations are ignored). */
  async check(trx: Trx, operationIds: string[]): Promise<{ findings: PsmFinding[]; earliest: OperationChecks['earliestHarvest']; uses: ResolvedPsmUse[] }> {
    const findings: PsmFinding[] = [];
    const earliest: OperationChecks['earliestHarvest'] = [];
    const uses: ResolvedPsmUse[] = [];
    if (!operationIds.length) return { findings, earliest, uses };

    // Application lines: one per operation, crop-protection product and treated crop cycle.
    const lines = await trx
      .selectFrom('operations as o')
      .innerJoin('operation_inputs as oi', 'oi.operation_id', 'o.id')
      .innerJoin('products as p', 'p.id', 'oi.product_id')
      .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
      .innerJoin('fields as f', 'f.id', 'ofl.field_id')
      .leftJoin('crop_cycles as cc', 'cc.id', 'ofl.crop_cycle_id')
      .leftJoin('crops as c', 'c.id', 'cc.crop_id')
      .select([
        'o.id as operation_id',
        'o.bbch_stage',
        'o.details',
        sql<string | null>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)::text`.as('day'),
        'oi.product_id',
        'p.name as product_name',
        'p.base_unit',
        'p.registration_number',
        'oi.rate_per_ha',
        'ofl.field_id',
        'f.name as field_name',
        'ofl.crop_cycle_id',
        'c.eppo_code',
        cropName<string | null>('c').as('crop_name'),
      ])
      .where('o.id', 'in', operationIds)
      .where('o.type', '=', 'crop_protection')
      .where('o.status', '<>', 'canceled')
      .where('p.category', '=', 'crop_protection')
      .execute();
    if (!lines.length) return { findings, earliest, uses };

    const kennrs = [...new Set(lines.map((l) => l.registration_number).filter((k): k is string => !!k))];
    const products = new Map(
      kennrs.length ? (await trx.selectFrom('psm_products').select(['kennr', 'approval_ends_on', 'use_up_until']).where('kennr', 'in', kennrs).execute()).map((p) => [p.kennr, p]) : [],
    );
    const usesOf = new Map<string, UseRow[]>();
    if (products.size) {
      const uses = await trx.selectFrom('psm_uses').selectAll().where('kennr', 'in', [...products.keys()]).execute();
      for (const u of uses) usesOf.set(u.kennr, [...(usesOf.get(u.kennr) ?? []), u]);
    }
    const eppos = [...new Set(lines.map((l) => l.eppo_code).filter((e): e is string => !!e))];
    const ancestorsOf = new Map<string, string[]>();
    for (const e of eppos) ancestorsOf.set(e, (await sql<{ a: string[] }>`SELECT app.psm_crop_ancestors(${e}) AS a`.execute(trx)).rows[0]?.a ?? [e]);

    // Harvest date per crop cycle: recorded, else expected, else a planned harvest operation.
    const cycleIds = [...new Set(lines.map((l) => l.crop_cycle_id).filter((c): c is string => !!c))];
    const harvestOf = new Map<string, { date: string; recorded: boolean }>();
    if (cycleIds.length) {
      const rows = await sql<{ id: string; recorded: string | null; expected: string | null; planned: string | null }>`
        SELECT cc.id,
               (SELECT max(h.harvest_date)::text FROM harvests h WHERE h.crop_cycle_id = cc.id) AS recorded,
               cc.expected_harvest_date::text AS expected,
               (SELECT min(o.planned_on)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
                 WHERE ofl.crop_cycle_id = cc.id AND o.type = 'harvest' AND o.status IN ('planned', 'in_progress')) AS planned
        FROM crop_cycles cc WHERE cc.id = ANY(${cycleIds}::uuid[])`.execute(trx);
      for (const r of rows.rows) {
        const date = r.recorded ?? r.expected ?? r.planned;
        if (date) harvestOf.set(r.id, { date, recorded: r.recorded != null });
      }
    }
    // Every application of the same products on the same crops, for the series checks.
    const series = cycleIds.length
      ? await trx
          .selectFrom('operations as o')
          .innerJoin('operation_inputs as oi', 'oi.operation_id', 'o.id')
          .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
          .select([
            'o.id as operation_id',
            'oi.product_id',
            'ofl.crop_cycle_id',
            'oi.rate_per_ha',
            'o.bbch_stage',
            sql<string | null>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)::text`.as('day'),
          ])
          .where('ofl.crop_cycle_id', 'in', cycleIds)
          .where('oi.product_id', 'in', [...new Set(lines.map((l) => l.product_id))])
          .where('o.type', '=', 'crop_protection')
          .where('o.status', '<>', 'canceled')
          .execute()
      : [];

    const seen = new Set<string>();
    const push = (l: (typeof lines)[number], f: RawFinding, awgId: string | null) => {
      const key = `${f.operationId}|${l.product_id}|${f.code}|${l.crop_cycle_id}|${JSON.stringify(f.params)}`;
      if (seen.has(key) || !operationIds.includes(f.operationId)) return;
      seen.add(key);
      findings.push({
        operationId: f.operationId,
        code: f.code,
        severity: f.severity,
        productId: l.product_id,
        productName: l.product_name,
        kennr: l.registration_number,
        fieldId: l.field_id,
        fieldName: l.field_name,
        cropCycleId: l.crop_cycle_id,
        cropName: l.crop_name,
        awgId,
        params: f.params,
        message: f.message,
      });
    };

    for (const l of lines) {
      const product = l.registration_number ? products.get(l.registration_number) : undefined;
      if (!product) {
        push(l, { code: 'unknown_registration', severity: 'notice', operationId: l.operation_id, params: { kennr: l.registration_number ?? '' }, message: l.registration_number ? `Registration number ${l.registration_number} is not in the BVL register.` : 'No registration number recorded; the approval cannot be checked.' }, null);
        continue;
      }
      const all = usesOf.get(product.kennr) ?? [];
      const professional = all.filter((u) => u.professional);
      if (all.length && !professional.length) {
        push(l, { code: 'hobby_only', severity: 'deviation', operationId: l.operation_id, params: {}, message: 'The product is approved for home and allotment gardens only.' }, null);
        continue;
      }
      const ancestors = l.eppo_code ? (ancestorsOf.get(l.eppo_code) ?? []) : [];
      const chosenId = (l.details as Record<string, unknown> | null)?.psmUseId;
      const forCrop = professional.filter((u) => u.crop_codes.some((c) => ancestors.includes(c)) && !u.excluded_crop_codes.some((c) => ancestors.includes(c)));
      const base = { approvalEndsOn: product.approval_ends_on, useUpUntil: product.use_up_until };
      const applied: AppliedRecord = { operationId: l.operation_id, date: l.day, dose: l.rate_per_ha, bbch: parseBbch(l.bbch_stage) };
      // Without a known crop only the product approval can be checked.
      if (!ancestors.length || (!forCrop.length && typeof chosenId !== 'string')) {
        for (const f of checkApplication(applied, { ...base, awgId: null, bbchFrom: null, bbchTo: null, maxApplications: null, minIntervalDays: null, doseMax: null, doseUnitLabel: null, waitingDays: null })) push(l, f, null);
        if (ancestors.length && professional.length) {
          push(l, { code: 'no_approved_use', severity: 'deviation', operationId: l.operation_id, params: { crop: l.crop_name ?? '' }, message: `No approved use of this product for ${l.crop_name}.` }, null);
        }
        continue;
      }
      const candidates = typeof chosenId === 'string' ? professional.filter((u) => u.awg_id === chosenId) : forCrop;
      if (candidates.length === 1) {
        const use = candidates[0];
        uses.push({
          operationId: l.operation_id,
          productId: l.product_id,
          fieldId: l.field_id,
          cropCycleId: l.crop_cycle_id,
          awgId: use.awg_id,
          waitingDays: this.facts(use, base, ancestors, l.base_unit).waitingDays,
          targetCodes: use.target_codes,
        });
      }
      const harvest = l.crop_cycle_id ? harvestOf.get(l.crop_cycle_id) : undefined;
      const others = series
        .filter((s) => s.crop_cycle_id === l.crop_cycle_id && s.product_id === l.product_id)
        .filter((s, i, arr) => arr.findIndex((x) => x.operation_id === s.operation_id) === i)
        .map((s) => ({ operationId: s.operation_id, date: s.day, dose: s.rate_per_ha, bbch: parseBbch(s.bbch_stage) }));
      // Measure against the approved use the application fits best.
      let best: { use: UseRow; facts: ApprovalFacts; found: RawFinding[] } | null = null;
      for (const use of candidates) {
        const facts = this.facts(use, base, ancestors, l.base_unit);
        const found = [...checkApplication(applied, facts, { harvestDate: harvest?.date, harvestRecorded: harvest?.recorded }), ...(l.crop_cycle_id ? checkSeries(others, facts) : [])];
        if (!best || found.length < best.found.length) best = { use, facts, found };
      }
      if (!best) continue;
      for (const f of best.found) push(l, f, best.use.awg_id);
      if (l.day && l.crop_cycle_id) {
        const date = earliestHarvest(l.day, best.facts.waitingDays);
        if (date && !earliest.some((e) => e.cropCycleId === l.crop_cycle_id && e.date >= date)) {
          const i = earliest.findIndex((e) => e.cropCycleId === l.crop_cycle_id);
          if (i >= 0) earliest[i] = { cropCycleId: l.crop_cycle_id, date };
          else earliest.push({ cropCycleId: l.crop_cycle_id, date });
        }
      }
    }
    return { findings, earliest, uses };
  }

  private facts(use: UseRow, base: { approvalEndsOn: string | null; useUpUntil: string | null }, ancestors: string[], baseUnit: string): ApprovalFacts {
    const unit = psmUnit(use.dose_unit);
    const comparable = unit && unit.baseUnit === baseUnit && use.dose_max != null;
    const waiting = (use.waiting_days ?? {}) as Record<string, number | null>;
    const key = ancestors.find((a) => a in waiting);
    return {
      ...base,
      awgId: use.awg_id,
      bbchFrom: use.bbch_from,
      bbchTo: use.bbch_to,
      maxApplications: use.max_applications,
      minIntervalDays: use.min_interval_days,
      doseMax: comparable ? Math.round(use.dose_max! * unit.factor * 10_000) / 10_000 : null,
      doseUnitLabel: comparable ? `${baseUnit}/ha` : null,
      waitingDays: key ? (waiting[key] ?? null) : null,
    };
  }
}
