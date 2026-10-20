import { Injectable } from '@nestjs/common';
import type { VarietyDetail, VarietyProperty, VarietyResistance, VarietySpecies, VarietySummary } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { type BslValue, normalizeVarietyKey, numericRows, toDiseaseRatings, toVarietyTraits } from '../../refdata/bsl.js';

interface Row {
  id: string;
  name: string;
  kenn_nummer: string | null;
  species_code: string | null;
  species_name: string | null;
  bsl_species: string;
  bsl_subspecies: string;
  usage: string | null;
  registered_since: number | null;
  breeder: string | null;
  breeder_number: string | null;
  status: string | null;
  hybrid: boolean;
  is_new: boolean;
  note: string | null;
  properties: Record<string, BslValue>;
  quality: Record<string, BslValue>;
  approval_granted_on: string | null;
  approval_ended_on: string | null;
  marketable_until: string | null;
  bsa_variety_id: string | null;
}

/** BSL species names are keys like "weizen_winter" or "spelz_dinkel". */
export const bslSpeciesName = (s: string) =>
  s
    .replace(/_/g, ' ')
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const speciesKey = (r: { species_code: string | null; bsl_species: string }) => r.species_code ?? `bsl:${r.bsl_species}`;

function summary(r: Row): VarietySummary {
  const numeric = numericRows(r.properties);
  return {
    id: r.id,
    name: r.name,
    kennNummer: r.kenn_nummer,
    speciesCode: r.species_code,
    speciesName: r.species_name ?? bslSpeciesName(r.bsl_species),
    subspecies: r.bsl_subspecies,
    usage: r.usage,
    registeredSince: r.registered_since,
    breeder: r.breeder,
    status: r.status,
    hybrid: r.hybrid,
    isNew: r.is_new,
    approval: r.bsa_variety_id ? { grantedOn: r.approval_granted_on, endedOn: r.approval_ended_on, marketableUntil: r.marketable_until } : null,
    traits: toVarietyTraits(numeric),
    ratings: toDiseaseRatings(numeric),
    propertiesCount: Object.keys(r.properties).length,
    qualityCount: Object.keys(r.quality).length,
  };
}

/** Varieties with their BSL traits and ratings (agmeo `app/varieties`, `varieties/resistance`, `crop-varieties/traits`). */
@Injectable()
export class VarietiesService {
  constructor(private readonly db: Database) {}

  private select(trx: Trx) {
    return trx
      .selectFrom('bsl_varieties as v')
      .leftJoin('bsa_species as s', 's.code', 'v.species_code')
      .leftJoin('bsa_varieties as b', 'b.id', 'v.bsa_variety_id')
      .select([
        'v.id',
        'v.name',
        'v.kenn_nummer',
        'v.species_code',
        's.name_de as species_name',
        'v.bsl_species',
        'v.bsl_subspecies',
        'v.usage',
        'v.registered_since',
        'v.breeder',
        'v.breeder_number',
        'v.status',
        'v.hybrid',
        'v.is_new',
        'v.note',
        'v.properties',
        'v.quality',
        sql<string | null>`b.approval_granted_on::text`.as('approval_granted_on'),
        sql<string | null>`b.approval_ended_on::text`.as('approval_ended_on'),
        sql<string | null>`b.marketable_until::text`.as('marketable_until'),
        'v.bsa_variety_id',
      ]);
  }

