import { Injectable } from '@nestjs/common';
import type {
  CropColorsInput,
  CropUsage,
  CreateCropCyclesInput,
  CreateCropInput,
  CreateVarietyInput,
  Crop,
  CropCategory,
  CropCycle,
  CropCycleStatus,
  CropRole,
  RegisteredVariety,
  Season,
  SeasonInput,
  UpdateCropCycleInput,
  Variety,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropColor, cropName } from './crop-name.js';
import { defaultSeasonName } from './seasons.js';

export interface CropCycleQuery {
  ids?: string[];
  seasonId?: string;
  fieldId?: string;
  farmId?: string;
}

@Injectable()
export class CropsService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------

  /** The organization's own crop colours, by crop id. */
  cropColors(ctx: Ctx): Promise<Record<string, string>> {
    return this.db.run(ctx, async (trx) => Object.fromEntries((await trx.selectFrom('org_crop_colors').select(['crop_id', 'color']).execute()).map((r) => [r.crop_id, r.color])));
  }

  /** Sets or resets (null) colours; crops not named keep theirs. */
  setCropColors(ctx: Ctx, input: Out<typeof CropColorsInput>): Promise<Record<string, string>> {
    return this.db.run(ctx, async (trx) => {
      for (const [cropId, color] of Object.entries(input.colors)) {
        if (color === null) {
          await trx.deleteFrom('org_crop_colors').where('crop_id', '=', cropId).execute();
          continue;
        }
        const crop = await trx.selectFrom('crops').select('id').where('id', '=', cropId).executeTakeFirst();
        if (!crop) throw notFound('Crop');
        await trx
          .insertInto('org_crop_colors')
          .values({ organization_id: ctx.orgId, crop_id: cropId, color })
          .onConflict((oc) => oc.columns(['organization_id', 'crop_id']).doUpdateSet({ color }))
          .execute();
      }
      await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'crop_colors_updated', changes: input.colors });
      return Object.fromEntries((await trx.selectFrom('org_crop_colors').select(['crop_id', 'color']).execute()).map((r) => [r.crop_id, r.color]));
    });
  }

  crops(ctx: Ctx): Promise<Crop[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('crops as c')
        .selectAll('c')
        .select([cropName('c').as('display_name'), cropColor('c').as('effective_color')])
        .orderBy('display_name')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.display_name,
        nameEn: r.organization_id == null ? r.name : null,
        category: r.category as CropCategory,
        isWinterCrop: r.is_winter_crop,
        color: r.effective_color,
        custom: r.organization_id != null,
        bsaSpeciesCode: r.bsa_species_code,
        isLegume: r.is_legume,
        isPerennial: r.is_perennial,
        defaultSowingMd: r.default_sowing_md,
        defaultHarvestMd: r.default_harvest_md,
        eppoCode: r.eppo_code,
        landUseCode: r.land_use_code,
      }));
    });
  }

  /**
   * Varieties of the crop's species in the Bundessortenamt register that may currently be sown:
   * approved, or with an ended approval whose seed run-off period has not passed. A name that was
   * registered more than once lists only its latest registration.
   */
  registeredVarieties(ctx: Ctx, cropId: string): Promise<RegisteredVariety[]> {
    return this.db.run(ctx, async (trx) => {
      const crop = await trx.selectFrom('crops').select('bsa_species_code').where('id', '=', cropId).executeTakeFirst();
      if (!crop) throw notFound('Crop');
      if (!crop.bsa_species_code) return [];
      const rows = await trx
        .selectFrom('bsa_varieties')
        .distinctOn('name')
        .select(['id', 'name', 'species_code', 'registration_number', 'approval_granted_on', 'approval_ended_on', 'marketable_until', 'conservation_region'])
        .where('species_code', '=', crop.bsa_species_code)
        .where((eb) =>
          eb.or([
            eb.and([eb('approval_granted_on', 'is not', null), eb('approval_ended_on', 'is', null)]),
            eb('marketable_until', '>=', sql<string>`current_date`),
          ]),
        )
        .orderBy('name')
        .orderBy(sql`approval_ended_on IS NULL`, 'desc')
        .orderBy('approval_granted_on', sql`desc nulls last`)
        .execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        speciesCode: r.species_code,
        registrationNumber: r.registration_number,
        approvedOn: r.approval_granted_on,
        marketableUntil: r.approval_ended_on ? r.marketable_until : null,
        conservationRegion: r.conservation_region,
      }));
    });
  }

  createCrop(ctx: Ctx, input: Out<typeof CreateCropInput>): Promise<Crop[]> {
    return this.db
      .run(ctx, async (trx) => {
        const code = 'custom_' + input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const { id } = await trx
          .insertInto('crops')
          .values({
            organization_id: ctx.orgId,
            code,
            name: input.name,
            category: input.category,
            is_winter_crop: input.isWinterCrop,
            color: input.color,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await record(trx, ctx, { entityType: 'crop', entityId: id, action: 'created', changes: { name: input.name } });
      })
      .then(() => this.crops(ctx));
  }

  varieties(ctx: Ctx, cropId?: string): Promise<Variety[]> {
    return this.db.run(ctx, async (trx) => {
      let q = trx.selectFrom('crop_varieties').select(['id', 'crop_id', 'name', 'bsa_variety_id']).orderBy('name');
      if (cropId) q = q.where('crop_id', '=', cropId);
      return (await q.execute()).map((r) => ({ id: r.id, cropId: r.crop_id, name: r.name, registeredVarietyId: r.bsa_variety_id }));
    });
  }

  /**
   * Adds a variety to the organization's list, or returns the existing one of that name. A name
   * found in the Bundessortenamt register for the crop's species (ignoring case) is stored under
   * its registered spelling and linked to the register entry.
   */
  createVariety(ctx: Ctx, input: Out<typeof CreateVarietyInput>): Promise<Variety> {
    return this.db.run(ctx, async (trx) => {
      const crop = await trx.selectFrom('crops').select(['id', 'bsa_species_code']).where('id', '=', input.cropId).executeTakeFirst();
      if (!crop) throw notFound('Crop');
      const registered = crop.bsa_species_code
        ? await trx
            .selectFrom('bsa_varieties')
            .select(['id', 'name'])
            .where('species_code', '=', crop.bsa_species_code)
            .where(sql`lower(name)`, '=', input.name.toLowerCase())
            .orderBy(sql`approval_ended_on IS NULL`, 'desc')
            .orderBy('approval_granted_on', sql`desc nulls last`)
            .limit(1)
            .executeTakeFirst()
        : undefined;
      const name = registered?.name ?? input.name;
      const row = await trx
        .insertInto('crop_varieties')
        .values({ organization_id: ctx.orgId, crop_id: input.cropId, name, bsa_variety_id: registered?.id ?? null })
        .onConflict((oc) =>
          oc.columns(['organization_id', 'crop_id', 'name']).doUpdateSet({
            bsa_variety_id: sql`coalesce(excluded.bsa_variety_id, crop_varieties.bsa_variety_id)`,
          }),
        )
        .returning(['id', 'crop_id', 'name', 'bsa_variety_id'])
        .executeTakeFirstOrThrow();
      return { id: row.id, cropId: row.crop_id, name: row.name, registeredVarietyId: row.bsa_variety_id };
    });
  }

  // ---------------------------------------------------------------------------
  // Seasons
  // ---------------------------------------------------------------------------

  seasons(ctx: Ctx): Promise<Season[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('growing_seasons as s')
        .select([
          's.id',
          's.name',
          's.harvest_year',
          's.start_date',
          's.end_date',
          (eb) =>
            eb
              .selectFrom('crop_cycles as cc')
              .select((e) => e.fn.countAll<number>().as('n'))
              .whereRef('cc.season_id', '=', 's.id')
              .as('cycles'),
        ])
        .orderBy('s.harvest_year', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        harvestYear: r.harvest_year,
        startDate: r.start_date,
        endDate: r.end_date,
        cropCycleCount: Number(r.cycles ?? 0),
      }));
    });
  }

  createSeason(ctx: Ctx, input: Out<typeof SeasonInput>): Promise<Season[]> {
    return this.db
      .run(ctx, async (trx) => {
        const existing = await trx.selectFrom('growing_seasons').select('id').where('harvest_year', '=', input.harvestYear).executeTakeFirst();
        if (existing) throw conflict('season_exists', `A season for harvest ${input.harvestYear} already exists`);
        const { id } = await trx
          .insertInto('growing_seasons')
          .values({
            organization_id: ctx.orgId,
            name: input.name ?? defaultSeasonName(input.harvestYear),
            harvest_year: input.harvestYear,
            start_date: input.startDate,
            end_date: input.endDate,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await record(trx, ctx, { entityType: 'season', entityId: id, action: 'created', changes: { harvestYear: input.harvestYear } });
      })
      .then(() => this.seasons(ctx));
  }

  updateSeason(ctx: Ctx, id: string, input: Out<typeof SeasonInput>): Promise<Season[]> {
    return this.db
      .run(ctx, async (trx) => {
        const before = await trx.selectFrom('growing_seasons').selectAll().where('id', '=', id).executeTakeFirst();
        if (!before) throw notFound('Season');
        const values = {
          name: input.name ?? defaultSeasonName(input.harvestYear),
          harvest_year: input.harvestYear,
          start_date: input.startDate,
          end_date: input.endDate,
        };
        await trx.updateTable('growing_seasons').set(values).where('id', '=', id).execute();
        await record(trx, ctx, { entityType: 'season', entityId: id, action: 'updated', changes: diff(before, values) });
      })
      .then(() => this.seasons(ctx));
  }

  deleteSeason(ctx: Ctx, id: string): Promise<Season[]> {
    return this.db
      .run(ctx, async (trx) => {
        const used = await trx.selectFrom('crop_cycles').select('id').where('season_id', '=', id).limit(1).executeTakeFirst();
        if (used) throw badRequest('season_in_use', 'Remove the crop assignments of this season first');
        const res = await trx.deleteFrom('growing_seasons').where('id', '=', id).executeTakeFirst();
        if (!res.numDeletedRows) throw notFound('Season');
        await record(trx, ctx, { entityType: 'season', entityId: id, action: 'deleted' });
      })
      .then(() => this.seasons(ctx));
  }

  // ---------------------------------------------------------------------------
  // Crop cycles
  // ---------------------------------------------------------------------------

  cropCycles(ctx: Ctx, q: CropCycleQuery): Promise<CropCycle[]> {
    return this.db.run(ctx, (trx) => this.queryCycles(trx, q));
  }

  createCropCycles(ctx: Ctx, input: Omit<Out<typeof CreateCropCyclesInput>, 'fieldPartIds' | 'role'> & { fieldPartIds?: string[]; role?: CropRole }): Promise<CropCycle[]> {
    return this.db.run(ctx, async (trx) => {
      await this.assertCropAndVariety(trx, input.cropId, input.varietyId);
      const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', input.seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const fieldIds = [...new Set(input.fieldIds)];
      const fields = fieldIds.length ? await trx.selectFrom('fields').select(['id', 'name']).where('id', 'in', fieldIds).execute() : [];
      if (fields.length !== fieldIds.length) throw notFound('Field');
      // A field divided in this season takes crops on its parts only.
      const divided = fieldIds.length
        ? await trx
            .selectFrom('field_parts')
            .select('field_id')
            .where('field_id', 'in', fieldIds)
            .where('season_id', '=', input.seasonId)
            .executeTakeFirst()
        : undefined;
      if (divided) {
        const name = fields.find((f) => f.id === divided.field_id)!.name;
        throw badRequest('field_is_divided', `${name} is divided into part fields this season; assign the crop to its parts`);
      }
      const partIds = [...new Set(input.fieldPartIds ?? [])];
      const parts = partIds.length
        ? await trx.selectFrom('field_parts').select(['id', 'field_id', 'season_id', 'name', 'usage']).where('id', 'in', partIds).execute()
        : [];
      if (parts.length !== partIds.length) throw notFound('Part field');
      for (const p of parts) {
        if (p.season_id !== input.seasonId) throw badRequest('field_part_season_mismatch', `Part "${p.name}" belongs to another season`);
        if (p.usage === 'leased_out') throw badRequest('field_part_leased_out', `Part "${p.name}" is leased out`);
      }
      const targets = [
        ...fieldIds.map((fieldId) => ({ fieldId, partId: null as string | null })),
        ...parts.map((p) => ({ fieldId: p.field_id, partId: p.id as string | null })),
      ];

      const rows = await trx
        .insertInto('crop_cycles')
        .values(
          targets.map(({ fieldId, partId }) => ({
            organization_id: ctx.orgId,
            field_id: fieldId,
            field_part_id: partId,
            season_id: input.seasonId,
            crop_id: input.cropId,
            variety_id: input.varietyId ?? null,
            status: input.status,
            role: input.role ?? 'main',
            // A partial area only makes sense for a single field or part.
            area_ha: targets.length === 1 ? (input.areaHa ?? null) : null,
            sowing_date: input.sowingDate ?? null,
            expected_harvest_date: input.expectedHarvestDate ?? null,
            expected_yield_t_ha: input.expectedYieldTHa ?? null,
            expected_price_per_t: input.expectedPricePerT ?? null,
            usage: input.usage ?? 'commercial',
            // Seed lot and generation only describe seed multiplication.
            seed_lot: input.usage === 'seed_multiplication' ? (input.seedLot ?? null) : null,
            multiplication_generation: input.usage === 'seed_multiplication' ? (input.multiplicationGeneration ?? null) : null,
            notes: input.notes ?? null,
          })),
        )
        .returning(['id', 'field_id', 'field_part_id'])
        .execute();
      for (const row of rows) {
        await record(trx, ctx, {
          entityType: 'crop_cycle',
          entityId: row.id,
          action: 'created',
          changes: { fieldId: row.field_id, fieldPartId: row.field_part_id, cropId: input.cropId, seasonId: input.seasonId },
          event: {
            type: 'crop_cycle.created',
            payload: { cropCycleId: row.id, fieldId: row.field_id, fieldPartId: row.field_part_id, cropId: input.cropId, seasonId: input.seasonId },
          },
        });
      }
      return this.queryCycles(trx, { ids: rows.map((r) => r.id) });
    });
  }

  updateCropCycle(ctx: Ctx, id: string, input: Out<typeof UpdateCropCycleInput>): Promise<CropCycle> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('crop_cycles').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Crop cycle');
      await this.assertCropAndVariety(trx, input.cropId ?? before.crop_id, input.varietyId);
      if (input.fieldPartId && input.fieldPartId !== before.field_part_id) {
        const part = await trx.selectFrom('field_parts').select(['field_id', 'season_id', 'usage', 'name']).where('id', '=', input.fieldPartId).executeTakeFirst();
        if (!part) throw notFound('Part field');
        if (part.field_id !== before.field_id || part.season_id !== before.season_id) {
          throw badRequest('field_part_mismatch', 'A crop can only move to another part of the same field and season');
        }
        if (part.usage === 'leased_out') throw badRequest('field_part_leased_out', `Part "${part.name}" is leased out`);
      }
      const values = {
        crop_id: input.cropId,
        field_part_id: input.fieldPartId,
        variety_id: input.varietyId,
        status: input.status,
        role: input.role,
        area_ha: input.areaHa,
        sowing_date: input.sowingDate,
        expected_harvest_date: input.expectedHarvestDate,
        expected_yield_t_ha: input.expectedYieldTHa,
        expected_price_per_t: input.expectedPricePerT,
        usage: input.usage,
        seed_lot: input.usage === 'commercial' ? null : input.seedLot,
        multiplication_generation: input.usage === 'commercial' ? null : input.multiplicationGeneration,
        notes: input.notes,
      };
      await trx.updateTable('crop_cycles').set(values).where('id', '=', id).execute();
      await record(trx, ctx, {
        entityType: 'crop_cycle',
        entityId: id,
        action: 'updated',
        changes: diff(before, values),
        event: { type: 'crop_cycle.updated', payload: { cropCycleId: id, status: input.status ?? before.status } },
      });
      const [cycle] = await this.queryCycles(trx, { ids: [id] });
      return cycle;
    });
  }

  deleteCropCycle(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const used = await trx.selectFrom('operation_fields').select('id').where('crop_cycle_id', '=', id).limit(1).executeTakeFirst();
      if (used) throw badRequest('crop_cycle_in_use', 'Operations are recorded on this crop; close it instead of deleting it');
      const costs = await trx.selectFrom('cost_entries').select('id').where('crop_cycle_id', '=', id).limit(1).executeTakeFirst();
      if (costs) throw badRequest('crop_cycle_in_use', 'Costs are recorded on this crop; close it instead of deleting it');
      const res = await trx.deleteFrom('crop_cycles').where('id', '=', id).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Crop cycle');
      await record(trx, ctx, { entityType: 'crop_cycle', entityId: id, action: 'deleted', event: { type: 'crop_cycle.deleted', payload: { cropCycleId: id } } });
    });
  }

  private async assertCropAndVariety(trx: Trx, cropId: string, varietyId?: string | null) {
    const crop = await trx.selectFrom('crops').select('id').where('id', '=', cropId).executeTakeFirst();
    if (!crop) throw notFound('Crop');
    if (varietyId) {
      const variety = await trx.selectFrom('crop_varieties').select('crop_id').where('id', '=', varietyId).executeTakeFirst();
      if (!variety) throw notFound('Variety');
      if (variety.crop_id !== cropId) throw badRequest('variety_mismatch', 'The variety belongs to a different crop');
    }
  }

  async queryCycles(trx: Trx, q: CropCycleQuery): Promise<CropCycle[]> {
    let query = trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('fields as f', 'f.id', 'cc.field_id')
      .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .leftJoin('crop_varieties as v', 'v.id', 'cc.variety_id')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
      .leftJoin('cultivation_templates as t', 't.id', 'cc.template_id')
      .select([
        'cc.id',
        'cc.role',
        'cc.template_id',
        't.name as template_name',
        'cc.land_use_code',
        'c.land_use_code as crop_land_use_code',
        'cc.field_id',
        'cc.field_part_id',
        'fp.name as field_part_name',
        'f.name as field_name',
        'f.farm_id',
        'cc.season_id',
        's.name as season_name',
        's.harvest_year',
        'cc.crop_id',
        cropName('c').as('crop_name'),
        cropColor('c').as('color'),
        'cc.variety_id',
        'v.name as variety_name',
        'cc.status',
        sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)`.as('area_ha'),
        'cc.sowing_date',
        'cc.expected_harvest_date',
        'cc.expected_yield_t_ha',
        'cc.expected_price_per_t',
        'cc.usage',
        'cc.seed_lot',
        'cc.multiplication_generation',
        'cc.notes',
      ])
      .orderBy('s.harvest_year', 'desc')
      .orderBy('f.name')
      .orderBy(sql`fp.sort_order nulls first`)
      .orderBy(sql`array_position(array['main','catch_crop','undersown'], cc.role)`);
    if (q.ids) query = query.where('cc.id', 'in', q.ids.length ? q.ids : ['00000000-0000-0000-0000-000000000000']);
    if (q.seasonId) query = query.where('cc.season_id', '=', q.seasonId);
    if (q.fieldId) query = query.where('cc.field_id', '=', q.fieldId);
    if (q.farmId) query = query.where('f.farm_id', '=', q.farmId);
    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      fieldId: r.field_id,
      fieldName: r.field_name,
      farmId: r.farm_id,
      seasonId: r.season_id,
      seasonName: r.season_name,
      harvestYear: r.harvest_year,
      cropId: r.crop_id,
      cropName: r.crop_name,
      cropColor: r.color,
      varietyId: r.variety_id,
      varietyName: r.variety_name,
      status: r.status as CropCycleStatus,
      role: r.role as CropRole,
      templateId: r.template_id,
      templateName: r.template_name,
      landUseCode: r.land_use_code ?? r.crop_land_use_code,
      landUseCodeIsDefault: r.land_use_code == null,
      fieldPartId: r.field_part_id,
      fieldPartName: r.field_part_name,
      areaHa: r.area_ha,
      sowingDate: r.sowing_date,
      expectedHarvestDate: r.expected_harvest_date,
      expectedYieldTHa: r.expected_yield_t_ha,
      expectedPricePerT: r.expected_price_per_t,
      usage: r.usage as CropUsage,
      seedLot: r.seed_lot,
      multiplicationGeneration: r.multiplication_generation,
      notes: r.notes,
    }));
  }
}
