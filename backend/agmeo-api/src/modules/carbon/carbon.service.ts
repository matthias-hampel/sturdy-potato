import { Injectable } from '@nestjs/common';
import {
  type BekEmissions,
  type BekSource,
  bekGroup,
  CARBON_SOIL_DEPTH_CM,
  type CarbonAnalysis,
  type CarbonComparison,
  type CarbonComparisonRow,
  type CarbonLevel,
  type CarbonReportRow,
  type CarbonSettings,
  type CarbonSettingsInput,
  type CarbonSoil,
  type CarbonSoilInput,
  type CarbonSoilValues,
  type FertilizerType,
  isOrganicFertilizer,
  ORGANIC_FERTILIZER_TYPES,
  type BaseUnit,
  nutrientKgPerHa,
  type RotationCarbon,
  type RothCInput,
  type RothCResult,
  type Scope2,
  type Scope2Input,
  type Scope2Kind,
  type Scope2Year,
  SCOPE2_ELECTRICITY_KINDS,
  SCOPE2_KINDS,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, DomainError, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { DUEV_CROPS } from '../nutrients/lib/duev.js';
import { computeScope2Row, scope2ParameterDetails } from './bek/scope2.js';
import {
  expectedCo2e,
  germanNuts2Codes,
  type Nuts2Code,
  NUTS2_OF_STATE,
} from './bek/regions.js';
import { bekSource, CO2E_FACTOR_SET } from './co2e.js';
import { carbonCrop, dryMatterContent, hasModelData } from './crops.js';
import {
  type CarbonInputLine,
  cycleEmissionsPerHa,
  operationEmissionsPerHa,
  scale,
} from './emissions.js';
import { carbonLine, productCarbonColumns } from './ledger.js';
import {
  batchRunRothC,
  RothCError,
  thuenenConfigured,
} from './thuenen/client.js';
import {
  averageRothCResults,
  buildYearDataForInterval,
  createThuenenRequestBody,
  type RotationEntryForSimulation,
  SIMULATION_INTERVALS,
  SimulationInputError,
} from './thuenen/simulation.js';

/** Topsoil values the reference prefills when a field has no sample. */
const FALLBACK_SOIL: CarbonSoilValues = {
  depthCm: CARBON_SOIL_DEPTH_CM,
  bulkDensity: 1.3,
  clayPct: 20,
  socPct: 1.5,
  sandPct: 30,
};
/** Humus → soil organic carbon (van Bemmelen factor). */
const HUMUS_PER_SOC = 1.724;

interface CycleRow {
  id: string;
  field_id: string;
  field_name: string;
  season_id: string;
  harvest_year: number;
  status: string;
  role: string;
  straw_removed: boolean;
  expected_yield_t_ha: number | null;
  crop_id: string;
  crop_code: string;
  crop_name: string;
  crop_color: string;
  template_id: string | null;
  template_name: string | null;
  area_ha: number;
  harvested_t: number | null;
  harvested_area: number | null;
  harvest_done: boolean;
}

const add = (target: BekEmissions, source: BekSource, kg: number) => {
  if (kg) target[source] = (target[source] ?? 0) + kg;
};

/** The economics and analysis view of what a crop cycle emits, apart from the ledger. */
export interface CycleCarbon {
  byId: BekEmissions;
}

@Injectable()
export class CarbonService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Crop-cycle terms (humus, residues, last year's organic N)
  // ---------------------------------------------------------------------------

  private async cycles(trx: Trx, seasonIds: string[]): Promise<CycleRow[]> {
    if (!seasonIds.length) return [];
    const { rows } = await sql<CycleRow>`
      SELECT cc.id, cc.field_id, concat_ws(' · ', f.name, fp.name) AS field_name, cc.season_id, s.harvest_year, cc.status, cc.role,
             cc.straw_removed, cc.expected_yield_t_ha, cc.crop_id, c.code AS crop_code, coalesce(c.name_de, c.name) AS crop_name,
             coalesce((SELECT occ.color FROM org_crop_colors occ WHERE occ.crop_id = c.id), c.color) AS crop_color,
             cc.template_id, t.name AS template_name,
             coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0) AS area_ha, h.qty AS harvested_t, h.area AS harvested_area,
             EXISTS (SELECT 1 FROM operation_fields ofl JOIN operations o ON o.id = ofl.operation_id
                     WHERE ofl.crop_cycle_id = cc.id AND o.type = 'harvest' AND o.status = 'completed') AS harvest_done
      FROM crop_cycles cc
      JOIN growing_seasons s ON s.id = cc.season_id
      JOIN fields f ON f.id = cc.field_id
      JOIN crops c ON c.id = cc.crop_id
      LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
      LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
      LEFT JOIN cultivation_templates t ON t.id = cc.template_id
      LEFT JOIN LATERAL (SELECT sum(quantity_t) AS qty, sum(harvested_area_ha) AS area FROM harvests WHERE crop_cycle_id = cc.id) h ON true
      WHERE cc.season_id IN (${sql.join(seasonIds)})`.execute(trx);
    return rows;
  }

  /** Total organic N applied per hectare on each field in each harvest year (completed operations). */
  private async organicNByFieldYear(trx: Trx): Promise<Map<string, number>> {
    const { rows } = await sql<{
      field_id: string;
      harvest_year: number | null;
      total_quantity: number;
      op_area: number;
      base_unit: string;
      n_pct: number | null;
      density_t_m3: number | null;
      fertilizer_type: string | null;
    }>`
      SELECT ofl.field_id, s.harvest_year, oi.total_quantity, tot.area AS op_area, p.base_unit, p.n_pct, p.density_t_m3, p.fertilizer_type
      FROM operations o
      JOIN operation_inputs oi ON oi.operation_id = o.id
      JOIN products p ON p.id = oi.product_id
      JOIN operation_fields ofl ON ofl.operation_id = o.id
      JOIN LATERAL (SELECT sum(treated_area_ha) AS area FROM operation_fields WHERE operation_id = o.id) tot ON true
      LEFT JOIN growing_seasons s ON (o.performed_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN s.start_date AND s.end_date
      WHERE o.status = 'completed' AND p.category = 'fertilizer' AND p.fertilizer_type IN (${sql.join([...ORGANIC_FERTILIZER_TYPES])})`.execute(
      trx,
    );
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.harvest_year == null || !r.op_area) continue;
      const n =
        nutrientKgPerHa(
          {
            nPct: r.n_pct,
            densityTM3: r.density_t_m3,
            fertilizerType: r.fertilizer_type as FertilizerType,
          },
          r.total_quantity / r.op_area,
          r.base_unit as BaseUnit,
        ).n ?? 0;
      const key = `${r.field_id}:${r.harvest_year}`;
      out.set(key, (out.get(key) ?? 0) + n);
    }
    return out;
  }

  /**
   * kg CO2e by source booked on crop cycles rather than operations. The crop's humus effect and
   * last year's organic N count once the crop is established (sown); residues and their credits
   * once it is harvested, with the harvested yield (else the expected one).
   */
  async cycleCarbon(
    trx: Trx,
    seasonIds: string[],
    cycles?: CycleRow[],
  ): Promise<Map<string, CycleCarbon>> {
    const rows = cycles ?? (await this.cycles(trx, seasonIds));
    const out = new Map<string, CycleCarbon>();
    if (!rows.length) return out;
    const organicN = await this.organicNByFieldYear(trx);
    for (const c of rows) {
      const harvested =
        (c.harvested_t ?? 0) > 0 ||
        c.harvest_done ||
        c.status === 'harvested' ||
        c.status === 'closed';
      const established = harvested || c.status === 'active';
      if (!established || !c.area_ha) continue;
      const yieldTHa = !harvested
        ? null
        : c.harvested_t && c.harvested_area
          ? c.harvested_t / c.harvested_area
          : c.expected_yield_t_ha;
      const perHa = cycleEmissionsPerHa(
        {
          crop: carbonCrop(c.crop_code),
          yieldTHa,
          strawRemoved: c.straw_removed,
          nLastYearKgHa:
            c.role === 'main'
              ? (organicN.get(`${c.field_id}:${c.harvest_year - 1}`) ?? 0)
              : 0,
        },
        c.harvest_year,
      ).byId;
      out.set(c.id, { byId: scale(perHa, c.area_ha) });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // CO2 analysis
  // ---------------------------------------------------------------------------

  analysis(
    ctx: Ctx,
    level: CarbonLevel,
    years?: number[],
  ): Promise<CarbonAnalysis> {
    return this.db.run(ctx, (trx) =>
      this.analysisIn(trx, ctx.orgId, level, years),
    );
  }

  private async analysisIn(
    trx: Trx,
    orgId: string,
    level: CarbonLevel,
    years?: number[],
  ): Promise<CarbonAnalysis> {
    let sq = trx
      .selectFrom('growing_seasons')
      .select(['id', 'harvest_year'])
      .orderBy('harvest_year');
    if (years?.length) sq = sq.where('harvest_year', 'in', years);
    const seasons = await sq.execute();
    const yearOf = new Map(seasons.map((s) => [s.id, s.harvest_year]));
    const seasonIds = seasons.map((s) => s.id);
    const settings = await trx
      .selectFrom('carbon_settings')
      .select('nuts2_code')
      .where('organization_id', '=', orgId)
      .executeTakeFirst();
    const nuts2 = (settings?.nuts2_code ?? null) as Nuts2Code | null;
    const empty: CarbonAnalysis = {
      factorSet: CO2E_FACTOR_SET,
      level,
      years: seasons.map((s) => s.harvest_year),
      rows: [],
      unallocatedKg: {},
      nuts2Code: nuts2,
      regionalReference: {},
      scope2: await this.scope2Years(
        trx,
        seasons.map((s) => s.harvest_year),
      ),
    };
    if (!seasonIds.length) return empty;

    const ledger = await trx
      .selectFrom('emission_entries as e')
      .innerJoin('operations as o', 'o.id', 'e.operation_id')
      .select([
        'e.season_id',
        'e.crop_cycle_id',
        'e.source',
        'o.type',
        sql<number>`sum(e.kg_co2e)`.as('kg'),
      ])
      .where('e.season_id', 'in', seasonIds)
      .groupBy(['e.season_id', 'e.crop_cycle_id', 'e.source', 'o.type'])
      .execute();
    const cycles = await this.cycles(trx, seasonIds);
    const cycleTerms = await this.cycleCarbon(trx, seasonIds, cycles);

    const perCycle = new Map<
      string,
      { bySource: BekEmissions; byType: Record<string, number> }
    >();
    const entry = (id: string) => {
      let e = perCycle.get(id);
      if (!e) perCycle.set(id, (e = { bySource: {}, byType: {} }));
      return e;
    };
    const unallocatedKg: Record<string, number> = {};
    for (const l of ledger) {
      const source = bekSource(l.source);
      const kg = Number(l.kg);
      if (!source || !kg) continue;
      if (!l.crop_cycle_id) {
        const y = String(yearOf.get(l.season_id!) ?? '');
        unallocatedKg[y] = round((unallocatedKg[y] ?? 0) + kg, 1);
        continue;
      }
      const e = entry(l.crop_cycle_id);
      add(e.bySource, source, kg);
      e.byType[l.type] = (e.byType[l.type] ?? 0) + kg;
    }
    for (const [id, terms] of cycleTerms) {
      const e = entry(id);
      for (const [source, kg] of Object.entries(terms.byId) as [
        BekSource,
        number,
      ][]) {
        add(e.bySource, source, kg);
        // Last year's N belongs to fertilization; humus and residues to the harvest, as in the reference.
        const type =
          source === 'pf6' || source === 'pb2a' ? 'fertilization' : 'harvest';
        e.byType[type] = (e.byType[type] ?? 0) + kg;
      }
    }

    const rows = new Map<string, CarbonReportRow>();
    for (const c of cycles) {
      const e = perCycle.get(c.id);
      if (!e) continue;
      const entityId =
        level === 'crop'
          ? c.crop_id
          : level === 'template'
            ? (c.template_id ?? `crop:${c.crop_id}`)
            : c.id;
      const key = `${c.harvest_year}:${entityId}`;
      const crop = carbonCrop(c.crop_code);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          year: c.harvest_year,
          entityId,
          entityName:
            level === 'crop'
              ? c.crop_name
              : level === 'template'
                ? (c.template_name ?? c.crop_name)
                : c.field_name,
          cropId: c.crop_id,
          cropCode: c.crop_code,
          cropName: c.crop_name,
          cropColor: c.crop_color,
          carbonCrop: crop,
          hasModelData: hasModelData(crop),
          templateName: c.template_name,
          cyclesCount: 0,
          areaHa: 0,
          yieldT: 0,
          yieldTDm: 0,
          total: 0,
          pf: 0,
          pb: 0,
          pn: 0,
          bySource: {},
          byOperationType: {},
        };
        rows.set(key, row);
      }
      const yieldT =
        c.harvested_t ??
        (c.expected_yield_t_ha != null ? c.expected_yield_t_ha * c.area_ha : 0);
      row.cyclesCount += 1;
      row.areaHa += c.area_ha;
      row.yieldT += yieldT;
      row.yieldTDm += yieldT * (dryMatterContent(crop) ?? 0);
      for (const [source, kg] of Object.entries(e.bySource) as [
        BekSource,
        number,
      ][]) {
        row.bySource[source] = (row.bySource[source] ?? 0) + kg;
        row[bekGroup(source)] += kg;
        row.total += kg;
      }
      for (const [type, kg] of Object.entries(e.byType))
        row.byOperationType[type] = (row.byOperationType[type] ?? 0) + kg;
    }
    const out = [...rows.values()].map((r) => ({
      ...r,
      areaHa: round(r.areaHa, 4),
      yieldT: round(r.yieldT, 3),
      yieldTDm: round(r.yieldTDm, 3),
      total: round(r.total, 1),
      pf: round(r.pf, 1),
      pb: round(r.pb, 1),
      pn: round(r.pn, 1),
      bySource: Object.fromEntries(
        Object.entries(r.bySource).map(([k, v]) => [k, round(v!, 2)]),
      ),
      byOperationType: Object.fromEntries(
        Object.entries(r.byOperationType).map(([k, v]) => [k, round(v!, 2)]),
      ),
    }));
    out.sort(
      (a, b) =>
        a.year - b.year ||
        a.cropName.localeCompare(b.cropName) ||
        a.entityName.localeCompare(b.entityName),
    );

    const regionalReference: Record<string, number> = {};
    if (nuts2) {
      for (const r of out) {
        const ref = r.carbonCrop
          ? expectedCo2e[r.carbonCrop as keyof typeof expectedCo2e]?.[nuts2]
          : undefined;
        if (ref != null) regionalReference[r.cropCode] = ref;
      }
    }
    return { ...empty, rows: out, unallocatedKg, regionalReference };
  }

  /** The crop-level analysis of several organizations the user is an active member of (farm comparison). */
  async comparison(
    ctx: Ctx,
    orgIds: string[],
    years?: number[],
  ): Promise<CarbonComparison> {
    const ids = [...new Set([ctx.orgId, ...orgIds])];
    const organizations: CarbonComparison['organizations'] = [];
    const rows: CarbonComparisonRow[] = [];
    const scope2: CarbonComparison['scope2'] = [];
    for (const orgId of ids) {
      const scope = { userId: ctx.userId, orgId };
      const org = await this.db.run(scope, (trx) =>
        trx
          .selectFrom('memberships as m')
          .innerJoin('organizations as o', 'o.id', 'm.organization_id')
          .select(['o.id', 'o.name'])
          .where('m.organization_id', '=', orgId)
          .where('m.user_id', '=', ctx.userId)
          .where('m.status', '=', 'active')
          .executeTakeFirst(),
      );
      // Organizations the user does not belong to are left out silently (no enumeration).
      if (!org) continue;
      organizations.push({ id: org.id, name: org.name });
      const analysis = await this.db.run(scope, (trx) =>
        this.analysisIn(trx, orgId, 'crop', years),
      );
      rows.push(
        ...analysis.rows.map((r) => ({
          ...r,
          key: `${orgId}:${r.key}`,
          orgId,
          orgName: org.name,
        })),
      );
      scope2.push(
        ...analysis.scope2.map((y) => ({ ...y, orgId, orgName: org.name })),
      );
    }
    return { organizations, rows, scope2 };
  }

  /** The organizations the user can compare with (active memberships). */
  async organizations(ctx: Ctx): Promise<{ id: string; name: string }[]> {
    return this.db.run({ userId: ctx.userId }, (trx) =>
      trx
        .selectFrom('memberships as m')
        .innerJoin('organizations as o', 'o.id', 'm.organization_id')
        .select(['o.id', 'o.name'])
        .where('m.user_id', '=', ctx.userId)
        .where('m.status', '=', 'active')
        .orderBy('o.name')
        .execute(),
    );
  }

  // ---------------------------------------------------------------------------
  // Scope 2: purchased electricity and heat
  // ---------------------------------------------------------------------------

  private async scope2Years(trx: Trx, years: number[]): Promise<Scope2Year[]> {
    if (!years.length) return [];
    const rows = await trx
      .selectFrom('scope2_entries')
      .select(['harvest_year', 'kind', 'kwh', 'kg_co2e'])
      .where('harvest_year', 'in', years)
      .orderBy('harvest_year')
      .execute();
    const byYear = new Map<number, Scope2Year>();
    for (const r of rows) {
      let y = byYear.get(r.harvest_year);
      if (!y)
        byYear.set(
          r.harvest_year,
          (y = {
            harvestYear: r.harvest_year,
            entries: [],
            electricityKg: 0,
            totalKg: 0,
          }),
        );
      const kind = r.kind as Scope2Kind;
      y.entries.push({ kind, kwh: r.kwh, kgCo2e: r.kg_co2e });
      y.totalKg = round(y.totalKg + r.kg_co2e, 3);
      if ((SCOPE2_ELECTRICITY_KINDS as readonly string[]).includes(kind))
        y.electricityKg = round(y.electricityKg + r.kg_co2e, 3);
    }
    return [...byYear.values()];
  }

  private scope2Parameters(): Scope2['parameters'] {
    return Object.fromEntries(
      SCOPE2_KINDS.map((k) => [k, scope2ParameterDetails(k)]),
    ) as Scope2['parameters'];
  }

  scope2(ctx: Ctx, harvestYear: number): Promise<Scope2> {
    return this.db.run(ctx, async (trx) => {
      const [year] = await this.scope2Years(trx, [harvestYear]);
      return {
        ...(year ?? { harvestYear, entries: [], electricityKg: 0, totalKg: 0 }),
        parameters: this.scope2Parameters(),
      };
    });
  }

  /** Replaces the year's entries; kinds left out or at 0 kWh are removed (reference upsertScope2Entries). */
  saveScope2(ctx: Ctx, input: Out<typeof Scope2Input>): Promise<Scope2> {
    return this.db
      .run(ctx, async (trx) => {
        await trx
          .deleteFrom('scope2_entries')
          .where('harvest_year', '=', input.harvestYear)
          .execute();
        const valid = input.entries.filter(
          (e) => Number.isFinite(e.kwh) && e.kwh > 0,
        );
        if (valid.length) {
          await trx
            .insertInto('scope2_entries')
            .values(
              valid.map((e) => {
                const row = computeScope2Row(e.kind, e.kwh);
                return {
                  organization_id: ctx.orgId,
                  harvest_year: input.harvestYear,
                  kind: e.kind,
                  kwh: row.kwh,
                  kg_co2e: round(row.kgCo2e, 3),
                  parameter_id: row.parameter.id,
                  factor: row.parameter.value,
                  updated_by: ctx.userId,
                };
              }),
            )
            .execute();
        }
        await record(trx, ctx, {
          entityType: 'scope2',
          entityId: ctx.orgId,
          action: 'updated',
          changes: { harvestYear: input.harvestYear, kinds: valid.length },
        });
      })
      .then(() => this.scope2(ctx, input.harvestYear));
  }

  // ---------------------------------------------------------------------------
  // Settings: NUTS 2 region
  // ---------------------------------------------------------------------------

  settings(ctx: Ctx): Promise<CarbonSettings> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx
        .selectFrom('carbon_settings')
        .select('nuts2_code')
        .where('organization_id', '=', ctx.orgId)
        .executeTakeFirst();
      const states = await trx
        .selectFrom('farms')
        .select('federal_state')
        .distinct()
        .where('archived_at', 'is', null)
        .where('federal_state', 'is not', null)
        .execute();
      const suggested =
        states.length === 1
          ? (NUTS2_OF_STATE[states[0].federal_state!] ?? null)
          : null;
      return {
        nuts2Code: row?.nuts2_code ?? null,
        suggestedNuts2Code: suggested,
        regions: Object.entries(germanNuts2Codes)
          .map(([code, name]) => ({ code, name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      };
    });
  }

  saveSettings(
    ctx: Ctx,
    input: Out<typeof CarbonSettingsInput>,
  ): Promise<CarbonSettings> {
    if (input.nuts2Code && !(input.nuts2Code in germanNuts2Codes))
      throw badRequest('unknown_region', 'Unknown NUTS 2 region');
    return this.db
      .run(ctx, async (trx) => {
        await trx
          .insertInto('carbon_settings')
          .values({
            organization_id: ctx.orgId,
            nuts2_code: input.nuts2Code,
            updated_by: ctx.userId,
          })
          .onConflict((oc) =>
            oc
              .column('organization_id')
              .doUpdateSet({
                nuts2_code: input.nuts2Code,
                updated_at: new Date(),
                updated_by: ctx.userId,
              }),
          )
          .execute();
        await record(trx, ctx, {
          entityType: 'carbon_settings',
          entityId: ctx.orgId,
          action: 'updated',
          changes: { nuts2Code: input.nuts2Code },
        });
      })
      .then(() => this.settings(ctx));
  }

  // ---------------------------------------------------------------------------
  // Topsoil values for the humus model
  // ---------------------------------------------------------------------------

  soil(ctx: Ctx, fieldId: string): Promise<CarbonSoil> {
    return this.db.run(ctx, (trx) => this.soilIn(trx, fieldId));
  }

  private async soilIn(trx: Trx, fieldId: string): Promise<CarbonSoil> {
    const field = await trx
      .selectFrom('fields')
      .select('id')
      .where('id', '=', fieldId)
      .executeTakeFirst();
    if (!field) throw notFound('Field');
    const saved = await trx
      .selectFrom('field_carbon_soil as s')
      .leftJoin('files as f', 'f.id', 's.file_id')
      .select([
        's.depth_cm',
        's.bulk_density',
        's.clay_pct',
        's.soc_pct',
        's.sand_pct',
        's.sampled_on',
        's.file_id',
        's.updated_at',
        'f.name as file_name',
      ])
      .where('s.field_id', '=', fieldId)
      .executeTakeFirst();
    if (saved) {
      const values = {
        depthCm: saved.depth_cm,
        bulkDensity: saved.bulk_density,
        clayPct: saved.clay_pct,
        socPct: saved.soc_pct,
        sandPct: saved.sand_pct,
      };
      return {
        fieldId,
        saved: {
          ...values,
          sampledOn: saved.sampled_on,
          fileId: saved.file_id,
          fileName: saved.file_name,
          updatedAt: iso(saved.updated_at),
        },
        values,
        prefillSource: 'saved',
      };
    }
    const sample = await trx
      .selectFrom('soil_samples')
      .select('humus_pct')
      .where('field_id', '=', fieldId)
      .where('humus_pct', 'is not', null)
      .orderBy('sampled_on', 'desc')
      .executeTakeFirst();
    if (sample?.humus_pct) {
      const soc = Math.min(
        10,
        Math.max(0.1, round(sample.humus_pct / HUMUS_PER_SOC, 2)),
      );
      return {
        fieldId,
        saved: null,
        values: { ...FALLBACK_SOIL, socPct: soc },
        prefillSource: 'soil_sample',
      };
    }
    return {
      fieldId,
      saved: null,
      values: FALLBACK_SOIL,
      prefillSource: 'default',
    };
  }

  saveSoil(
    ctx: Ctx,
    fieldId: string,
    input: Out<typeof CarbonSoilInput>,
  ): Promise<CarbonSoil> {
    return this.db.run(ctx, async (trx) => {
      const field = await trx
        .selectFrom('fields')
        .select('id')
        .where('id', '=', fieldId)
        .executeTakeFirst();
      if (!field) throw notFound('Field');
      if (input.fileId) {
        const file = await trx
          .selectFrom('files')
          .select('id')
          .where('id', '=', input.fileId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!file) throw notFound('File');
      }
      const values = {
        depth_cm: CARBON_SOIL_DEPTH_CM,
        bulk_density: input.bulkDensity,
        clay_pct: input.clayPct,
        soc_pct: input.socPct,
        sand_pct: input.sandPct,
        sampled_on: input.sampledOn ?? null,
        file_id: input.fileId ?? null,
        updated_by: ctx.userId,
      };
      await trx
        .insertInto('field_carbon_soil')
        .values({ organization_id: ctx.orgId, field_id: fieldId, ...values })
        .onConflict((oc) =>
          oc
            .column('field_id')
            .doUpdateSet({ ...values, updated_at: new Date() }),
        )
        .execute();
      await record(trx, ctx, {
        entityType: 'field',
        entityId: fieldId,
        action: 'carbon_soil_saved',
        changes: {
          bulkDensity: input.bulkDensity,
          clayPct: input.clayPct,
          socPct: input.socPct,
          sandPct: input.sandPct,
        },
      });
      return this.soilIn(trx, fieldId);
    });
  }

  deleteSoil(ctx: Ctx, fieldId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx
        .deleteFrom('field_carbon_soil')
        .where('field_id', '=', fieldId)
        .executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Soil values');
      await record(trx, ctx, {
        entityType: 'field',
        entityId: fieldId,
        action: 'carbon_soil_deleted',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Rotations: CO2e per entry and the RothC simulation
  // ---------------------------------------------------------------------------

  private async rotationEntries(trx: Trx, rotationId: string) {
    const rotation = await trx
      .selectFrom('crop_rotations')
      .select(['id', 'name'])
      .where('id', '=', rotationId)
      .executeTakeFirst();
    if (!rotation) throw notFound('Crop rotation');
    const entries = await trx
      .selectFrom('crop_rotation_entries as e')
      .innerJoin('crops as c', 'c.id', 'e.crop_id')
      .leftJoin('crops as cc', 'cc.id', 'e.catch_crop_id')
      .select([
        'e.position',
        'e.template_id',
        'e.expected_yield_t_ha',
        'c.code as crop_code',
        sql<string>`coalesce(c.name_de, c.name)`.as('crop_name'),
        'c.default_sowing_md',
        'c.default_harvest_md',
        'cc.code as catch_code',
        'cc.default_sowing_md as catch_sowing_md',
        'cc.default_harvest_md as catch_harvest_md',
      ])
      .where('e.rotation_id', '=', rotationId)
      .orderBy('e.position')
      .execute();
    const templateIds = [
      ...new Set(
        entries.map((e) => e.template_id).filter((t): t is string => t != null),
      ),
    ];
    const inputs = templateIds.length
      ? await trx
          .selectFrom('template_steps as s')
          .innerJoin('template_step_inputs as i', 'i.step_id', 's.id')
          .innerJoin('products as p', 'p.id', 'i.product_id')
          .select([
            's.template_id',
            's.type',
            'i.rate_per_ha',
            ...productCarbonColumns,
          ])
          .where('s.template_id', 'in', templateIds)
          .execute()
      : [];
    const linesOf = (templateId: string | null): CarbonInputLine[] =>
      inputs
        .filter((i) => i.template_id === templateId)
        .map((i) => carbonLine(i, i.rate_per_ha));
    return {
      rotation,
      entries: entries.map((e) => {
        const duev = DUEV_CROPS[e.crop_code];
        // Expected yield of the entry, else the DüV reference yield (dt → t).
        const yieldTHa =
          e.expected_yield_t_ha ?? (duev ? duev.referenceYield / 10 : 0);
        return { ...e, yieldTHa, inputs: linesOf(e.template_id) };
      }),
    };
  }

  /** kg CO2e/ha of every rotation entry: its template's inputs and the crop's humus and residues at the expected yield. */
  rotationCarbon(ctx: Ctx, rotationId: string): Promise<RotationCarbon> {
    return this.db.run(ctx, async (trx) => {
      const { entries } = await this.rotationEntries(trx, rotationId);
      return {
        rotationId,
        entries: entries.map((e) => {
          const crop = carbonCrop(e.crop_code);
          if (!hasModelData(crop))
            return {
              position: e.position,
              cropName: e.crop_name,
              co2eKgPerHa: null,
              hasModelData: false,
            };
          const op = operationEmissionsPerHa(
            { type: 'other', dieselLPerHa: 0, inputs: e.inputs },
            crop,
          ).byId;
          const cycle = cycleEmissionsPerHa({
            crop,
            yieldTHa: e.yieldTHa,
            strawRemoved: false,
            nLastYearKgHa: 0,
            catchCrop: carbonCrop(e.catch_code),
          }).byId;
          const total = [...Object.values(op), ...Object.values(cycle)].reduce(
            (a, b) => a + (b ?? 0),
            0,
          );
          return {
            position: e.position,
            cropName: e.crop_name,
            co2eKgPerHa: round(total, 1),
            hasModelData: true,
          };
        }),
      };
    });
  }

  /** Simulates the field's soil carbon under a rotation with the Thünen RothC model. */
  async rothc(
    ctx: Ctx,
    fieldId: string,
    input: Out<typeof RothCInput>,
  ): Promise<RothCResult> {
    if (!thuenenConfigured())
      throw new DomainError(
        503,
        'carbon_model_unavailable',
        'The soil-carbon model (Thünen AgriGHG tool) is not configured',
      );
    const prepared = await this.db.run(ctx, async (trx) => {
      const soil = await this.soilIn(trx, fieldId);
      if (!soil.saved)
        throw badRequest(
          'carbon_soil_missing',
          'Save the topsoil values of the field first',
        );
      const field = await trx
        .selectFrom('fields as f')
        .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select([
          'f.name',
          sql<number | null>`ST_X(ST_PointOnSurface(g.geometry))`.as('lon'),
          sql<number | null>`ST_Y(ST_PointOnSurface(g.geometry))`.as('lat'),
        ])
        .where('f.id', '=', fieldId)
        .executeTakeFirstOrThrow();
      if (field.lon == null || field.lat == null)
        throw badRequest('field_without_boundary', 'The field has no boundary');
      const { entries } = await this.rotationEntries(trx, input.rotationId);
      const forSimulation: RotationEntryForSimulation[] = entries.map((e) => ({
        position: e.position,
        cropCode: e.crop_code,
        sowingMd: e.default_sowing_md,
        harvestMd: e.default_harvest_md,
        yieldTHa: e.yieldTHa,
        fertilizers: e.inputs.filter(
          (i) =>
            i.product.category === 'fertilizer' && (i.product.nPct ?? 0) > 0,
        ),
        catchCrop: e.catch_code
          ? {
              code: e.catch_code,
              sowingMd: e.catch_sowing_md,
              harvestMd: e.catch_harvest_md,
            }
          : null,
      }));
      return {
        soil: soil.saved,
        field: { name: field.name, lon: field.lon, lat: field.lat },
        entries: forSimulation,
      };
    });
    let bodies;
    try {
      bodies = SIMULATION_INTERVALS.map((interval) =>
        createThuenenRequestBody({
          interval,
          lat: prepared.field.lat,
          lon: prepared.field.lon,
          fieldName: prepared.field.name,
          soil: prepared.soil,
          years: buildYearDataForInterval(
            prepared.entries,
            interval,
            input.startPosition,
          ),
        }),
      );
    } catch (error) {
      if (error instanceof SimulationInputError)
        throw badRequest('carbon_model_input', error.message);
      throw error;
    }
    try {
      const batch = await batchRunRothC(bodies);
      const intervals: RothCResult['intervals'] = {};
      bodies.forEach((body, i) => {
        intervals[`${body.site.start_year_v}-${body.site.end_year_v}`] = {
          input: body,
          output: batch.results[i].results,
        };
      });
      return {
        rotationId: input.rotationId,
        startPosition: input.startPosition,
        intervals,
        averaged: averageRothCResults(batch),
      };
    } catch (error) {
      if (error instanceof RothCError)
        throw new DomainError(502, 'carbon_model_failed', error.message, {
          status: error.status ?? null,
          output: error.output,
        });
      throw error;
    }
  }
}