  species(ctx: Ctx): Promise<VarietySpecies[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('bsl_varieties as v')
        .leftJoin('bsa_species as s', 's.code', 'v.species_code')
        .select(['v.species_code', 'v.bsl_species', 's.name_de', sql<number>`count(*)::int`.as('n')])
        .groupBy(['v.species_code', 'v.bsl_species', 's.name_de'])
        .execute();
      const crops = await trx
        .selectFrom('crops')
        .select(['id', sql<string>`coalesce(name_de, name)`.as('name'), 'bsa_species_code'])
        .where('bsa_species_code', 'is not', null)
        .execute();
      const out = new Map<string, VarietySpecies>();
      for (const r of rows) {
        const key = speciesKey(r);
        const cur = out.get(key) ?? {
          key,
          speciesCode: r.species_code,
          name: r.name_de ?? (r.species_code ? r.species_code : bslSpeciesName(r.bsl_species)),
          count: 0,
          crops: crops.filter((c) => r.species_code && c.bsa_species_code === r.species_code).map((c) => ({ id: c.id, name: c.name })),
        };
        cur.count += r.n;
        out.set(key, cur);
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    });
  }

  list(ctx: Ctx, opts: { species?: string; cropId?: string; q?: string }): Promise<VarietySummary[]> {
    return this.db.run(ctx, async (trx) => {
      let code: string | null | undefined;
      let bslSpecies: string | undefined;
      if (opts.cropId) {
        const crop = await trx.selectFrom('crops').select('bsa_species_code').where('id', '=', opts.cropId).executeTakeFirst();
        if (!crop) throw notFound('Crop');
        if (!crop.bsa_species_code) return [];
        code = crop.bsa_species_code;
      } else if (opts.species?.startsWith('bsl:')) bslSpecies = opts.species.slice(4);
      else if (opts.species) code = opts.species;
      else if (!opts.q) throw badRequest('missing_filter', 'Choose a species, a crop or a search term');
      let q = this.select(trx).orderBy('v.name').limit(1000);
      if (code) q = q.where('v.species_code', '=', code);
      if (bslSpecies) q = q.where('v.species_code', 'is', null).where('v.bsl_species', '=', bslSpecies);
      if (opts.q) q = q.where(sql<boolean>`lower(regexp_replace(v.name, '[[:space:]._-]', '', 'g')) LIKE ${`%${normalizeVarietyKey(opts.q).replace(/[%_\\]/g, '')}%`}`);
      return (await q.execute()).map((r) => summary(r as Row));
    });
  }

  detail(ctx: Ctx, id: string): Promise<VarietyDetail> {
    return this.db.run(ctx, async (trx) => {
      const r = (await this.select(trx).where('v.id', '=', id).executeTakeFirst()) as Row | undefined;
      if (!r) throw notFound('Variety');
      const props = (kind: VarietyProperty['kind'], m: Record<string, BslValue>): VarietyProperty[] => Object.entries(m).map(([name, value]) => ({ name, kind, value }));
      return { ...summary(r), note: r.note, breederNumber: r.breeder_number, properties: [...props('property', r.properties), ...props('quality', r.quality)] };
    });
  }

  /**
   * Disease susceptibilities of a variety (reference GET varieties/resistance): by the crop
   * cycle's variety (its BSA link, else its name) or by name; null when it is not in the list.
   */
  resistance(ctx: Ctx, opts: { variety?: string; cropCycleId?: string }): Promise<VarietyResistance | null> {
    if (!opts.variety && !opts.cropCycleId) throw badRequest('missing_variety', 'Provide a variety name or a crop cycle');
    return this.db.run(ctx, async (trx) => {
      let name = opts.variety ?? null;
      let bsaId: string | null = null;
      let speciesCode: string | null = null;
      let crop: string | null = null;
      if (opts.cropCycleId) {
        const c = await trx
          .selectFrom('crop_cycles as cc')
          .innerJoin('crops as c', 'c.id', 'cc.crop_id')
          .leftJoin('crop_varieties as cv', 'cv.id', 'cc.variety_id')
          .select(['cv.name', 'cv.bsa_variety_id', 'c.bsa_species_code', sql<string>`coalesce(c.name_de, c.name)`.as('crop')])
          .where('cc.id', '=', opts.cropCycleId)
          .executeTakeFirst();
        if (!c) throw notFound('Crop cycle');
        name = c.name ?? name;
        bsaId = c.bsa_variety_id;
        speciesCode = c.bsa_species_code;
        crop = c.crop;
      }
      let q = this.select(trx).limit(1);
      if (bsaId) q = q.where('v.bsa_variety_id', '=', bsaId);
      else if (name) {
        q = q.where(sql<boolean>`lower(regexp_replace(v.name, '[[:space:]._-]', '', 'g')) = ${normalizeVarietyKey(name)}`);
        if (speciesCode) q = q.where('v.species_code', '=', speciesCode);
      } else return null;
      const r = (await q.orderBy(sql`(SELECT count(*) FROM jsonb_object_keys(v.properties))`, 'desc').executeTakeFirst()) as Row | undefined;
      if (!r) return null;
      return { crop: crop ?? r.species_name ?? bslSpeciesName(r.bsl_species), variety: r.name, ratings: toDiseaseRatings(numericRows(r.properties)) };
    });
  }
}
