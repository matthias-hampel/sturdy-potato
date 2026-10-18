import { Injectable } from '@nestjs/common';
import {
  availableN,
  type BaseUnit,
  type CycleNutrientBalance,
  type FertilizerNeed,
  type FertilizerNeedInputs,
  type FertilizerNeedOverrides,
  type FertilizerNeedRecord,
  type FertilizerType,
  type FieldSiteInput,
  type FieldSoilSummary,
  grainsForPlants,
  isOrganicFertilizer,
  type NminReferenceValue,
  nutrientKgPerHa,
  type NutrientRates,
  roundRate,
  type SeasonNutrientBalance,
  type SoilSample,
  type SoilSampleInput,
  type SoilTexture,
  soilClassOf,
  type SuggestedRates,
  type SuggestRatesInput,
  sumNutrients,
  zoneRates,
  type PhMethod,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, round, today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropColor, cropName } from '../crops/crop-name.js';
import { addDays } from '../planning/dates.js';
import { baseFertilizationNeed, kClass, limeRequirement, mgClass, pClass, phClass } from './lib/base-fertilization.js';
import { closedPeriod, inClosedPeriod, restrictedByClosedPeriod } from './lib/closed-periods.js';
import { DEFAULT_NMIN, DUEV_CROPS, DUEV_RULESET, nitrogenNeed, organicFollowUpShare } from './lib/duev.js';

type Overrides = Out<typeof FertilizerNeedOverrides>;
type SampleRow = {
  id: string;
  field_id: string;
  field_name: string;
  field_part_id: string | null;
  part_name: string | null;
  kind: string;
  sampled_on: string;
  lab: string | null;
  sample_number: string | null;
  depth_cm: number | null;
  ph: number | null;
  ph_method: string | null;
  p2o5_mg_100g: number | null;
  p_method: string | null;
  k2o_mg_100g: number | null;
  mgo_mg_100g: number | null;
  humus_pct: number | null;
  soil_texture: string | null;
  nmin_0_30: number | null;
  nmin_30_60: number | null;
  nmin_60_90: number | null;
  notes: string | null;
  field_texture: string | null;
};

/** A basic soil analysis is to be repeated at least every six years (DüV §3 Abs. 4). */
const BASIC_SAMPLE_MAX_AGE_YEARS = 6;

/**
 * Soil samples, the fertilizer need calculation (DüV §4) with its documentation, the season's
 * nutrient balance per crop, and rate suggestions for variable-rate maps.
 */
