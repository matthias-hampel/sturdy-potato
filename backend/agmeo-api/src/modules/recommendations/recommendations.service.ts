import { Injectable, Logger } from '@nestjs/common';
import {
  RECOMMENDATION_RULE_SET,
  type AcceptRecommendationResult,
  type CropCategory,
  type DismissReason,
  type OperationStatus,
  type OperationType,
  type Recommendation,
  type RecommendationAction,
  type RecommendationEvidence,
  type RecommendationKind,
  type RecommendationList,
  type RecommendationStatus,
  type AcceptRecommendationInput,
  type DismissRecommendationInput,
  type RecommendationListQuery,
  type TaskPriority,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { resolveSeason } from '../crops/seasons.js';
import { NutrientsService } from '../nutrients/nutrients.service.js';
import { ProtectionService } from '../protection/protection.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { WeatherService } from '../weather/weather.service.js';
import { ExplainerService, type ExplainItem } from './explainer.service.js';
import { addDays, type CompletedWork, type CycleFacts, type Decision, decide, type OperationFacts, type RuleInput, type WeatherFacts, type ZoningFacts } from './lib/rules.js';

/** A decided recommendation is not raised again for this long, so feedback sticks. */
const QUIET_DAYS = 7;

/**
 * Field recommendations: gathers the facts, runs the rule set, keeps one open recommendation per
 * decision across runs and lets the language model phrase the reasons of new or changed ones.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly db: Database,
    private readonly weather: WeatherService,
    private readonly nutrients: NutrientsService,
    private readonly protection: ProtectionService,
    private readonly tasks: TasksService,
    private readonly explainer: ExplainerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  list(ctx: Ctx, q: Out<typeof RecommendationListQuery>): Promise<RecommendationList> {
    return this.db.run(ctx, async (trx) => {
      const run = await trx
        .selectFrom('recommendation_runs')
        .select(['generated_at', 'briefing', 'explanation_model'])
        .orderBy('generated_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return {
        generatedAt: run ? iso(run.generated_at) : null,
        ruleSet: RECOMMENDATION_RULE_SET,
        // The briefing covers the whole organization; a field or crop page shows its own items only.
        briefing: q.fieldId || q.cropCycleId ? null : (run?.briefing ?? null),
        explanationModel: run?.explanation_model ?? null,
        explanationsEnabled: this.explainer.enabled,
        items: await this.query(trx, q),
      };
    });
  }

  private async query(trx: Trx, q: Out<typeof RecommendationListQuery> & { ids?: string[] }): Promise<Recommendation[]> {
    let query = trx
      .selectFrom('recommendations as r')
      .innerJoin('fields as f', 'f.id', 'r.field_id')
      .leftJoin('crop_cycles as cc', 'cc.id', 'r.crop_cycle_id')
      .leftJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('operations as o', 'o.id', 'r.operation_id')
      .selectAll('r')
      .select([
        'f.name as field_name',
        sql<string | null>`coalesce(c.name_de, c.name)`.as('crop_name'),
        'c.color as crop_color',
        'o.title as operation_title',
        'o.planned_on as operation_planned_on',
        'o.status as operation_status',
      ])
      .orderBy(sql`array_position(array['urgent','high','normal','low'], r.priority)`)
      .orderBy('r.window_from', (ob) => ob.asc().nullsLast())
      .orderBy('r.confidence', 'desc')
      .limit(200);
    if (q.ids) query = query.where('r.id', 'in', q.ids);
    if (q.status !== 'all') query = query.where('r.status', '=', q.status);
    // Work on several fields belongs to each of them, not only to the first.
    if (q.fieldId) {
      const fieldId = q.fieldId;
      query = query.where((eb) =>
        eb.or([
          eb('r.field_id', '=', fieldId),
          eb('r.operation_id', 'in', eb.selectFrom('operation_fields').select('operation_id').where('field_id', '=', fieldId)),
        ]),
      );
    }
    if (q.cropCycleId) {
      const cycleId = q.cropCycleId;
      query = query.where((eb) =>
        eb.or([
          eb('r.crop_cycle_id', '=', cycleId),
          eb('r.operation_id', 'in', eb.selectFrom('operation_fields').select('operation_id').where('crop_cycle_id', '=', cycleId)),
        ]),
      );
    }
    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      kind: r.kind as RecommendationKind,
      action: r.action as RecommendationAction,
      operationType: r.operation_type as OperationType | null,
      farmId: r.farm_id,
      field: { id: r.field_id, name: r.field_name },
      cropCycle: r.crop_cycle_id ? { id: r.crop_cycle_id, cropName: r.crop_name ?? '', cropColor: r.crop_color } : null,
      operation: r.operation_id
        ? { id: r.operation_id, title: r.operation_title!, plannedOn: r.operation_planned_on, status: r.operation_status as OperationStatus }
        : null,
      zoneNos: r.zone_nos,
      windowFrom: r.window_from,
      windowTo: r.window_to,
      priority: r.priority as TaskPriority,
      confidence: Number(r.confidence),
      evidence: r.evidence as unknown as RecommendationEvidence[],
      ruleSet: r.rule_set,
      explanation: r.explanation,
      explanationModel: r.explanation_model,
      status: r.status as RecommendationStatus,
      dismissReason: r.dismiss_reason as DismissReason | null,
      taskId: r.task_id,
      decidedAt: r.decided_at ? iso(r.decided_at) : null,
      createdAt: iso(r.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Refresh: facts → rule set → persisted recommendations → explanations
  // ---------------------------------------------------------------------------

  async refresh(ctx: Ctx): Promise<RecommendationList> {
    const input = await this.facts(ctx);
    const decisions = decide(input);
    const { runId, unexplained } = await this.persist(ctx, decisions);
    await this.explain(ctx, input.today, runId, unexplained);
    return this.list(ctx, { status: 'open' });
  }

  private async facts(ctx: Ctx): Promise<RuleInput> {
    const now = today();
    const base = await this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx);
      const cycles = season
        ? await trx
            .selectFrom('crop_cycles as cc')
            .innerJoin('fields as f', 'f.id', 'cc.field_id')
            .innerJoin('crops as c', 'c.id', 'cc.crop_id')
            .select([
              'cc.id',
              'cc.field_id',
              'f.farm_id',
              sql<string>`coalesce(c.name_de, c.name)`.as('crop_name'),
              'c.category',
              'cc.status',
              'cc.sowing_date',
              'cc.expected_harvest_date',
              'f.nitrate_sensitive_zone',
            ])
            .where('cc.season_id', '=', season.id)
            .where('cc.role', '=', 'main')
            .where('cc.status', 'in', ['planned', 'active'])
            .where('f.status', '=', 'active')
            .execute()
        : [];

      const ops = await trx
        .selectFrom('operations as o')
        .select(['o.id', 'o.type', 'o.title', 'o.status', 'o.planned_on', 'o.farm_id'])
        .where('o.status', 'in', ['planned', 'in_progress'])
        .where('o.planned_on', '>=', addDays(now, -45))
        .where('o.planned_on', '<=', addDays(now, 60))
        .execute();
      const opIds = ops.map((o) => o.id);
      const opFields = opIds.length
        ? await trx
            .selectFrom('operation_fields as ofl')
            .innerJoin('fields as f', 'f.id', 'ofl.field_id')
            .select(['ofl.operation_id', 'ofl.field_id', 'ofl.crop_cycle_id'])
            .where('ofl.operation_id', 'in', opIds)
            .where('f.status', '=', 'active')
            .execute()
        : [];
      const vra = opIds.length ? await trx.selectFrom('vra_maps').select('operation_id').where('operation_id', 'in', opIds).execute() : [];
      const closed = await this.nutrients.closedPeriodFindings(trx, ops.filter((o) => o.type === 'fertilization').map((o) => o.id));
      const psm = await this.protection.check(trx, ops.filter((o) => o.type === 'crop_protection').map((o) => o.id));

      const fieldIds = [...new Set(cycles.map((c) => c.field_id))];
      const ndvi = fieldIds.length
        ? (
            await sql<{ field_id: string; observed_on: string; mean: number; p10: number | null; p90: number | null }>`
              SELECT DISTINCT ON (field_id, observed_on) field_id, observed_on::text, mean, p10, p90
              FROM field_observations
              WHERE field_id = ANY(${fieldIds}::uuid[]) AND index_type = 'ndvi' AND status = 'valid' AND mean IS NOT NULL
                AND observed_on >= ${addDays(now, -60)}::date
              ORDER BY field_id, observed_on, valid_pixel_pct DESC`.execute(trx)
          ).rows
        : [];

      // Zones of the latest finished analysis of the current boundary; a custom zoning wins.
      const zones = (
        await sql<{ field_id: string; zone_no: number; relative_productivity: number }>`
          SELECT z.field_id, zz.zone_no, zz.relative_productivity
          FROM (
            SELECT DISTINCT ON (zg.field_id) zg.id, zg.field_id
            FROM zonings zg
            JOIN productivity_analyses a ON a.id = zg.analysis_id AND a.status = 'finished'
            JOIN field_current_geometry g ON g.field_id = zg.field_id AND g.id = zg.geometry_version_id
            ORDER BY zg.field_id, a.created_at DESC, zg.is_custom DESC, abs(zg.zone_count - 5)
          ) z
          JOIN zoning_zones zz ON zz.zoning_id = z.id
          WHERE zz.relative_productivity IS NOT NULL
          ORDER BY z.field_id, zz.zone_no`.execute(trx)
      ).rows;

      const completed = (
        await sql<{ field_id: string; type: string; day: string }>`
          SELECT DISTINCT ofl.field_id, o.type, (o.performed_at AT TIME ZONE 'Europe/Berlin')::date::text AS day
          FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
          WHERE o.status = 'completed' AND o.performed_at >= now() - interval '60 days'`.execute(trx)
      ).rows;

      return { season, cycles, ops, opFields, vra, closed, psm, ndvi, zones, completed };
    });

    // The N balance of the season (DüV need minus available N applied and planned).
    const balance = base.season ? await this.nutrients.seasonBalance(ctx, base.season.id) : null;
    const nOf = new Map(balance?.rows.map((r) => [r.cropCycleId, r]) ?? []);

    const farmIds = [...new Set([...base.cycles.map((c) => c.farm_id), ...base.ops.map((o) => o.farm_id)])];
    const weatherByFarm = new Map<string, WeatherFacts | null>();
    await Promise.all(
      farmIds.map(async (farmId) => {
        try {
          const w = await this.weather.forecast(ctx, farmId);
          weatherByFarm.set(farmId, { daily: w.daily, past: w.past, sprayWindows: w.sprayWindows });
        } catch (e) {
          this.logger.warn(`No weather for farm ${farmId}: ${(e as Error).message}`);
          weatherByFarm.set(farmId, null);
        }
      }),
    );

    const fieldsOf = new Map<string, OperationFacts['fields']>();
    for (const f of base.opFields) fieldsOf.set(f.operation_id, [...(fieldsOf.get(f.operation_id) ?? []), { fieldId: f.field_id, cropCycleId: f.crop_cycle_id }]);
    const withVra = new Set(base.vra.map((v) => v.operation_id));
    const operations: OperationFacts[] = base.ops.map((o) => {
      const c = base.closed.find((x) => x.operationId === o.id);
      return {
        id: o.id,
        type: o.type as OperationType,
        title: o.title,
        status: o.status as 'planned' | 'in_progress',
        plannedOn: o.planned_on,
        farmId: o.farm_id,
        fields: fieldsOf.get(o.id) ?? [],
        hasVraMap: withVra.has(o.id),
        closedPeriod: c ? { date: c.date, from: c.period.from, to: c.period.to, rule: c.period.rule } : null,
        psmDeviations: base.psm.findings
          .filter((f) => f.operationId === o.id && f.severity === 'deviation')
          .map((f) => ({ code: f.code, productName: f.productName, params: f.params })),
      };
    });

    const ndviOf = new Map<string, CycleFacts['ndvi']>();
    for (const r of base.ndvi) ndviOf.set(r.field_id, [...(ndviOf.get(r.field_id) ?? []), { date: r.observed_on, mean: Number(r.mean), p10: r.p10, p90: r.p90 }]);
    const cycles: CycleFacts[] = base.cycles.map((c) => ({
      id: c.id,
      fieldId: c.field_id,
      farmId: c.farm_id,
      cropName: c.crop_name,
      cropCategory: c.category as CropCategory,
      status: c.status as CycleFacts['status'],
      sowingDate: c.sowing_date,
      expectedHarvestDate: c.expected_harvest_date,
      nitrateSensitiveZone: c.nitrate_sensitive_zone ?? false,
      nNeedKgHa: nOf.get(c.id)?.nNeed ?? null,
      nRemainingKgHa: nOf.get(c.id)?.nRemaining ?? null,
      ndvi: ndviOf.get(c.field_id) ?? [],
    }));

    const zoningByField = new Map<string, ZoningFacts>();
    for (const z of base.zones) {
      const zoning = zoningByField.get(z.field_id) ?? { zones: [] };
      zoning.zones.push({ zoneNo: z.zone_no, relativeProductivity: Number(z.relative_productivity) });
      zoningByField.set(z.field_id, zoning);
    }
    const completed: CompletedWork[] = base.completed.map((w) => ({ fieldId: w.field_id, type: w.type as OperationType, date: w.day }));

    return { today: now, weatherByFarm, operations, cycles, zoningByField, completed };
  }

  /**
   * Keeps one open recommendation per decision key: unchanged decisions keep their explanation,
   * recently decided keys are not raised again, and open ones the rules no longer make expire.
   */
  private persist(ctx: Ctx, decisions: Decision[]) {
    return this.db.run(ctx, async (trx) => {
      // Two refreshes at once would race on the open-key index.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`recommendations:${ctx.orgId}`}))`.execute(trx);
      const { id: runId } = await trx
        .insertInto('recommendation_runs')
        .values({ organization_id: ctx.orgId, rule_set: RECOMMENDATION_RULE_SET, item_count: decisions.length, created_by: ctx.userId })
        .returning('id')
        .executeTakeFirstOrThrow();

      const open = await trx.selectFrom('recommendations').select(['id', 'key', 'evidence', 'window_from', 'explanation']).where('status', '=', 'open').execute();
      const openByKey = new Map(open.map((r) => [r.key, r]));
      const decided = new Set(
        (
          await trx
            .selectFrom('recommendations')
            .select('key')
            .where('status', 'in', ['accepted', 'dismissed'])
            .where('decided_at', '>=', new Date(Date.now() - QUIET_DAYS * 86_400_000))
            .execute()
        ).map((r) => r.key),
      );

      const unexplained: string[] = [];
      const kept = new Set<string>();
      for (const d of decisions) {
        if (decided.has(d.key)) continue;
        const values = {
          run_id: runId,
          kind: d.kind,
          action: d.action,
          operation_type: d.operationType,
          farm_id: d.farmId,
          field_id: d.fieldId,
          crop_cycle_id: d.cropCycleId,
          operation_id: d.operationId,
          zone_nos: d.zoneNos,
          window_from: d.windowFrom,
          window_to: d.windowTo,
          priority: d.priority,
          confidence: d.confidence,
          evidence: JSON.stringify(d.evidence),
          rule_set: RECOMMENDATION_RULE_SET,
        };
        const existing = openByKey.get(d.key);
        if (existing) {
          kept.add(existing.id);
          const same = JSON.stringify(existing.evidence) === JSON.stringify(d.evidence) && existing.window_from === d.windowFrom;
          await trx
            .updateTable('recommendations')
            .set({ ...values, ...(same ? {} : { explanation: null, explanation_model: null }) })
            .where('id', '=', existing.id)
            .execute();
          if (!same || !existing.explanation) unexplained.push(existing.id);
        } else {
          const { id } = await trx
            .insertInto('recommendations')
            .values({ ...values, organization_id: ctx.orgId, key: d.key })
            .returning('id')
            .executeTakeFirstOrThrow();
          unexplained.push(id);
        }
      }
      const stale = open.filter((r) => !kept.has(r.id)).map((r) => r.id);
      if (stale.length) await trx.updateTable('recommendations').set({ status: 'expired' }).where('id', 'in', stale).execute();
      return { runId, unexplained };
    });
  }

  /** Phrases new and changed recommendations; a failure leaves the evidence-based reasons. */
  private async explain(ctx: Ctx, today: string, runId: string, ids: string[]) {
    if (!this.explainer.enabled) return;
    const items = await this.db.run(ctx, (trx) => this.query(trx, { status: 'open' }));
    // Unchanged ones go along without needing new text, so the briefing covers everything.
    const fresh = new Set(ids);
    if (!fresh.size) return;
    const payload: ExplainItem[] = items.map((r) => ({
      key: r.key,
      kind: r.kind,
      action: r.action,
      operationType: r.operationType,
      field: r.field.name,
      crop: r.cropCycle?.cropName ?? null,
      operation: r.operation?.title ?? null,
      zoneNos: r.zoneNos,
      windowFrom: r.windowFrom,
      windowTo: r.windowTo,
      priority: r.priority,
      confidence: r.confidence,
      evidence: r.evidence,
    }));
    try {
      const result = await this.explainer.explain(today, payload);
      if (!result) return;
      await this.db.run(ctx, async (trx) => {
        for (const r of items) {
          const text = result.texts.get(r.key);
          if (text && (fresh.has(r.id) || !r.explanation)) {
            await trx.updateTable('recommendations').set({ explanation: text, explanation_model: result.model }).where('id', '=', r.id).execute();
          }
        }
        await trx.updateTable('recommendation_runs').set({ briefing: result.briefing, explanation_model: result.model }).where('id', '=', runId).execute();
      });
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`Explaining recommendations failed: ${message}`);
      await this.db.run(ctx, (trx) => trx.updateTable('recommendation_runs').set({ explanation_error: message.slice(0, 500) }).where('id', '=', runId).execute());
    }
  }

  // ---------------------------------------------------------------------------
  // Decisions of the user
  // ---------------------------------------------------------------------------

  /**
   * Postponing or catching up moves the planned operation to the recommended day; every other
   * recommendation becomes a task (linked to the operation when there is one).
   */
  accept(ctx: Ctx, id: string, input: Out<typeof AcceptRecommendationInput>): Promise<AcceptRecommendationResult> {
    return this.db.run(ctx, async (trx) => {
      const r = await this.openRow(trx, id);
      let taskId: string | null = null;
      let rescheduledTo: string | null = null;

      const op = r.operation_id ? await trx.selectFrom('operations').select(['id', 'status', 'planned_on']).where('id', '=', r.operation_id).executeTakeFirst() : null;
      const reschedule = (r.action === 'postpone' || r.action === 'catch_up') && r.window_from && op && op.status === 'planned' && !input.dueOn;
      if (reschedule) {
        rescheduledTo = r.window_from!;
        await trx.updateTable('operations').set({ planned_on: rescheduledTo }).where('id', '=', op.id).execute();
        await record(trx, ctx, {
          entityType: 'operation',
          entityId: op.id,
          action: 'rescheduled',
          changes: { plannedOn: { from: op.planned_on, to: rescheduledTo }, recommendationId: r.id },
          event: { type: 'operation.updated', payload: { operationId: op.id } },
        });
      } else {
        const task = await this.tasks.createIn(
          trx,
          ctx,
          {
            farmId: r.farm_id,
            fieldId: r.field_id,
            title: input.title,
            description: input.description ?? r.explanation ?? null,
            assigneeEmployeeId: input.assigneeEmployeeId ?? null,
            dueOn: input.dueOn ?? r.window_from ?? today(),
            priority: r.priority as TaskPriority,
            status: 'open',
          },
          op && op.status !== 'completed' && op.status !== 'canceled' ? op.id : null,
        );
        taskId = task.id;
      }
      await trx
        .updateTable('recommendations')
        .set({ status: 'accepted', task_id: taskId, decided_at: new Date(), decided_by: ctx.userId })
        .where('id', '=', id)
        .execute();
      await record(trx, ctx, { entityType: 'recommendation', entityId: id, action: 'accepted', changes: { key: r.key, taskId, rescheduledTo } });
      const [recommendation] = await this.query(trx, { status: 'all', ids: [id] });
      return { recommendation, taskId, rescheduledTo };
    });
  }

  dismiss(ctx: Ctx, id: string, input: Out<typeof DismissRecommendationInput>): Promise<Recommendation> {
    return this.db.run(ctx, async (trx) => {
      const r = await this.openRow(trx, id);
      await trx
        .updateTable('recommendations')
        .set({ status: 'dismissed', dismiss_reason: input.reason, dismiss_note: input.note ?? null, decided_at: new Date(), decided_by: ctx.userId })
        .where('id', '=', id)
        .execute();
      await record(trx, ctx, { entityType: 'recommendation', entityId: id, action: 'dismissed', changes: { key: r.key, reason: input.reason } });
      const [recommendation] = await this.query(trx, { status: 'all', ids: [id] });
      return recommendation;
    });
  }

  private async openRow(trx: Trx, id: string) {
    const r = await trx.selectFrom('recommendations').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Recommendation');
    if (r.status !== 'open') throw conflict('recommendation_decided', 'This recommendation was already decided or has expired');
    return r;
  }
}
