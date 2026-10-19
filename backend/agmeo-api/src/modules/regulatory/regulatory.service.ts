import { Injectable, Logger } from '@nestjs/common';
import {
  type AgrarantragPreset,
  type AnnualTotals,
  type ExportPreflight,
  type FederalExportFormat,
  type FederalState,
  type PreflightIssue,
  type RegulatoryCodeLists,
  type RegulatoryExportFile,
  type RegulatoryRegion,
  availableN,
  type BaseUnit,
  type FarmRegulatory,
  type FarmRegulatoryInput,
  type FertilizerType,
  type FertilizerYearStart,
  type FieldAnnualTotals,
  isOrganicFertilizer,
  type LandUseCode,
  type N170Balance,
  type N170Data,
  type N170Input,
  type NutrientGroup,
  type NutrientGroupTotals,
  nutrientKgPerHa,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { FilesService } from '../files/files.service.js';
import { type DbfField, polygonShapefile } from '../vra/export/shapefile.js';
import { zip } from '../vra/export/zip.js';
import { besydMetadata, buildExportData, endoMetadata, enniMetadata, loadDbeResults, stMetadata } from './export-data.js';
import {
  AMT_CODES,
  BESYD_BUNDESLAND_NAMES,
  BESYD_FRUCHTART_CATALOGUE,
  BODEN_KLIMA_RAUM_CODES,
  type BesydBundesland,
  buildBesydFiles,
  buildEndoXml,
  buildEnniXml,
  buildStFiles,
  cropKeyForCode,
  detectBundeslandFromBnr,
  type DuevDbeResult,
  FRUCHTART_CATALOGUE,
  FRUCHTART_CATALOGUE_SH,
  type ExportData,
  generateExportFileName,
  MINERAL_FERTILIZER_GROUP_CODES,
  ORGANIC_FERTILIZER_CODES,
  runPreflight,
  ST_KREISE,
  ST_KULTUREN,
} from './harmonie/index.js';
import { defaultReportYear, exportFormatFromFileName, formatsForState, getReportDeadline, resolveFertilizerReportRegion, uploadGuide } from './region.js';

export const REGULATORY_RULESET = 'DE-DUEV-2020-Anl5-2026.1';

const MONTHS: FertilizerYearStart[] = ['JANUAR', 'FEBRUAR', 'MAERZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'];

/** The fertilizer year (Düngejahr) `year`: the calendar year, or the twelve months ending in `year` when it starts later. */
export function fertilizerYearWindow(year: number, start: FertilizerYearStart): { from: string; to: string } {
  const m = MONTHS.indexOf(start) + 1;
  if (m === 1) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const end = new Date(Date.UTC(year, m - 1, 0)).toISOString().slice(0, 10);
  return { from: `${year - 1}-${String(m).padStart(2, '0')}-01`, to: end };
}

/** Organic fertilizers of animal origin (Wirtschaftsdünger tierischer Herkunft). */
const MANURE: FertilizerType[] = [
  'cattle_slurry',
  'pig_slurry',
  'cattle_liquid_manure',
  'pig_liquid_manure',
  'cattle_solid_manure',
  'pig_solid_manure',
  'horse_sheep_manure',
  'poultry_manure',
  'laying_hen_dry_manure',
];
export const nutrientGroupOf = (type: FertilizerType | null): NutrientGroup => (!isOrganicFertilizer(type) ? 'mineral' : MANURE.includes(type!) ? 'manure' : 'other_organic');

/** Column names and reference systems of the subsidy application portals, after AGVOLUTION/agmeo. */
const PRESETS: Record<AgrarantragPreset, { epsg: 25832 | 25833; columns: { field: string; number: string; part: string; flik: string; code: string } }> = {
  NI: { epsg: 25832, columns: { field: 'SCHLAGNAME', number: 'SCHLAG_NR', part: 'TSCHLAG_BE', flik: 'FLIK', code: 'NUTZ_CODE' } },
  NW: { epsg: 25832, columns: { field: 'SCHLAG_BEZ', number: 'SCHLAG_NR', part: 'TS_BEZ', flik: 'FELDBLOCK', code: 'NUTZUNG_CD' } },
  BW: { epsg: 25832, columns: { field: 'BEZSCHLAG', number: 'SCHLAG_NR', part: 'BEZTEILSCH', flik: 'FLIK', code: 'NUTZUNG' } },
  BY: { epsg: 25832, columns: { field: 'SCHLAGNAME', number: 'FNR', part: 'TSCHLAG', flik: 'FLIK', code: 'NUTZCODE' } },
  SN: { epsg: 25833, columns: { field: 'SCHLAG', number: 'SCHLAG_NR', part: 'TS', flik: 'FELDBLOCK', code: 'NUTZUNG' } },
  MV: { epsg: 25833, columns: { field: 'SCHLAG', number: 'SCHLAG_NR', part: 'TS', flik: 'FELDBLOCK', code: 'NUTZUNG' } },
  TH: { epsg: 25833, columns: { field: 'SCHLAG', number: 'SCHLAG_NR', part: 'TS', flik: 'FELDBLOCK', code: 'NUTZUNG' } },
};
const UTM_PRJ = (zone: 32 | 33) =>
  `PROJCS["ETRS89_UTM_zone_${zone}N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${zone === 32 ? 9 : 15}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

const emptyGroup = (): NutrientGroupTotals => ({ n: 0, availableN: 0, p2o5: 0 });

/** BESyD Land key → federal state, and back. */
const BESYD_STATE: Record<BesydBundesland, FederalState> = { '12': 'BB', '14': 'SN', '15': 'ST', '16': 'TH' };
const BESYD_LAND = Object.fromEntries(Object.entries(BESYD_STATE).map(([k, v]) => [v, k])) as Partial<Record<FederalState, BesydBundesland>>;

/** File names of archived exports: `ENNI_…`, `ENDO_…`, `BESyD_…`, `ST_…`, `agrarantrag-…`. */
const HISTORY_PREFIXES = ['ENNI\\_%', 'ENDO\\_%', 'BESyD\\_%', 'ST\\_%', 'Agrarantrag%'];

type ReportFormat = FederalExportFormat;

/**
 * Regulatory reporting: farm master data for the authorities, annual nutrient totals (DüV Anlage 5),
 * the 170 kg N limit for organic fertilizers, land-use codes and the subsidy application export.
 */
@Injectable()
export class RegulatoryService {
  private readonly logger = new Logger(RegulatoryService.name);

  constructor(
    private readonly db: Database,
    private readonly files: FilesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Farm master data
  // ---------------------------------------------------------------------------

  farmData(ctx: Ctx, farmId: string): Promise<FarmRegulatory> {
    return this.db.run(ctx, (trx) => this.loadFarm(trx, farmId));
  }

  async loadFarm(trx: Trx, farmId: string): Promise<FarmRegulatory> {
    const f = await trx
      .selectFrom('farms')
      .select(['id', 'name', 'holding_number', 'eu_holding_number', 'federal_state', 'fertilizer_year_start', 'organic_certified', 'regulatory'])
      .where('id', '=', farmId)
      .executeTakeFirst();
    if (!f) throw notFound('Farm');
    const r = (f.regulatory ?? {}) as Partial<FarmRegulatory>;
    return {
      farmId: f.id,
      farmName: f.name,
      holdingNumber: f.holding_number,
      euHoldingNumber: f.eu_holding_number,
      federalState: f.federal_state as FarmRegulatory['federalState'],
      fertilizerYearStart: f.fertilizer_year_start as FertilizerYearStart,
      organicCertified: f.organic_certified,
      enni: { nitrateZoneFlag: false, ...r.enni },
      endo: { ...r.endo },
      besyd: { ...r.besyd },
      st: { ...r.st, sitzInSt: r.st?.sitzInSt ?? true },
      contact: { ...r.contact },
      otherFertilizersApplied: r.otherFertilizersApplied ?? false,
      compostApplied: r.compostApplied ?? false,
      restrictions: r.restrictions ?? false,
    };
  }

  saveFarmData(ctx: Ctx, farmId: string, input: Out<typeof FarmRegulatoryInput>): Promise<FarmRegulatory> {
    return this.db.run(ctx, async (trx) => {
      const before = await this.loadFarm(trx, farmId);
      const { holdingNumber, euHoldingNumber, federalState, fertilizerYearStart, organicCertified, besyd, st, ...rest } = input;
      const eu = euHoldingNumber === undefined ? before.euHoldingNumber : euHoldingNumber;
      // BESyD and ST data are kept when the request leaves them out (the ENNI/ENDO form does).
      const besydData = besyd ?? before.besyd;
      const stData = st ?? before.st;
      this.validateCodes(besydData, stData, eu, federalState ?? null);
      await trx
        .updateTable('farms')
        .set({
          holding_number: holdingNumber ?? null,
          eu_holding_number: eu ?? null,
          federal_state: federalState ?? null,
          fertilizer_year_start: fertilizerYearStart,
          organic_certified: organicCertified,
          regulatory: JSON.stringify({ ...rest, besyd: besydData, st: stData }),
        })
        .where('id', '=', farmId)
        .execute();
      const after = await this.loadFarm(trx, farmId);
      await record(trx, ctx, { entityType: 'farm', entityId: farmId, action: 'updated', changes: diff(before as never, after as never), event: { type: 'farm.updated', payload: { farmId } } });
      return after;
    });
  }

  /** Boden-Klima-Raum of the farm's BESyD Land, Amt and Landkreis must be codes the authorities know. */
  private validateCodes(besyd: FarmRegulatory['besyd'], st: FarmRegulatory['st'], eu: string | null, state: FederalState | null) {
    if (besyd.bodenklimaraum) {
      const bkr = BODEN_KLIMA_RAUM_CODES.find((b) => b.code === besyd.bodenklimaraum);
      const land = (eu ? detectBundeslandFromBnr(eu) : null) ?? (state ? BESYD_LAND[state] : undefined) ?? null;
      if (!bkr) throw badRequest('unknown_bodenklimaraum', `Unknown Boden-Klima-Raum ${besyd.bodenklimaraum}`);
      if (land && !bkr.bundeslaender.includes(land))
        throw badRequest('bodenklimaraum_not_in_state', `Boden-Klima-Raum ${besyd.bodenklimaraum} is not in ${BESYD_BUNDESLAND_NAMES[land]}`);
    }
    if (besyd.amt && !Object.hasOwn(AMT_CODES, besyd.amt)) throw badRequest('unknown_amt', `Unknown Amt ${besyd.amt}`);
    if (st.kreisNr != null && !ST_KREISE.some((k) => k.nr === st.kreisNr)) throw badRequest('unknown_kreis', `Unknown Landkreis ${st.kreisNr}`);
  }

  landUseCodes(ctx: Ctx): Promise<LandUseCode[]> {
    return this.db.run(ctx, async (trx) =>
      (await trx.selectFrom('land_use_codes').select(['code', 'name_de', 'productive']).orderBy(sql`code::int`).execute()).map((r) => ({ code: r.code, name: r.name_de, productive: r.productive })),
    );
  }

  setLandUseCode(ctx: Ctx, cropCycleId: string, code: string | null): Promise<{ cropCycleId: string; landUseCode: string | null }> {
    return this.db.run(ctx, async (trx) => {
      if (code) {
        const known = await trx.selectFrom('land_use_codes').select('code').where('code', '=', code).executeTakeFirst();
        if (!known) throw badRequest('unknown_land_use_code', `Unknown land-use code ${code}`);
      }
      const res = await trx.updateTable('crop_cycles').set({ land_use_code: code }).where('id', '=', cropCycleId).executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Crop cycle');
      await record(trx, ctx, { entityType: 'crop_cycle', entityId: cropCycleId, action: 'updated', changes: { landUseCode: code } });
      return { cropCycleId, landUseCode: code };
    });
  }

  // ---------------------------------------------------------------------------
  // Annual totals (DüV Anlage 5)
  // ---------------------------------------------------------------------------

  annualTotals(ctx: Ctx, farmId: string, year: number): Promise<AnnualTotals> {
    return this.db.run(ctx, (trx) => this.computeTotals(trx, farmId, year));
  }

  /** Nutrients of the completed fertilizations in the fertilizer year, per field and for the farm. */
  async computeTotals(trx: Trx, farmId: string, year: number): Promise<AnnualTotals> {
    const farm = await this.loadFarm(trx, farmId);
    const window = fertilizerYearWindow(year, farm.fertilizerYearStart);
    const fields = await trx
      .selectFrom('fields as f')
      .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .select(['f.id', 'f.name', sql<number>`coalesce(g.area_ha, 0)`.as('area_ha')])
      .where('f.farm_id', '=', farmId)
      .where('f.status', '=', 'active')
      .orderBy('f.name')
      .execute();
    const day = sql<string>`(o.performed_at AT TIME ZONE 'Europe/Berlin')::date`;
    const lines = fields.length
      ? await trx
          .selectFrom('operations as o')
          .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
          .innerJoin('operation_inputs as oi', 'oi.operation_id', 'o.id')
          .innerJoin('products as p', 'p.id', 'oi.product_id')
          .select(['ofl.field_id', 'ofl.treated_area_ha', 'oi.rate_per_ha', 'p.base_unit', 'p.n_pct', 'p.nh4_n_pct', 'p.p2o5_pct', 'p.density_t_m3', 'p.fertilizer_type'])
          .where('o.status', '=', 'completed')
          .where('p.category', '=', 'fertilizer')
          .where('ofl.field_id', 'in', fields.map((f) => f.id))
          .where(day, '>=', window.from)
          .where(day, '<=', window.to)
          .execute()
      : [];
    // Grassland: the field's main crop in a season of the year is grassland or field forage.
    const grass = new Set(
      (
        await trx
          .selectFrom('crop_cycles as cc')
          .innerJoin('crops as c', 'c.id', 'cc.crop_id')
          .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
          .select('cc.field_id')
          .where('c.category', '=', 'grassland')
          .where('s.harvest_year', '=', year)
          .execute()
      ).map((r) => r.field_id),
    );
    const needs = await sql<{ field_id: string; need: number | null; area: number }>`
      SELECT cc.field_id, (r.result -> 'n' ->> 'need')::numeric AS need, coalesce(cc.area_ha, 1) AS area
      FROM crop_cycles cc
      JOIN growing_seasons s ON s.id = cc.season_id
      JOIN LATERAL (SELECT result FROM fertilizer_need_records WHERE crop_cycle_id = cc.id ORDER BY created_at DESC LIMIT 1) r ON true
      WHERE s.harvest_year = ${year} AND cc.role = 'main'`.execute(trx);

    let unknown = 0;
    const farmTotals: AnnualTotals['farm'] = { mineral: emptyGroup(), manure: emptyGroup(), other_organic: emptyGroup(), total: emptyGroup(), areaHa: 0 };
    const out: FieldAnnualTotals[] = fields.map((f) => {
      const kg: Record<NutrientGroup, NutrientGroupTotals> = { mineral: emptyGroup(), manure: emptyGroup(), other_organic: emptyGroup() };
      for (const l of lines.filter((x) => x.field_id === f.id)) {
        const type = l.fertilizer_type as FertilizerType | null;
        const n = nutrientKgPerHa({ nPct: l.n_pct, nh4NPct: l.nh4_n_pct, p2o5Pct: l.p2o5_pct, densityTM3: l.density_t_m3, fertilizerType: type }, l.rate_per_ha ?? 0, l.base_unit as BaseUnit);
        if (n.n == null && n.p2o5 == null) {
          unknown += 1;
          continue;
        }
        const g = kg[nutrientGroupOf(type)];
        g.n += (n.n ?? 0) * l.treated_area_ha;
        g.availableN += (availableN(type, n.n, n.nh4N, isOrganicFertilizer(type)) ?? 0) * l.treated_area_ha;
        g.p2o5 += (n.p2o5 ?? 0) * l.treated_area_ha;
      }
      const ha = f.area_ha || 1;
      const perHa = Object.fromEntries(
        (Object.keys(kg) as NutrientGroup[]).map((k) => [k, { n: round(kg[k].n / ha, 1), availableN: round(kg[k].availableN / ha, 1), p2o5: round(kg[k].p2o5 / ha, 1) }]),
      ) as Record<NutrientGroup, NutrientGroupTotals>;
      for (const k of Object.keys(kg) as NutrientGroup[]) {
        farmTotals[k].n += kg[k].n;
        farmTotals[k].availableN += kg[k].availableN;
        farmTotals[k].p2o5 += kg[k].p2o5;
      }
      farmTotals.areaHa += f.area_ha;
      const own = needs.rows.filter((r) => r.field_id === f.id && r.need != null);
      const area = own.reduce((s, r) => s + Number(r.area), 0);
      return {
        fieldId: f.id,
        fieldName: f.name,
        areaHa: f.area_ha,
        grassland: grass.has(f.id),
        perHa,
        total: {
          n: round(perHa.mineral.n + perHa.manure.n + perHa.other_organic.n, 1),
          availableN: round(perHa.mineral.availableN + perHa.manure.availableN + perHa.other_organic.availableN, 1),
          p2o5: round(perHa.mineral.p2o5 + perHa.manure.p2o5 + perHa.other_organic.p2o5, 1),
        },
        nNeed: own.length ? round(own.reduce((s, r) => s + Number(r.need) * Number(r.area), 0) / area, 1) : null,
      };
    });
    for (const k of ['mineral', 'manure', 'other_organic'] as NutrientGroup[]) {
      farmTotals[k] = { n: round(farmTotals[k].n), availableN: round(farmTotals[k].availableN), p2o5: round(farmTotals[k].p2o5) };
      farmTotals.total.n += farmTotals[k].n;
      farmTotals.total.availableN += farmTotals[k].availableN;
      farmTotals.total.p2o5 += farmTotals[k].p2o5;
    }
    farmTotals.total = { n: round(farmTotals.total.n), availableN: round(farmTotals.total.availableN), p2o5: round(farmTotals.total.p2o5) };
    farmTotals.areaHa = round(farmTotals.areaHa, 4);
    return { farmId, year, window, fields: out, farm: farmTotals, unknownApplications: unknown };
  }

  // ---------------------------------------------------------------------------
  // 170 kg N/ha from organic fertilizers (DüV §6 Abs. 4)
  // ---------------------------------------------------------------------------

  n170(ctx: Ctx, farmId: string, year: number): Promise<N170Balance> {
    return this.db.run(ctx, (trx) => this.computeN170(trx, farmId, year));
  }

  saveN170(ctx: Ctx, input: Out<typeof N170Input>): Promise<N170Balance> {
    return this.db.run(ctx, async (trx) => {
      await this.loadFarm(trx, input.farmId);
      const { farmId, year, ...data } = input;
      await trx
        .insertInto('n170_inputs')
        .values({ organization_id: ctx.orgId, farm_id: farmId, year, data: JSON.stringify(data) })
        .onConflict((oc) => oc.columns(['farm_id', 'year']).doUpdateSet({ data: JSON.stringify(data) }))
        .execute();
      await record(trx, ctx, { entityType: 'farm', entityId: farmId, action: 'n170_updated', changes: { year, livestock: data.livestock.length, intake: data.intake.length, delivery: data.delivery.length } });
      return this.computeN170(trx, farmId, year);
    });
  }

  async computeN170(trx: Trx, farmId: string, year: number): Promise<N170Balance> {
    const totals = await this.computeTotals(trx, farmId, year);
    const row = await trx.selectFrom('n170_inputs').select('data').where('farm_id', '=', farmId).where('year', '=', year).executeTakeFirst();
    const data: N170Data = { livestock: [], intake: [], delivery: [], onFarmBiogasPlant: false, farmId, year, ...((row?.data ?? {}) as Partial<N170Data>) };
    const applied = totals.farm.manure.n + totals.farm.other_organic.n;
    const livestock = data.livestock.reduce((s, l) => s + l.animals * l.nPerAnimalYear, 0);
    const intake = data.intake.reduce((s, t) => s + t.quantity * t.nPerUnit, 0);
    const delivery = data.delivery.reduce((s, t) => s + t.quantity * t.nPerUnit, 0);
    // Whichever is higher: what the records show was applied, or what the farm's balance says it had.
    const organic = Math.max(applied, livestock + intake - delivery);
    const perHa = totals.farm.areaHa ? round(organic / totals.farm.areaHa, 1) : 0;
    return {
      farmId,
      year,
      data,
      areaHa: totals.farm.areaHa,
      appliedOrganicN: round(applied),
      livestockN: round(livestock),
      intakeN: round(intake),
      deliveryN: round(delivery),
      perHa,
      limit: 170,
      exceeded: perHa > 170,
    };
  }

  // ---------------------------------------------------------------------------
  // Subsidy application (Agrarantrag)
  // ---------------------------------------------------------------------------

  /**
   * One polygon per crop (on its part field, if any) of the season with the portal's column names,
   * in ETRS89 / UTM. Fields without a crop are exported with their boundary and no code.
   */
  async agrarantragShapefile(ctx: Ctx, farmId: string, seasonId: string, preset: AgrarantragPreset): Promise<{ filename: string; body: Buffer }> {
    const file = await this.db.run(ctx, async (trx) => {
      const p = PRESETS[preset];
      if (!p) throw badRequest('unknown_preset', 'Unknown portal');
      const farm = await this.loadFarm(trx, farmId);
      const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year']).where('id', '=', seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const { rows } = await sql<{ field_name: string; identifier: string | null; part_name: string | null; crop: string | null; code: string | null; area_ha: number; geometry: string }>`
        SELECT f.name AS field_name, f.identifier, fp.name AS part_name, coalesce(c.name_de, c.name) AS crop,
               coalesce(cc.land_use_code, c.land_use_code) AS code,
               coalesce(cc.area_ha, fp.area_ha, g.area_ha) AS area_ha,
               ST_AsGeoJSON(ST_Transform(coalesce(fp.geometry, g.geometry), ${p.epsg}::int), 3) AS geometry
        FROM fields f
        JOIN field_current_geometry g ON g.field_id = f.id
        LEFT JOIN crop_cycles cc ON cc.field_id = f.id AND cc.season_id = ${season.id} AND cc.role = 'main'
        LEFT JOIN crops c ON c.id = cc.crop_id
        LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
        WHERE f.farm_id = ${farmId} AND f.status = 'active'
        ORDER BY f.name, fp.sort_order NULLS FIRST`.execute(trx);
      const c = p.columns;
      const fields: DbfField[] = [
        { name: c.field, length: 60, decimals: 0, type: 'C' },
        { name: c.number, length: 20, decimals: 0, type: 'C' },
        { name: c.part, length: 30, decimals: 0, type: 'C' },
        { name: c.flik, length: 20, decimals: 0, type: 'C' },
        { name: c.code, length: 5, decimals: 0, type: 'C' },
        { name: 'KULTUR', length: 60, decimals: 0, type: 'C' },
        { name: 'AREA_HA', length: 12, decimals: 4 },
      ];
      const shape = polygonShapefile(
        fields,
        rows.map((r) => {
          const geometry = JSON.parse(r.geometry) as MultiPolygon | { type: 'Polygon'; coordinates: MultiPolygon['coordinates'][number] };
          return {
            geometry: geometry.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [geometry.coordinates] } : geometry,
            values: {
              [c.field]: r.field_name,
              [c.number]: r.identifier,
              [c.part]: r.part_name,
              [c.flik]: r.identifier,
              [c.code]: r.code,
              KULTUR: r.crop,
              AREA_HA: round(r.area_ha, 4),
            },
          };
        }),
        new Date(),
        UTM_PRJ(p.epsg === 25832 ? 32 : 33),
      );
      const stem = `agrarantrag-${preset}-${season.harvest_year}-${(farm.holdingNumber ?? farm.farmName).replace(/[^A-Za-z0-9]+/g, '-')}`;
      await record(trx, ctx, { entityType: 'farm', entityId: farmId, action: 'agrarantrag_exported', changes: { preset, harvestYear: season.harvest_year, parcels: rows.length } });
      return {
        filename: `${stem}.zip`,
        year: season.harvest_year,
        body: zip([
          { name: `${stem}.shp`, data: shape.shp },
          { name: `${stem}.shx`, data: shape.shx },
          { name: `${stem}.dbf`, data: shape.dbf },
          { name: `${stem}.prj`, data: shape.prj },
          { name: `${stem}.cpg`, data: shape.cpg },
        ]),
      };
    });
    await this.archive(ctx, file.filename, 'application/zip', file.body, file.year);
    return { filename: file.filename, body: file.body };
  }

  // ---------------------------------------------------------------------------
  // Fertilization records for the authorities (ENNI Niedersachsen, ENDO Schleswig-Holstein,
  // webBESyD BB/SN/ST/TH, Sachsen-Anhalt Mitteilungspflicht)
  // ---------------------------------------------------------------------------

  preflight(ctx: Ctx, format: ReportFormat, farmId: string, year: number): Promise<ExportPreflight> {
    return this.db.run(ctx, async (trx) => (await this.prepare(trx, ctx, format, farmId, year)).preflight);
  }

  /** The XML file; refused while the preflight has blocking findings. Archived in Files (exports). */
  async exportXml(ctx: Ctx, format: 'enni' | 'endo', farmId: string, year: number): Promise<{ filename: string; xml: string }> {
    const file = await this.db.run(ctx, async (trx) => {
      const { preflight, data, farm } = await this.prepare(trx, ctx, format, farmId, year);
      this.assertReady(preflight);
      const xml = format === 'enni' ? buildEnniXml(data, enniMetadata(farm)) : buildEndoXml(data, endoMetadata(farm));
      await record(trx, ctx, { entityType: 'farm', entityId: farmId, action: `${format}_exported`, changes: { year, fields: data.fields.length, ruleset: REGULATORY_RULESET } });
      return { filename: preflight.fileName, xml };
    });
    await this.archive(ctx, file.filename, 'application/xml', Buffer.from(file.xml, 'utf8'), year);
    return file;
  }

  /**
   * webBESyD (eleven IMP*.TXT) or Sachsen-Anhalt (DBE, Duengungen, Anl5, Ertraege) as a ZIP; refused
   * while the preflight has blocking findings. Archived in Files (exports).
   */
  async exportZip(ctx: Ctx, format: 'besyd' | 'st', farmId: string, year: number): Promise<{ filename: string; body: Buffer }> {
    const file = await this.db.run(ctx, async (trx) => {
      const { preflight, data, farm, dbe } = await this.prepare(trx, ctx, format, farmId, year);
      this.assertReady(preflight);
      const files = format === 'besyd' ? buildBesydFiles(data, besydMetadata(farm)) : buildStFiles(data, stMetadata(farm), dbe);
      await record(trx, ctx, { entityType: 'farm', entityId: farmId, action: `${format}_exported`, changes: { year, fields: data.fields.length, files: Object.keys(files).length, ruleset: REGULATORY_RULESET } });
      return { filename: preflight.fileName, body: zip(Object.entries(files).map(([name, content]) => ({ name, data: Buffer.from(content, 'utf8') }))) };
    });
    await this.archive(ctx, file.filename, 'application/zip', file.body, year);
    return file;
  }

  private assertReady(preflight: ExportPreflight) {
    if (!preflight.ready) throw badRequest('export_blocked', 'Resolve the blocking findings before exporting', preflight.issues.filter((i) => i.severity === 'blocking'));
  }

  /** Keeps a copy of a downloaded export in the organization's Files; a storage failure never costs the download. */
  private async archive(ctx: Ctx, name: string, mimeType: string, body: Buffer, year: number | null) {
    try {
      await this.files.storeGenerated(ctx, 'exports', name, mimeType, body, year);
    } catch (e) {
      this.logger.error(`Archiving export ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async prepare(trx: Trx, ctx: Ctx, format: ReportFormat, farmId: string, year: number) {
    const farm = await this.loadFarm(trx, farmId);
    const region = await this.detectRegion(trx, farm);
    const n170 = (await this.computeN170(trx, farmId, year)).data;
    // BESyD and the LLG report the calendar year (Erntejahr), whatever the farm's Düngejahr.
    const calendarYear = format === 'besyd' || format === 'st';
    const data = await buildExportData(trx, ctx.orgId, farm, year, n170, { duengejahrbeginn: calendarYear ? 'JANUAR' : undefined, federalState: region.federalState });
    const dbe: Record<string, DuevDbeResult> = format === 'st' ? await loadDbeResults(trx, cultivationIds(data)) : {};
    const result =
      format === 'enni'
        ? runPreflight('enni', data, enniMetadata(farm))
        : format === 'endo'
          ? runPreflight('endo', data, endoMetadata(farm))
          : format === 'besyd'
            ? runPreflight('besyd', data, besydMetadata(farm))
            : runPreflight('st', data, stMetadata(farm), new Set(Object.keys(dbe)));
    const issues: PreflightIssue[] = [];
    for (const m of result.missingFields) issues.push({ code: `missing.${m.key}`, severity: 'blocking', scope: 'farm', message: `Missing: ${m.label}` });
    // Findings name crops by the library's keys; show the farm's crop names instead.
    const cropNames = new Map(
      (await trx.selectFrom('crops').select(['code', sql<string>`coalesce(name_de, name)`.as('name')]).execute()).map((c) => [cropKeyForCode(c.code) ?? c.code, c.name]),
    );
    for (const m of result.missingCropMappings)
      issues.push({
        code: 'missing_crop_mapping',
        severity: 'blocking',
        scope: 'crop',
        // cropKey is the key a crop code override is stored under.
        params: { crop: cropNames.get(m.cropName) ?? m.cropName, cropKey: m.cropName, count: m.cultivationCount },
        message: `No authority crop code for ${cropNames.get(m.cropName) ?? m.cropName}`,
      });
    for (const i of result.issues) {
      if (typeof i.params?.crop === 'string') i.params.crop = cropNames.get(i.params.crop) ?? i.params.crop;
      issues.push({
        code: i.code,
        severity: i.severity,
        scope: i.scope === 'betrieb' ? 'farm' : i.scope === 'cultivation' ? 'crop' : i.scope,
        fieldName: i.fieldName,
        params: { ...i.params, ...(i.value ? { value: i.value } : {}) },
        message: [i.code, i.value].filter(Boolean).join(': '),
      });
    }
    const number = calendarYear ? (farm.euHoldingNumber ?? 'unknown') : (farm.holdingNumber ?? '000000000000000');
    const preflight: ExportPreflight = {
      format,
      farmId,
      year,
      ready: !issues.some((i) => i.severity === 'blocking'),
      issues,
      fileName: generateExportFileName(format, number, year),
    };
    return { preflight, data, farm, dbe };
  }

  // ---------------------------------------------------------------------------
  // Region, formats and deadlines; export history; code lists
  // ---------------------------------------------------------------------------

  /** Stored farm state, else the majority of the active fields' FLIK prefixes (from 50 % coverage). */
  private async detectRegion(trx: Trx, farm: FarmRegulatory) {
    const fields = await trx.selectFrom('fields').select('identifier').where('farm_id', '=', farm.farmId).where('status', '=', 'active').execute();
    return resolveFertilizerReportRegion(farm.federalState ?? null, fields.map((f) => f.identifier));
  }

  region(ctx: Ctx, farmId: string, year?: number): Promise<RegulatoryRegion> {
    return this.db.run(ctx, async (trx) => {
      const farm = await this.loadFarm(trx, farmId);
      const region = await this.detectRegion(trx, farm);
      const reportYear = year ?? defaultReportYear();
      return {
        farmId,
        year: reportYear,
        federalState: region.federalState,
        source: region.source,
        flikCoverage: round(region.flikCoverage, 3),
        formats: formatsForState(region.federalState).map((format) => ({
          format,
          deadline: getReportDeadline(format, reportYear)?.toISOString() ?? null,
          upload: uploadGuide(format, region.federalState),
        })),
      };
    });
  }

  /** Archived exports of the year in the Files system folder "exports", newest first. */
  exportHistory(ctx: Ctx, year: number): Promise<RegulatoryExportFile[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('files as f')
        .innerJoin('file_folders as d', 'd.id', 'f.folder_id')
        .select(['f.id', 'f.name', 'f.size_bytes', 'f.created_at'])
        .where('d.system_key', '=', 'exports')
        .where('d.deleted_at', 'is', null)
        .where('f.deleted_at', 'is', null)
        .where('f.year', '=', year)
        .where((eb) => eb.or(HISTORY_PREFIXES.map((p) => eb('f.name', 'ilike', p))))
        .orderBy('f.created_at', 'desc')
        .orderBy('f.id', 'desc')
        .limit(50)
        .execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        format: exportFormatFromFileName(r.name),
        sizeBytes: Number(r.size_bytes),
        createdAt: new Date(r.created_at as unknown as string).toISOString(),
      }));
    });
  }

  /** Authority code lists for the farm data and crop code overrides of a format (ENNI/ENDO: the Fruchtart catalogue only). */
  codeLists(format: FederalExportFormat, state?: FederalState): RegulatoryCodeLists {
    const land = state ? BESYD_LAND[state] : undefined;
    if (format === 'enni' || format === 'endo') {
      // ENDO-SH has its own Stammdaten; the ENNI codes are not accepted there.
      const crops =
        format === 'enni'
          ? FRUCHTART_CATALOGUE.map((f) => ({ code: f.code, name: f.bezeichnung, category: '' }))
          : FRUCHTART_CATALOGUE_SH.map((f) => ({ code: f.code, name: f.bezeichnung, category: f.gruppe }));
      return {
        format,
        bodenklimaraum: [],
        amt: [],
        kreise: [],
        crops,
        organicFertilizers: [],
        mineralFertilizerGroups: [],
      };
    }
    if (format === 'st') {
      return {
        format,
        bodenklimaraum: [],
        amt: [],
        kreise: ST_KREISE.map((k) => ({ ...k })),
        crops: ST_KULTUREN.map((k) => ({ code: k.code, name: k.bezeichnung, category: k.einteilung })),
        organicFertilizers: [],
        mineralFertilizerGroups: [],
      };
    }
    return {
      format,
      bodenklimaraum: BODEN_KLIMA_RAUM_CODES.filter((b) => !state || (land != null && b.bundeslaender.includes(land))).map((b) => ({
        code: b.code,
        name: b.name,
        states: b.bundeslaender.map((l) => BESYD_STATE[l]),
      })),
      amt: Object.entries(AMT_CODES).map(([code, name]) => ({ code, name })),
      kreise: [],
      crops: BESYD_FRUCHTART_CATALOGUE.map((f) => ({ code: f.code, name: f.bezeichnung, category: f.category })),
      organicFertilizers: ORGANIC_FERTILIZER_CODES.map((o) => ({ code: o.code, name: o.name })),
      mineralFertilizerGroups: Object.entries(MINERAL_FERTILIZER_GROUP_CODES).map(([code, name]) => ({ code, name })),
    };
  }
}

const cultivationIds = (data: ExportData) => data.fields.flatMap((f) => f.cultivations.map((c) => c.cultivationId));