@Injectable()
export class NutrientsService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Soil
  // ---------------------------------------------------------------------------

  soilSamples(ctx: Ctx, fieldId?: string): Promise<SoilSample[]> {
    return this.db.run(ctx, (trx) => this.querySamples(trx, { fieldId }));
  }

  createSoilSample(ctx: Ctx, input: Out<typeof SoilSampleInput>): Promise<SoilSample> {
    return this.db.run(ctx, async (trx) => {
      const field = await trx.selectFrom('fields').select('id').where('id', '=', input.fieldId).executeTakeFirst();
      if (!field) throw notFound('Field');
      const { id } = await trx
        .insertInto('soil_samples')
        .values({
          organization_id: ctx.orgId,
          field_id: input.fieldId,
          field_part_id: input.fieldPartId ?? null,
          kind: input.kind,
          sampled_on: input.sampledOn,
          lab: input.lab ?? null,
          sample_number: input.sampleNumber ?? null,
          depth_cm: input.depthCm ?? (input.kind === 'nmin' ? 90 : 30),
          ph: input.ph ?? null,
          ph_method: input.ph != null ? (input.phMethod ?? 'cacl2') : null,
          p2o5_mg_100g: input.p2o5Mg100g ?? null,
          p_method: input.p2o5Mg100g != null ? (input.pMethod ?? 'cal') : null,
          k2o_mg_100g: input.k2oMg100g ?? null,
          mgo_mg_100g: input.mgoMg100g ?? null,
          humus_pct: input.humusPct ?? null,
          soil_texture: input.soilTexture ?? null,
          nmin_0_30: input.nmin0to30 ?? null,
          nmin_30_60: input.nmin30to60 ?? null,
          nmin_60_90: input.nmin60to90 ?? null,
          notes: input.notes ?? null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // The lab's texture becomes the field's when none is recorded yet.
      if (input.soilTexture) {
        await trx.updateTable('fields').set({ soil_texture: input.soilTexture }).where('id', '=', input.fieldId).where('soil_texture', 'is', null).execute();
      }
      await record(trx, ctx, { entityType: 'field', entityId: input.fieldId, action: 'soil_sample_recorded', changes: { sampleId: id, kind: input.kind, sampledOn: input.sampledOn } });
      return (await this.querySamples(trx, { id }))[0];
    });
  }

  deleteSoilSample(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.deleteFrom('soil_samples').where('id', '=', id).returning(['field_id', 'kind', 'sampled_on']).executeTakeFirst();
      if (!row) throw notFound('Soil sample');
      await record(trx, ctx, { entityType: 'field', entityId: row.field_id, action: 'soil_sample_deleted', changes: { sampleId: id, kind: row.kind, sampledOn: row.sampled_on } });
    });
  }

  updateFieldSite(ctx: Ctx, fieldId: string, input: Out<typeof FieldSiteInput>): Promise<FieldSoilSummary> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('fields').select(['soil_texture', 'nitrate_sensitive_zone', 'phosphate_sensitive_zone']).where('id', '=', fieldId).executeTakeFirst();
      if (!before) throw notFound('Field');
      const values = {
        soil_texture: input.soilTexture === undefined ? undefined : (input.soilTexture ?? null),
        nitrate_sensitive_zone: input.nitrateSensitiveZone,
        phosphate_sensitive_zone: input.phosphateSensitiveZone,
      };
      await trx.updateTable('fields').set(values).where('id', '=', fieldId).execute();
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'updated', changes: diff(before, values), event: { type: 'field.updated', payload: { fieldId } } });
      return (await this.querySoilOverview(trx, fieldId))[0];
    });
  }

  soilOverview(ctx: Ctx): Promise<FieldSoilSummary[]> {
    return this.db.run(ctx, (trx) => this.querySoilOverview(trx));
  }

  private async querySoilOverview(trx: Trx, fieldId?: string): Promise<FieldSoilSummary[]> {
    let q = trx
      .selectFrom('fields as f')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .select(['f.id', 'f.name', 'f.soil_texture', 'f.nitrate_sensitive_zone', 'f.phosphate_sensitive_zone', sql<number>`coalesce(g.area_ha, 0)`.as('area_ha')])
      .where('f.status', '=', 'active')
      .orderBy('f.name');
    if (fieldId) q = q.where('f.id', '=', fieldId);
    const fields = await q.execute();
    const samples = await this.querySamples(trx, fieldId ? { fieldId } : {});
    const cutoff = addDays(today(), -365 * BASIC_SAMPLE_MAX_AGE_YEARS);
    return fields.map((f) => {
      const own = samples.filter((s) => s.fieldId === f.id);
      const latestBasic = own.find((s) => s.kind === 'basic') ?? null;
      return {
        fieldId: f.id,
        fieldName: f.name,
        areaHa: f.area_ha,
        soilTexture: f.soil_texture as SoilTexture | null,
        nitrateSensitiveZone: f.nitrate_sensitive_zone,
        phosphateSensitiveZone: f.phosphate_sensitive_zone,
        latestBasic,
        latestNmin: own.find((s) => s.kind === 'nmin') ?? null,
        basicOutdated: !latestBasic || latestBasic.sampledOn < cutoff,
      };
    });
  }

  private async querySamples(trx: Trx, q: { id?: string; fieldId?: string }): Promise<SoilSample[]> {
    let query = trx
      .selectFrom('soil_samples as s')
      .innerJoin('fields as f', 'f.id', 's.field_id')
      .leftJoin('field_parts as fp', 'fp.id', 's.field_part_id')
      .selectAll('s')
      .select(['f.name as field_name', 'fp.name as part_name', 'f.soil_texture as field_texture'])
      .orderBy('s.sampled_on', 'desc')
      .orderBy('s.created_at', 'desc');
    if (q.id) query = query.where('s.id', '=', q.id);
    if (q.fieldId) query = query.where('s.field_id', '=', q.fieldId);
    return (await query.execute()).map((r) => this.sampleOut(r as SampleRow));
  }

  private sampleOut(r: SampleRow): SoilSample {
    const texture = (r.soil_texture ?? r.field_texture) as SoilTexture | null;
    const soil = soilClassOf(texture);
    const layers = [r.nmin_0_30, r.nmin_30_60, r.nmin_60_90].filter((v): v is number => v != null);
    return {
      id: r.id,
      fieldId: r.field_id,
      fieldName: r.field_name,
      fieldPartId: r.field_part_id,
      fieldPartName: r.part_name,
      kind: r.kind as SoilSample['kind'],
      sampledOn: r.sampled_on,
      lab: r.lab,
      sampleNumber: r.sample_number,
      depthCm: r.depth_cm,
      ph: r.ph,
      phMethod: r.ph_method as PhMethod | null,
      p2o5Mg100g: r.p2o5_mg_100g,
      pMethod: r.p_method as SoilSample['pMethod'],
      k2oMg100g: r.k2o_mg_100g,
      mgoMg100g: r.mgo_mg_100g,
      humusPct: r.humus_pct,
      soilTexture: r.soil_texture as SoilTexture | null,
      nmin0to30: r.nmin_0_30,
      nmin30to60: r.nmin_30_60,
      nmin60to90: r.nmin_60_90,
      nminTotal: layers.length ? round(layers.reduce((a, b) => a + b, 0), 1) : null,
      classes: {
        ph: r.ph != null ? phClass(r.ph, r.ph_method as PhMethod | null, soil, r.humus_pct) : null,
        p: r.p2o5_mg_100g != null ? pClass(r.p2o5_mg_100g) : null,
        k: r.k2o_mg_100g != null ? kClass(r.k2o_mg_100g, soil) : null,
        mg: r.mgo_mg_100g != null ? mgClass(r.mgo_mg_100g, soil) : null,
      },
      notes: r.notes,
    };
  }

  // ---------------------------------------------------------------------------
  // Fertilizer need
  // ---------------------------------------------------------------------------

  fertilizerNeed(ctx: Ctx, cropCycleId: string, overrides: Overrides): Promise<FertilizerNeed> {
    return this.db.run(ctx, (trx) => this.computeNeed(trx, cropCycleId, overrides));
  }

  /**
   * Saves the calculation as a record (DüV §3 Abs. 2). The crop's expected yield, film cover,
   * straw removal and protein are kept on the crop as well.
   */
  saveFertilizerNeed(ctx: Ctx, cropCycleId: string, overrides: Overrides): Promise<FertilizerNeed> {
    return this.db.run(ctx, async (trx) => {
      const need = await this.computeNeed(trx, cropCycleId, overrides);
      if (!need.n && !need.pk.length) throw badRequest('no_fertilizer_need', 'There are no fertilization values for this crop');
      const { id } = await trx
        .insertInto('fertilizer_need_records')
        .values({
          organization_id: ctx.orgId,
          crop_cycle_id: cropCycleId,
          kind: 'n',
          inputs: JSON.stringify({ ...need.inputs, note: overrides.note ?? null }),
          result: JSON.stringify({ n: need.n, pk: need.pk, limeDtCaO: need.limeDtCaO }),
          ruleset: need.ruleset,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('crop_cycles')
        .set({
          expected_yield_t_ha: need.inputs.expectedYieldTHa.value,
          film_or_fleece: need.inputs.filmOrFleece,
          straw_removed: need.inputs.strawRemoved,
          protein_pct: need.inputs.proteinPct,
        })
        .where('id', '=', cropCycleId)
        .execute();
      await record(trx, ctx, {
        entityType: 'crop_cycle',
        entityId: cropCycleId,
        action: 'fertilizer_need_recorded',
        changes: { recordId: id, nNeed: need.n?.need ?? null, ruleset: need.ruleset },
      });
      return this.computeNeed(trx, cropCycleId, {});
    });
  }

  needRecords(ctx: Ctx, cropCycleId: string): Promise<FertilizerNeedRecord[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('fertilizer_need_records as r')
        .leftJoin('users as u', 'u.id', 'r.created_by')
        .select(['r.id', 'r.crop_cycle_id', 'r.kind', 'r.ruleset', 'r.inputs', 'r.result', 'r.created_at', 'u.display_name'])
        .where('r.crop_cycle_id', '=', cropCycleId)
        .orderBy('r.created_at', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        cropCycleId: r.crop_cycle_id,
        kind: r.kind as 'n' | 'pk',
        ruleset: r.ruleset,
        inputs: r.inputs as unknown as FertilizerNeedInputs,
        result: r.result as unknown as FertilizerNeedRecord['result'],
        note: (r.inputs as { note?: string | null } | null)?.note ?? null,
        createdAt: iso(r.created_at),
        createdBy: r.display_name,
      }));
    });
  }

  private async computeNeed(trx: Trx, cropCycleId: string, o: Overrides): Promise<FertilizerNeed> {
    const c = await trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('fields as f', 'f.id', 'cc.field_id')
      .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .select([
        'cc.id',
        'cc.field_id',
        'cc.field_part_id',
        'cc.role',
        'cc.season_id',
        'cc.expected_yield_t_ha',
        'cc.film_or_fleece',
        'cc.straw_removed',
        'cc.protein_pct',
        'f.name as field_name',
        'f.soil_texture',
        'f.nitrate_sensitive_zone',
        's.harvest_year',
        's.start_date',
        's.end_date',
        'c.code',
        cropName('c').as('crop_name'),
        sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)`.as('area_ha'),
      ])
      .where('cc.id', '=', cropCycleId)
      .executeTakeFirst();
    if (!c) throw notFound('Crop cycle');
    const warnings: FertilizerNeed['warnings'] = [];
    const duev = DUEV_CROPS[c.code];

    // Soil: the latest basic analysis up to the end of the season, and this season's Nmin sample.
    const samples = (await this.querySamples(trx, { fieldId: c.field_id })).filter((s) => !s.fieldPartId || s.fieldPartId === c.field_part_id);
    const basic = samples.find((s) => s.kind === 'basic' && s.sampledOn <= c.end_date) ?? null;
    const nminSample = samples.find((s) => s.kind === 'nmin' && s.sampledOn >= c.start_date && s.sampledOn <= c.end_date) ?? null;
    if (!basic) warnings.push({ code: 'no_basic_sample', message: 'No basic soil analysis; P, K and Mg are planned at removal level.' });
    else if (basic.sampledOn < addDays(c.end_date, -365 * BASIC_SAMPLE_MAX_AGE_YEARS)) warnings.push({ code: 'basic_sample_outdated', message: `The soil analysis of ${basic.sampledOn} is older than six years.` });

    const texture = o.soilTexture !== undefined && o.soilTexture !== null
      ? { value: o.soilTexture as SoilTexture, source: 'entered' as const }
      : c.soil_texture
        ? { value: c.soil_texture as SoilTexture, source: 'derived' as const }
        : basic?.soilTexture
          ? { value: basic.soilTexture, source: 'sample' as const }
          : { value: null, source: 'default' as const };
    const soil = soilClassOf(texture.value);
    const humus = o.humusPct != null
      ? { value: o.humusPct, source: 'entered' as const }
      : basic?.humusPct != null
        ? { value: basic.humusPct, source: 'sample' as const }
        : { value: 2, source: 'default' as const };

    let nmin: FertilizerNeedInputs['nmin'];
    if (o.nmin != null) nmin = { value: o.nmin, source: 'entered' };
    else if (o.nminReferenceId) {
      const ref = await trx.selectFrom('nmin_reference_values').select(['id', 'total']).where('id', '=', o.nminReferenceId).executeTakeFirst();
      if (!ref) throw notFound('Nmin reference value');
      nmin = { value: ref.total, source: 'reference', referenceId: ref.id };
    } else if (nminSample?.nminTotal != null) nmin = { value: nminSample.nminTotal, source: 'sample', sampledOn: nminSample.sampledOn };
    else {
      nmin = { value: DEFAULT_NMIN[soil], source: 'default' };
      if (duev && duev.nRequirement > 0) warnings.push({ code: 'nmin_estimated', message: 'No Nmin sample or reference value; an estimate by soil class was used, which is not valid as DüV documentation.' });
    }

    const yieldValue = o.expectedYieldTHa ?? c.expected_yield_t_ha;
    const expectedYield = yieldValue != null
      ? { value: yieldValue, source: (o.expectedYieldTHa != null ? 'entered' : 'derived') as FertilizerNeedInputs['expectedYieldTHa']['source'] }
      : duev
        ? { value: round(duev.referenceYield / 10 / (duev.grassland ? 0.18 : 1), 2), source: 'default' as const }
        : { value: null, source: 'default' as const };
    if (yieldValue == null && duev) warnings.push({ code: 'yield_reference', message: 'No expected yield; the DüV reference yield was used. Use the average of the last five years.' });

    // Previous crop: last season's main crop on the field; catch crop: this season's.
    const previous = o.previousCropId
      ? await trx.selectFrom('crops as c').select(['c.id', 'c.code', cropName('c').as('name')]).where('c.id', '=', o.previousCropId).executeTakeFirst()
      : await trx
          .selectFrom('crop_cycles as cc')
          .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
          .innerJoin('crops as c', 'c.id', 'cc.crop_id')
          .select(['c.id', 'c.code', cropName('c').as('name')])
          .where('cc.field_id', '=', c.field_id)
          .where('cc.role', '=', 'main')
          .where('s.harvest_year', '=', c.harvest_year - 1)
          .orderBy(sql`cc.field_part_id IS NOT DISTINCT FROM ${c.field_part_id}`, 'desc')
          .limit(1)
          .executeTakeFirst();
    const catchCrop = o.catchCropId
      ? await trx.selectFrom('crops as c').select(['c.id', 'c.is_legume', 'c.is_winter_crop', cropName('c').as('name')]).where('c.id', '=', o.catchCropId).executeTakeFirst()
      : c.role === 'main'
        ? await trx
            .selectFrom('crop_cycles as cc')
            .innerJoin('crops as c', 'c.id', 'cc.crop_id')
            .select(['c.id', 'c.is_legume', 'c.is_winter_crop', cropName('c').as('name')])
            .where('cc.field_id', '=', c.field_id)
            .where('cc.season_id', '=', c.season_id)
            .where('cc.role', '=', 'catch_crop')
            .limit(1)
            .executeTakeFirst()
        : undefined;

    let organicN: FertilizerNeedInputs['organicNPreviousYear'];
    if (o.organicNPreviousYear != null) organicN = { value: o.organicNPreviousYear, source: 'entered' };
    else {
      const prev = await trx.selectFrom('growing_seasons').select(['start_date', 'end_date']).where('harvest_year', '=', c.harvest_year - 1).executeTakeFirst();
      let credited = 0;
      if (prev) {
        for (const l of await this.fertilizationLines(trx, { fieldId: c.field_id, from: prev.start_date, to: prev.end_date, statuses: ['completed'] })) {
          if (l.organic && l.nutrients.n != null) credited += l.nutrients.n * organicFollowUpShare(l.fertilizerType);
        }
      }
      organicN = { value: round(credited, 1), source: 'derived' };
    }

    const inputs: FertilizerNeedInputs = {
      cropName: c.crop_name,
      role: c.role as FertilizerNeedInputs['role'],
      areaHa: c.area_ha,
      expectedYieldTHa: expectedYield,
      soilTexture: texture,
      humusPct: humus,
      nmin,
      previousCrop: { id: previous?.id ?? null, name: previous?.name ?? null, source: o.previousCropId ? 'entered' : 'derived' },
      catchCrop: { id: catchCrop?.id ?? null, name: catchCrop?.name ?? null, legume: catchCrop?.is_legume ?? false, winterHardy: catchCrop?.is_winter_crop ?? false, source: o.catchCropId ? 'entered' : 'derived' },
      organicNPreviousYear: organicN,
      filmOrFleece: o.filmOrFleece ?? c.film_or_fleece,
      proteinPct: o.proteinPct ?? c.protein_pct,
      nitrateSensitiveZone: o.nitrateSensitiveZone ?? c.nitrate_sensitive_zone,
      strawRemoved: o.strawRemoved ?? c.straw_removed,
      soilSample: basic ? { id: basic.id, sampledOn: basic.sampledOn, p2o5Mg100g: basic.p2o5Mg100g, k2oMg100g: basic.k2oMg100g, mgoMg100g: basic.mgoMg100g, ph: basic.ph, phMethod: basic.phMethod } : null,
    };

    const n = expectedYield.value != null
      ? nitrogenNeed({
          cropCode: c.code,
          expectedYieldTHa: expectedYield.value,
          nmin: nmin.value ?? 0,
          humusPct: humus.value ?? 2,
          previousCropCode: previous?.code ?? null,
          catchCrop: catchCrop ? { legume: catchCrop.is_legume, winterHardy: catchCrop.is_winter_crop } : null,
          organicPreviousYearDeduction: organicN.value,
          filmOrFleece: inputs.filmOrFleece,
          proteinPct: inputs.proteinPct,
          nitrateSensitiveZone: inputs.nitrateSensitiveZone,
        })
      : null;
    const pk = expectedYield.value != null ? baseFertilizationNeed(c.code, expectedYield.value, inputs.strawRemoved, soil, basic) : [];
    const lime = basic ? limeRequirement(basic.ph, basic.phMethod, soil, humus.value) : null;

    const last = await trx
      .selectFrom('fertilizer_need_records as r')
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .select(['r.id', 'r.created_at', 'u.display_name', sql<number | null>`(r.result -> 'n' ->> 'need')::numeric`.as('n')])
      .where('r.crop_cycle_id', '=', cropCycleId)
      .orderBy('r.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return {
      cropCycleId,
      fieldId: c.field_id,
      fieldName: c.field_name,
      ruleset: DUEV_RULESET,
      inputs,
      n,
      pk,
      limeDtCaO: lime,
      warnings,
      lastRecord: last ? { id: last.id, createdAt: iso(last.created_at), createdBy: last.display_name, n: last.n == null ? null : Number(last.n) } : null,
    };
  }

  /** State Nmin reference values that may fit the crop: same state, newest year up to the harvest year. */
  nminReferences(ctx: Ctx, cropCycleId: string): Promise<NminReferenceValue[]> {
    return this.db.run(ctx, async (trx) => {
      const c = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('fields as f', 'f.id', 'cc.field_id')
        .innerJoin('farms as fa', 'fa.id', 'f.farm_id')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .innerJoin('crops as c', 'c.id', 'cc.crop_id')
        .select(['fa.federal_state', 's.harvest_year', cropName('c').as('crop_name'), 'c.is_winter_crop'])
        .where('cc.id', '=', cropCycleId)
        .executeTakeFirst();
      if (!c) throw notFound('Crop cycle');
      if (!c.federal_state) return [];
      const rows = await trx
        .selectFrom('nmin_reference_values')
        .selectAll()
        .where('state', '=', c.federal_state)
        .where('year', '<=', c.harvest_year)
        .orderBy('year', 'desc')
        .execute();
      const newest = rows[0]?.year;
      const words = c.crop_name.toLowerCase().replace(/[()]/g, ' ').split(/[\s/-]+/).filter((w) => w.length > 3);
      const generic = c.is_winter_crop ? ['winterung', 'winterungen'] : ['sommerung', 'sommerungen', 'sommergetreide'];
      const score = (crop: string) => {
        const t = crop.toLowerCase();
        if (words.some((w) => t.includes(w) || w.includes(t.split(/[\s/]/)[0]))) return 2;
        return generic.some((g) => t.startsWith(g)) ? 1 : 0;
      };
      return rows
        .filter((r) => r.year === newest)
        .map((r) => ({ r, s: score(r.crop) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.r.crop.localeCompare(b.r.crop))
        .slice(0, 40)
        .map(({ r }) => ({
          id: r.id,
          state: r.state,
          region: r.region,
          crop: r.crop,
          previousCrop: r.previous_crop,
          soil: r.soil,
          n0to30: r.n0_30,
          n30to60: r.n30_60,
          n60to90: r.n60_90,
          total: r.total,
          depth: r.depth,
          year: r.year,
          source: r.source,
        }));
    });
  }

  // ---------------------------------------------------------------------------
  // Nutrient balance of a season
  // ---------------------------------------------------------------------------

  /** Fertilizer lines treated on fields, with kg/ha nutrients per line (per treated hectare). */
  private async fertilizationLines(trx: Trx, q: { fieldId?: string; cropCycleIds?: string[]; operationIds?: string[]; from?: string; to?: string; statuses: string[] }) {
    const day = sql<string>`coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)`;
    let query = trx
      .selectFrom('operations as o')
      .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
      .innerJoin('operation_inputs as oi', 'oi.operation_id', 'o.id')
      .innerJoin('products as p', 'p.id', 'oi.product_id')
      .leftJoin('crop_cycles as cc', 'cc.id', 'ofl.crop_cycle_id')
      .leftJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('fields as f', 'f.id', 'ofl.field_id')
      .select([
        'o.id as operation_id',
        'o.status',
        sql<string | null>`${day}::text`.as('day'),
        'ofl.field_id',
        'ofl.crop_cycle_id',
        'ofl.treated_area_ha',
        'oi.rate_per_ha',
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
        'c.category as crop_category',
        'f.nitrate_sensitive_zone',
      ])
      .where('p.category', '=', 'fertilizer')
      .where('o.status', 'in', q.statuses);
    if (q.fieldId) query = query.where('ofl.field_id', '=', q.fieldId);
    if (q.cropCycleIds) query = query.where('ofl.crop_cycle_id', 'in', q.cropCycleIds.length ? q.cropCycleIds : ['00000000-0000-0000-0000-000000000000']);
    if (q.operationIds) query = query.where('o.id', 'in', q.operationIds.length ? q.operationIds : ['00000000-0000-0000-0000-000000000000']);
    if (q.from) query = query.where(day, '>=', q.from);
    if (q.to) query = query.where(day, '<=', q.to);
    const rows = await query.execute();
    return rows.map((r) => {
      const type = r.fertilizer_type as FertilizerType | null;
      const organic = isOrganicFertilizer(type);
      const { densityAssumed: _, ...nutrients } = nutrientKgPerHa(
        { nPct: r.n_pct, nh4NPct: r.nh4_n_pct, p2o5Pct: r.p2o5_pct, k2oPct: r.k2o_pct, mgoPct: r.mgo_pct, sPct: r.s_pct, caoPct: r.cao_pct, densityTM3: r.density_t_m3, fertilizerType: type },
        r.rate_per_ha ?? 0,
        r.base_unit as BaseUnit,
      );
      return { ...r, fertilizerType: type, organic, nutrients: nutrients as NutrientRates, availableN: availableN(type, nutrients.n, nutrients.nh4N, organic) };
    });
  }

  seasonBalance(ctx: Ctx, seasonId: string): Promise<SeasonNutrientBalance> {
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const cycles = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('fields as f', 'f.id', 'cc.field_id')
        .innerJoin('crops as c', 'c.id', 'cc.crop_id')
        .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
        .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select([
          'cc.id',
          'cc.field_id',
          'f.name as field_name',
          'fp.name as part_name',
          'f.nitrate_sensitive_zone',
          cropName('c').as('crop_name'),
          cropColor('c').as('color'),
          sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)`.as('area_ha'),
        ])
        .where('cc.season_id', '=', seasonId)
        .where('cc.role', '=', 'main')
        .where('f.status', '=', 'active')
        .orderBy('f.name')
        .orderBy(sql`fp.sort_order nulls first`)
        .execute();
      const ids = cycles.map((c) => c.id);
      const lines = await this.fertilizationLines(trx, { cropCycleIds: ids, statuses: ['completed', 'planned', 'in_progress'] });
      const records = ids.length
        ? await trx
            .selectFrom('fertilizer_need_records')
            .distinctOn('crop_cycle_id')
            .select(['crop_cycle_id', 'result'])
            .where('crop_cycle_id', 'in', ids)
            .orderBy('crop_cycle_id')
            .orderBy('created_at', 'desc')
            .execute()
        : [];
      const recordOf = new Map(records.map((r) => [r.crop_cycle_id, r.result as { n: { need: number } | null; pk: { nutrient: string; need: number }[] }]));
      const rows: CycleNutrientBalance[] = [];
      for (const c of cycles) {
        const rec = recordOf.get(c.id);
        const need = rec ? { n: rec.n?.need ?? null, pk: rec.pk } : await this.computeNeed(trx, c.id, {}).then((x) => ({ n: x.n?.need ?? null, pk: x.pk }));
        const own = lines.filter((l) => l.crop_cycle_id === c.id);
        const done = own.filter((l) => l.status === 'completed');
        const open = own.filter((l) => l.status !== 'completed');
        const sumAvail = (ls: typeof own) => (ls.some((l) => l.availableN != null) ? round(ls.reduce((s, l) => s + (l.availableN ?? 0), 0), 1) : null);
        const applied = sumNutrients(done.map((l) => l.nutrients));
        const planned = sumNutrients(open.map((l) => l.nutrients));
        const availApplied = sumAvail(done);
        const availPlanned = sumAvail(open);
        const violations = done.filter((l) => {
          if (!l.day || !restrictedByClosedPeriod(l.fertilizerType, l.n_pct)) return false;
          return inClosedPeriod(l.day, closedPeriod(l.crop_category === 'grassland' ? 'grassland' : 'arable', l.fertilizerType, l.nitrate_sensitive_zone ?? false));
        }).length;
        rows.push({
          cropCycleId: c.id,
          fieldId: c.field_id,
          fieldName: c.field_name,
          fieldPartName: c.part_name,
          areaHa: c.area_ha,
          cropName: c.crop_name,
          cropColor: c.color,
          nitrateSensitiveZone: c.nitrate_sensitive_zone,
          nNeed: need.n,
          nNeedRecorded: !!rec,
          p2o5Need: need.pk.find((p) => p.nutrient === 'p2o5')?.need ?? null,
          k2oNeed: need.pk.find((p) => p.nutrient === 'k2o')?.need ?? null,
          applied: { ...applied, availableN: availApplied, organicN: done.some((l) => l.organic) ? round(done.filter((l) => l.organic).reduce((s, l) => s + (l.nutrients.n ?? 0), 0), 1) : null },
          planned: { ...planned, availableN: availPlanned },
          nRemaining: need.n != null ? round(need.n - (availApplied ?? 0) - (availPlanned ?? 0), 1) : null,
          closedPeriodViolations: violations,
        });
      }
      return { seasonId, ruleset: DUEV_RULESET, rows };
    });
  }

  /** Closed-period findings for the fertilization operations among `operationIds`. */
  async closedPeriodFindings(trx: Trx, operationIds: string[]) {
    if (!operationIds.length) return [];
    const lines = await this.fertilizationLines(trx, { operationIds, statuses: ['completed', 'planned', 'in_progress'] });
    return lines.filter((l) => l.day && restrictedByClosedPeriod(l.fertilizerType, l.n_pct)).flatMap((l) => {
      const period = closedPeriod(l.crop_category === 'grassland' ? 'grassland' : 'arable', l.fertilizerType, l.nitrate_sensitive_zone ?? false);
      return inClosedPeriod(l.day!, period) ? [{ operationId: l.operation_id, fieldId: l.field_id, date: l.day!, period }] : [];
    });
  }

  // ---------------------------------------------------------------------------
  // Variable-rate suggestions
  // ---------------------------------------------------------------------------

  suggestRates(ctx: Ctx, input: Out<typeof SuggestRatesInput>): Promise<SuggestedRates> {
    return this.db.run(ctx, async (trx) => {
      const zones = await trx
        .selectFrom('zoning_zones')
        .select(['zone_no', 'area_ha', 'relative_productivity'])
        .where('zoning_id', '=', input.zoningId)
        .orderBy('zone_no')
        .execute();
      if (!zones.length) throw notFound('Zoning');
      const z = zones.map((r) => ({ zoneNo: r.zone_no, areaHa: r.area_ha, relativeProductivity: r.relative_productivity }));
      const gain = input.variationPct / 20;
      if (input.mode === 'seeding') {
        const seedsHa = grainsForPlants(input.plantsPerM2!, input.germinationPct ?? undefined) * 10_000;
        const direction = input.strategy === 'risk_mitigation' ? -1 : 1;
        const { rates, meanRate } = zoneRates(z, seedsHa, { direction, gain, minRate: input.minRate, maxRate: input.maxRate, round: (v) => roundRate(v, 'seeds/ha') });
        return { rates, unit: 'seeds/ha', meanRate, explanation: `${input.plantsPerM2} plants/m² at ${input.germinationPct ?? 94} % germination = ${Math.round(seedsHa)} seeds/ha on average; ${direction > 0 ? 'more' : 'fewer'} seeds on productive zones.` };
      }
      let standard = input.standardRate ?? 0;
      let explanation = 'Standard rate scaled by zone productivity.';
      if (input.mode === 'nitrogen') {
        const need = await this.computeNeed(trx, input.cropCycleId!, {});
        if (!need.n) throw badRequest('no_fertilizer_need', 'There is no N need for this crop');
        const kgN = need.lastRecord?.n ?? need.n.need;
        standard = (kgN * input.passShare) / (input.nPct! / 100);
        explanation = `${round(kgN * input.passShare, 1)} kg N/ha (${Math.round(input.passShare * 100)} % of the N need of ${kgN} kg/ha) with ${input.nPct} % N = ${round(standard, 1)} kg/ha on average.`;
      }
      const { rates, meanRate } = zoneRates(z, standard, { direction: input.inverse ? -1 : 1, gain, minRate: input.minRate, maxRate: input.maxRate, round: (v) => roundRate(v, 'kg/ha') });
      return { rates, unit: 'kg/ha', meanRate, explanation };
    });
  }
}
