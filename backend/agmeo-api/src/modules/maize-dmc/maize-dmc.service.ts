/**
 * Maize dry-matter monitoring (reference app/[orgId]/maize-dmc, api/[orgId]/fields/[id]/[year]/dmc*,
 * actions/maizeDmc.ts): which maize crops of a harvest year can be forecast, today's forecast per
 * crop cycle from maize-dmc-api with same-day reuse and the plausibility guard, the raster
 * proxy, FAO maturity settings, DM measurements and variety offsets.
 *
 * The service call (5–30 s) never runs inside a database transaction: inputs are read in one
 * transaction, the run is stored in another.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  ApplyDmcOffsetInput,
  CreateDmcMeasurementInput,
  DmcCycleRow,
  DmcForecast,
  DmcHarvestDetected,
  DmcHarvestEvaluation,
  DmcMaizeKind,
  DmcMeasurement,
  DmcMeasurementSource,
  DmcMissingInput,
  DmcOffsetBasis,
  DmcOffsetBasisPoint,
  DmcOffsetBatch,
  DmcOffsetVariety,
  DmcOverview,
  DmcResolution,
  DmcRunMode,
  RevokeDmcOffsetsInput,
  UpdateDmcMeasurementInput,
  UpdateDmcSettingsInput,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { MultiPolygon } from 'geojson';
import type { Ctx } from '../../auth/context.js';
import { config } from '../../config.js';
import { DomainError, badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { FAO_MAX, FAO_MIN, groupOffsetBatches, meanOffset, modelMedianNearest, resolveCalibration, type ResolvedCalibration } from './calibration.js';
import { MaizeDmcClient, notConfigured, upstreamError, type MaizeDmcResult } from './client.js';
import { bbox3857ToBounds, calibrationApplied, denormOf, harvestWindowOf, mapDailyPredictions, storedDays, storedValueOn, todayUTC, type StoredPredictions } from './forecast.js';
import { detectionOverridesStatus, type RecentStandingScene } from './harvest-detection.js';
import { evaluateHarvest, HARVEST_PERSISTENCE_DAYS, type HarvestDetectedSummary, probabilityForDay } from './harvest-probability.js';
import { assessRunPlausibility } from './plausibility.js';
import type { PredictBody, PredictResponse, ResultBand, ResultOutput } from './types.js';
import { addDaysUTC, buildWeatherBlock, DMC_FORECAST_HORIZON_DAYS, type StoredWeatherDay } from './weather-block.js';

/** A maize crop cycle with everything a forecast needs. */
interface CycleRow {
  id: string;
  field_id: string;
  field_name: string;
  part_name: string | null;
  crop_code: string;
  crop_name: string;
  variety_id: string | null;
  variety_name: string | null;
  harvest_year: number;
  area_ha: number | null;
  planned_sowing: string | null;
  booked_sowing: string | null;
  reported_harvest: string | null;
  cycle_fao: number | null;
  variety_fao: number | null;
  geometry: MultiPolygon | null;
  cell_lat: string | null;
  cell_lng: string | null;
}

interface RunRow extends StoredPredictions {
  id: string;
  crop_cycle_id: string;
  run_date: string;
  mode: DmcRunMode;
  resolution: DmcResolution;
  calibration_hash: string | null;
  execution_id: string;
  model_version: string | null;
  sowing_date: string | null;
  fao_maturity: number | null;
  accumulated_gdd: number | null;
  response: PredictResponse;
  created_at: Date;
}

interface Prepared {
  cycle: CycleRow;
  kind: DmcMaizeKind;
  sowingDate: string;
  faoMaturity: number;
  calibration: ResolvedCalibration | null;
  body: PredictBody;
}

const kindOf = (cropCode: string): DmcMaizeKind => (cropCode === 'grain_maize' ? 'grain' : 'silage');
const sowingOf = (c: Pick<CycleRow, 'booked_sowing' | 'planned_sowing'>) => c.booked_sowing ?? c.planned_sowing;
const faoOf = (c: Pick<CycleRow, 'cycle_fao' | 'variety_fao'>) => c.cycle_fao ?? c.variety_fao;
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function missingInputs(c: CycleRow, today: string): DmcMissingInput[] {
  const missing: DmcMissingInput[] = [];
  const sowing = sowingOf(c);
  if (!sowing) missing.push('sowing_date');
  else if (sowing > today) missing.push('sowing_in_future');
  const fao = faoOf(c);
  if (fao == null || fao < FAO_MIN || fao > FAO_MAX) missing.push('fao_maturity');
  return missing;
}

const detectionSummary = (d: { status: string; trust: string; window_start: string; window_end: string; confirmed_at: Date | string | null } | undefined): DmcHarvestDetected | null =>
  d
    ? {
        status: d.status as DmcHarvestDetected['status'],
        trust: d.trust as DmcHarvestDetected['trust'],
        windowStart: d.window_start,
        windowEnd: d.window_end,
        confirmedAt: d.confirmed_at ? new Date(d.confirmed_at).toISOString().slice(0, 10) : null,
      }
    : null;

/** Harvest probability of each previous run day (newest first), for the persistence rule. */
function previousProbabilities(runs: readonly RunRow[], mode: DmcRunMode, before: string): number[] {
  const byDay = new Map<string, RunRow>();
  for (const r of runs) {
    if (r.mode !== mode || r.run_date >= before || byDay.has(r.run_date)) continue;
    byDay.set(r.run_date, r);
  }
  return [...byDay.values()]
    .sort((a, b) => b.run_date.localeCompare(a.run_date))
    .slice(0, HARVEST_PERSISTENCE_DAYS - 1)
    .flatMap((r) => {
      const p = probabilityForDay(storedDays(r), r.run_date);
      return p == null ? [] : [p];
    });
}

function evaluation(
  daily: readonly { date: string; median: number; q5: number; q95: number }[],
  today: string,
  opts: { detection: DmcHarvestDetected | null; previous: number[]; standing: RecentStandingScene | null },
): DmcHarvestEvaluation | null {
  const e = evaluateHarvest([...daily], today, {
    detection: opts.detection as HarvestDetectedSummary | null,
    previousProbabilities: opts.previous,
    recentStandingScene: opts.standing,
  });
  return e ? { probability: e.harvestProbability, status: e.harvestStatus, confidence: e.confidence, evaluatedFor: today } : null;
}

@Injectable()
export class MaizeDmcService {
  private readonly logger = new Logger('MaizeDmcService');

  constructor(
    private readonly db: Database,
    private readonly client: MaizeDmcClient,
  ) {}

  get configured() {
    return this.client.configured;
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  overview(ctx: Ctx, harvestYear: number): Promise<DmcOverview> {
    const today = todayUTC();
    return this.db.run(ctx, async (trx) => {
      const cycles = await this.cycles(trx, { harvestYear });
      const ids = cycles.map((c) => c.id);
      if (!ids.length) return { configured: this.configured, harvestYear, today, cycles: [] };
      const windowStart = addDaysUTC(today, -(DMC_FORECAST_HORIZON_DAYS + HARVEST_PERSISTENCE_DAYS));
      const [runs, detections, standing, measurements, offsets] = await Promise.all([
        trx
          .selectFrom('maize_dmc_runs')
          .select(['id', 'crop_cycle_id', 'run_date', 'mode', 'resolution', 'execution_id', 'pred_from_date', 'pred_medians', 'pred_p10', 'pred_p90', 'created_at'])
          .where('crop_cycle_id', 'in', ids)
          .where('run_date', '>=', windowStart)
          .orderBy('run_date', 'desc')
          .orderBy(sql`(mode = 'calibrated')`, 'desc')
          .orderBy('created_at', 'desc')
          .execute(),
        trx.selectFrom('maize_dmc_harvest_detections').selectAll().where('crop_cycle_id', 'in', ids).execute(),
        trx.selectFrom('maize_dmc_satellite_status').selectAll().where('crop_cycle_id', 'in', ids).execute(),
        trx
          .selectFrom('maize_dmc_calibrations')
          .select(['id', 'crop_cycle_id', 'measurement_date', 'measured_dm', 'dm_offset'])
          .where('crop_cycle_id', 'in', ids)
          .where('superseded_at', 'is', null)
          .orderBy('measurement_date', 'desc')
          .orderBy('created_at', 'desc')
          .execute(),
        trx.selectFrom('maize_dmc_variety_offsets').select(['variety_id', 'dm_offset']).where('harvest_year', '=', harvestYear).where('superseded_at', 'is', null).execute(),
      ]);
      const offsetByVariety = new Map(offsets.map((o) => [o.variety_id, o.dm_offset]));

      const rows = cycles.map((c): DmcCycleRow => {
        const kind = kindOf(c.crop_code);
        const cycleRuns = runs.filter((r) => r.crop_cycle_id === c.id) as unknown as RunRow[];
        // Newest run whose window still covers today; a same-day tie prefers the calibrated one.
        const latest = cycleRuns.find((r) => r.run_date >= addDaysUTC(today, -DMC_FORECAST_HORIZON_DAYS)) ?? null;
        const todayValue = latest ? storedValueOn(latest, today) : null;
        const inAWeek = latest ? storedValueOn(latest, addDaysUTC(today, DMC_FORECAST_HORIZON_DAYS)) : null;
        const detection = detectionSummary(detections.find((d) => d.crop_cycle_id === c.id));
        const scene = standing.find((s) => s.crop_cycle_id === c.id);
        const measurement = measurements.find((m) => m.crop_cycle_id === c.id);
        let harvest: DmcHarvestEvaluation | null = null;
        if (kind === 'silage') {
          if (detectionOverridesStatus(detection)) harvest = { probability: 1, status: 'harvested', confidence: 1, evaluatedFor: today };
          else if (latest && todayValue)
            harvest = evaluation([{ date: today, ...todayValue }], today, {
              detection,
              previous: previousProbabilities(cycleRuns, latest.mode, today),
              standing: scene ? { date: scene.latest_clear_date, ndvi: scene.latest_clear_ndvi } : null,
            });
        }
        return {
          cropCycleId: c.id,
          fieldId: c.field_id,
          fieldName: c.field_name,
          fieldPartName: c.part_name,
          cropName: c.crop_name,
          kind,
          varietyId: c.variety_id,
          varietyName: c.variety_name,
          areaHa: c.area_ha,
          sowingDate: sowingOf(c),
          sowingSource: c.booked_sowing ? 'booked' : c.planned_sowing ? 'planned' : null,
          faoMaturity: faoOf(c),
          faoSource: c.cycle_fao != null ? 'cycle' : c.variety_fao != null ? 'variety' : null,
          missing: missingInputs(c, today),
          latestRun: latest ? { runDate: latest.run_date, mode: latest.mode, resolution: latest.resolution, executionId: latest.execution_id } : null,
          dmToday: todayValue?.median ?? null,
          dmP10: todayValue?.q5 ?? null,
          dmP90: todayValue?.q95 ?? null,
          dm7d: inAWeek?.median ?? null,
          harvest,
          harvestWindow: kind === 'silage' && latest ? harvestWindowOf(storedDays(latest).filter((d) => d.date >= today)) : null,
          harvestDetected: detection,
          reportedHarvestDate: c.reported_harvest,
          latestMeasurement: measurement ? { id: measurement.id, date: measurement.measurement_date, measuredDm: measurement.measured_dm, offset: measurement.dm_offset } : null,
          varietyOffset: c.variety_id ? (offsetByVariety.get(c.variety_id) ?? null) : null,
        };
      });
      return { configured: this.configured, harvestYear, today, cycles: rows };
    });
  }

  // ---------------------------------------------------------------------------
  // Forecast
  // ---------------------------------------------------------------------------

  /**
   * Today's forecast of a crop cycle, calibrated when a measurement or variety offset exists.
   * A calibrated request also keeps today's standard run fresh (measurement offsets and the
   * harvest detection's DM gate read it); that baseline is best-effort.
   */
  async forecast(ctx: Ctx, cropCycleId: string, resolution: DmcResolution = '10m'): Promise<DmcForecast> {
    if (!this.configured) throw notConfigured();
    const today = todayUTC();
    const prep = await this.db.run(ctx, (trx) => this.prepare(trx, cropCycleId, resolution, today));
    if (prep.calibration) {
      try {
        await this.getOrCreateRun(ctx, prep, 'standard', null, today);
      } catch (e) {
        this.logger.warn(`standard baseline for cycle ${cropCycleId} failed (non-fatal): ${(e as Error).message}`);
      }
    }
    const { run, cached } = await this.getOrCreateRun(ctx, prep, prep.calibration ? 'calibrated' : 'standard', prep.calibration, today);
    return this.db.run(ctx, async (trx) => {
      const [detectionRow, scene, history] = await Promise.all([
        trx.selectFrom('maize_dmc_harvest_detections').selectAll().where('crop_cycle_id', '=', cropCycleId).executeTakeFirst(),
        trx.selectFrom('maize_dmc_satellite_status').selectAll().where('crop_cycle_id', '=', cropCycleId).executeTakeFirst(),
        this.recentRuns(trx, cropCycleId, today),
      ]);
      const api = run.response;
      const daily = mapDailyPredictions(api, ctx.orgId, run.resolution);
      const detection = detectionSummary(detectionRow);
      return {
        cropCycleId,
        fieldId: prep.cycle.field_id,
        executionId: run.execution_id,
        createdAt: iso(run.created_at)!,
        runDate: run.run_date,
        cached,
        mode: run.mode,
        resolution: run.resolution,
        modelVersion: run.model_version,
        kind: prep.kind,
        sowingDate: prep.sowingDate,
        faoMaturity: prep.faoMaturity,
        bounds: bbox3857ToBounds(api.field?.bounding_box_epsg_3857),
        calibration: run.mode === 'calibrated' ? calibrationApplied(api, prep.calibration) : null,
        dailyPredictions: daily,
        weather: api.weather
          ? { daysTotal: api.weather.days_total, daysSupplied: api.weather.days_supplied, daysFetched: api.weather.days_fetched, daysFallback: api.weather.days_fallback }
          : null,
        harvest:
          prep.kind === 'silage'
            ? evaluation(daily, today, {
                detection,
                previous: previousProbabilities(history, run.mode, today),
                standing: scene ? { date: scene.latest_clear_date, ndvi: scene.latest_clear_ndvi } : null,
              })
            : null,
        harvestDetected: detection,
        harvestWindow: prep.kind === 'silage' ? harvestWindowOf(daily.filter((d) => d.date >= today)) : null,
      };
    });
  }

  /** One day's raster of a run of this organization, from maize-dmc-api. */
  async result(ctx: Ctx, executionId: string, date: string, opts: { output: ResultOutput; band: ResultBand; resolution?: DmcResolution }): Promise<MaizeDmcResult> {
    if (!this.configured) throw notConfigured();
    const run = await this.db.run(ctx, (trx) => trx.selectFrom('maize_dmc_runs').select(['resolution']).where('execution_id', '=', executionId).executeTakeFirst());
    if (!run) throw notFound('Forecast run');
    try {
      return await this.client.result({ executionId, date, output: opts.output, band: opts.band, resolution: opts.resolution ?? (run.resolution as DmcResolution) });
    } catch (e) {
      throw upstreamError(e);
    }
  }

  /** Inputs of a forecast; 422 `dmc_missing_input` names what is missing. */
  private async prepare(trx: Trx, cropCycleId: string, resolution: DmcResolution, today: string): Promise<Prepared> {
    const [cycle] = await this.cycles(trx, { cropCycleId });
    if (!cycle) throw notFound('Maize crop');
    const missing = missingInputs(cycle, today);
    if (missing.length || !cycle.geometry) {
      throw new DomainError(422, 'dmc_missing_input', `The crop cannot be forecast yet: ${missing.join(', ') || 'no boundary'}`, { missing });
    }
    const sowingDate = sowingOf(cycle)!;
    const faoMaturity = faoOf(cycle)!;
    const calibration = await this.calibrationFor(trx, cycle);
    const weather = config.maizeDmc.supplyWeather ? await this.weatherBlock(trx, cycle, sowingDate, today) : null;
    return {
      cycle,
      kind: kindOf(cycle.crop_code),
      sowingDate,
      faoMaturity,
      calibration,
      body: { geometry: cycle.geometry, sowing_date: sowingDate, fao_maturity: faoMaturity, resolution, ...(weather ? { weather } : {}) },
    };
  }

  private async calibrationFor(trx: Trx, cycle: CycleRow): Promise<ResolvedCalibration | null> {
    const [measurement, varietyOffset] = await Promise.all([
      trx
        .selectFrom('maize_dmc_calibrations')
        .select(['id', 'measurement_date', 'measured_dm'])
        .where('crop_cycle_id', '=', cycle.id)
        .where('superseded_at', 'is', null)
        .orderBy('measurement_date', 'desc')
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
      cycle.variety_id
        ? trx
            .selectFrom('maize_dmc_variety_offsets')
            .select(['id', 'variety_id', 'dm_offset'])
            .where('variety_id', '=', cycle.variety_id)
            .where('harvest_year', '=', cycle.harvest_year)
            .where('superseded_at', 'is', null)
            .executeTakeFirst()
        : undefined,
    ]);
    return resolveCalibration({
      cropCycleId: cycle.id,
      harvestYear: cycle.harvest_year,
      measurement: measurement ? { id: measurement.id, measurementDate: measurement.measurement_date, measuredDm: measurement.measured_dm } : null,
      varietyOffset: varietyOffset ? { id: varietyOffset.id, varietyId: varietyOffset.variety_id, offset: varietyOffset.dm_offset } : null,
    });
  }

  /** Stored daily weather of the cycle's grid cell, sowing … today + 7. */
  private async weatherBlock(trx: Trx, cycle: CycleRow, sowingDate: string, today: string) {
    if (cycle.cell_lat == null || cycle.cell_lng == null) return null;
    const lat = Number(cycle.cell_lat);
    const lng = Number(cycle.cell_lng);
    const [days, cell] = await Promise.all([
      trx
        .selectFrom('weather_daily')
        .select(['date', 'temp_mean', 'temp_min', 'temp_max', 'precipitation'])
        .where('lat', '=', lat)
        .where('lng', '=', lng)
        .where('date', '>=', sowingDate)
        .where('date', '<=', addDaysUTC(today, DMC_FORECAST_HORIZON_DAYS))
        .execute(),
      trx.selectFrom('weather_cells').select('refreshed_at').where('lat', '=', lat).where('lng', '=', lng).executeTakeFirst(),
    ]);
    const series: Record<string, StoredWeatherDay> = {};
    for (const d of days) {
      const mean = d.temp_mean ?? (d.temp_min != null && d.temp_max != null ? (d.temp_min + d.temp_max) / 2 : null);
      series[d.date] = { tempMean: mean, precipitation: d.precipitation };
    }
    return buildWeatherBlock({ series, lastUpdated: cell?.refreshed_at ?? null, sowingDate, today });
  }

  private async recentRuns(trx: Trx, cropCycleId: string, before: string): Promise<RunRow[]> {
    return (await trx
      .selectFrom('maize_dmc_runs')
      .selectAll()
      .where('crop_cycle_id', '=', cropCycleId)
      .where('run_date', '<', before)
      .where('run_date', '>=', addDaysUTC(before, -14))
      .orderBy('run_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute()) as unknown as RunRow[];
  }

  /**
   * Same-day reuse: the stored run of this key, else a new maize-dmc-api execution that passes
   * the plausibility guard (invented weather, impossible GDD jumps), stored and returned.
   */
  private async getOrCreateRun(ctx: Ctx, prep: Prepared, mode: DmcRunMode, calibration: ResolvedCalibration | null, today: string): Promise<{ run: RunRow; cached: boolean }> {
    const key = { cropCycleId: prep.cycle.id, runDate: today, mode, resolution: prep.body.resolution, calibrationHash: calibration?.hash ?? null };
    const find = (trx: Trx) =>
      trx
        .selectFrom('maize_dmc_runs')
        .selectAll()
        .where('crop_cycle_id', '=', key.cropCycleId)
        .where('run_date', '=', key.runDate)
        .where('mode', '=', key.mode)
        .where('resolution', '=', key.resolution)
        .where((eb) => (key.calibrationHash == null ? eb('calibration_hash', 'is', null) : eb('calibration_hash', '=', key.calibrationHash)))
        .executeTakeFirst() as Promise<RunRow | undefined>;
    const cached = await this.db.run(ctx, find);
    if (cached) return { run: cached, cached: true };

    let api: PredictResponse;
    try {
      api = await this.client.predict({ ...prep.body, ...(calibration ? { calibration: calibration.spec } : {}) });
    } catch (e) {
      throw upstreamError(e);
    }
    const denorm = denormOf(api);
    return this.db.run(ctx, async (trx) => {
      // Reference set: every run of the last three run days, any mode (GDD does not depend on calibration).
      const previous = await this.recentRuns(trx, prep.cycle.id, today);
      const days = [...new Set(previous.map((p) => p.run_date))].slice(0, 3);
      const verdict = assessRunPlausibility({
        runDate: today,
        sowingDate: prep.sowingDate,
        accumulatedGdd: denorm.accumulated_gdd,
        weather: api.weather,
        previous: previous.filter((p) => days.includes(p.run_date)).map((p) => ({ runDate: p.run_date, sowingDate: p.sowing_date, accumulatedGdd: p.accumulated_gdd })),
      });
      if (!verdict.ok) {
        this.logger.error(`implausible maize-dmc run rejected cycle=${prep.cycle.id} mode=${mode} execution=${api.execution_id}: ${verdict.reason}`);
        throw new DomainError(502, 'dmc_implausible_forecast', `The forecast was rejected as implausible: ${verdict.reason}`);
      }
      await trx
        .insertInto('maize_dmc_runs')
        .values({
          organization_id: ctx.orgId,
          crop_cycle_id: prep.cycle.id,
          field_id: prep.cycle.field_id,
          harvest_year: prep.cycle.harvest_year,
          run_date: today,
          mode,
          resolution: key.resolution,
          calibration_hash: key.calibrationHash,
          calibration_source: calibration?.source ?? null,
          execution_id: api.execution_id,
          model_version: api.model_version ?? null,
          sowing_date: prep.sowingDate,
          fao_maturity: prep.faoMaturity,
          variety_id: prep.cycle.variety_id,
          ...denorm,
          response: JSON.stringify(api),
        })
        // A concurrent request may have stored the same key first; that run wins.
        .onConflict((oc) => oc.columns(['crop_cycle_id', 'run_date', 'mode', 'resolution', 'calibration_hash']).doNothing())
        .execute();
      const run = await find(trx);
      if (!run) throw new Error('maize-dmc run vanished after insert');
      return { run, cached: false };
    });
  }

  /** Maize main crops of a harvest year (or one cycle), with the inputs a forecast needs. */
  private async cycles(trx: Trx, filter: { harvestYear?: number; cropCycleId?: string }): Promise<CycleRow[]> {
    const { rows } = await sql<CycleRow>`
      SELECT cc.id, cc.field_id, f.name AS field_name, fp.name AS part_name, c.code AS crop_code, coalesce(c.name_de, c.name) AS crop_name,
             cc.variety_id, v.name AS variety_name, s.harvest_year,
             coalesce(cc.area_ha, fp.area_ha, g.area_ha)::float8 AS area_ha,
             cc.sowing_date::text AS planned_sowing,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS booked_sowing,
             least(
               (SELECT min(h.harvest_date) FROM harvests h WHERE h.crop_cycle_id = cc.id),
               (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date) FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
                 WHERE ofl.crop_cycle_id = cc.id AND o.type = 'harvest' AND o.status = 'completed')
             )::text AS reported_harvest,
             ms.fao_maturity AS cycle_fao, vm.fao_maturity AS variety_fao,
             ST_AsGeoJSON(coalesce(fp.geometry, g.geometry), 7)::json AS geometry,
             wc.lat::text AS cell_lat, wc.lng::text AS cell_lng
      FROM crop_cycles cc
      JOIN growing_seasons s ON s.id = cc.season_id
      JOIN crops c ON c.id = cc.crop_id
      JOIN fields f ON f.id = cc.field_id
      LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
      LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
      LEFT JOIN crop_varieties v ON v.id = cc.variety_id
      LEFT JOIN maize_dmc_cycle_settings ms ON ms.crop_cycle_id = cc.id
      LEFT JOIN maize_dmc_variety_maturities vm ON vm.variety_id = cc.variety_id
      LEFT JOIN LATERAL app.weather_cell(ST_PointOnSurface(coalesce(fp.geometry, g.geometry))) wc ON true
      WHERE c.category = 'maize' AND cc.role = 'main' AND f.status = 'active'
        ${filter.harvestYear != null ? sql`AND s.harvest_year = ${filter.harvestYear}` : sql``}
        ${filter.cropCycleId != null ? sql`AND cc.id = ${filter.cropCycleId}` : sql``}
      ORDER BY f.name, fp.sort_order NULLS FIRST, fp.name NULLS FIRST, cc.created_at`.execute(trx);
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  updateSettings(ctx: Ctx, cropCycleId: string, input: UpdateDmcSettingsInput): Promise<{ faoMaturity: number | null }> {
    return this.db.run(ctx, async (trx) => {
      const [cycle] = await this.cycles(trx, { cropCycleId });
      if (!cycle) throw notFound('Maize crop');
      if (input.applyToVariety) {
        if (!cycle.variety_id) throw badRequest('no_variety', 'The crop has no variety to store the maturity on');
        if (input.faoMaturity == null) {
          await trx.deleteFrom('maize_dmc_variety_maturities').where('variety_id', '=', cycle.variety_id).execute();
        } else {
          await trx
            .insertInto('maize_dmc_variety_maturities')
            .values({ variety_id: cycle.variety_id, organization_id: ctx.orgId, fao_maturity: input.faoMaturity, updated_by: ctx.userId })
            .onConflict((oc) => oc.column('variety_id').doUpdateSet({ fao_maturity: input.faoMaturity!, updated_by: ctx.userId, updated_at: new Date() }))
            .execute();
        }
        // The variety's value applies; drop the cycle's own.
        await trx.deleteFrom('maize_dmc_cycle_settings').where('crop_cycle_id', '=', cycle.id).execute();
        return { faoMaturity: input.faoMaturity };
      }
      if (input.faoMaturity == null) {
        await trx.deleteFrom('maize_dmc_cycle_settings').where('crop_cycle_id', '=', cycle.id).execute();
        return { faoMaturity: cycle.variety_fao };
      }
      await trx
        .insertInto('maize_dmc_cycle_settings')
        .values({ crop_cycle_id: cycle.id, organization_id: ctx.orgId, fao_maturity: input.faoMaturity, updated_by: ctx.userId })
        .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet({ fao_maturity: input.faoMaturity, updated_by: ctx.userId, updated_at: new Date() }))
        .execute();
      return { faoMaturity: input.faoMaturity };
    });
  }

  // ---------------------------------------------------------------------------
  // Measurements
  // ---------------------------------------------------------------------------

  measurements(ctx: Ctx, cropCycleId: string): Promise<DmcMeasurement[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('maize_dmc_calibrations as m')
        .leftJoin('users as u', 'u.id', 'm.observed_by')
        .selectAll('m')
        .select('u.display_name as observer')
        .where('m.crop_cycle_id', '=', cropCycleId)
        .orderBy('m.measurement_date', 'desc')
        .orderBy('m.created_at', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        cropCycleId: r.crop_cycle_id,
        measurementDate: r.measurement_date,
        measuredDm: r.measured_dm,
        modelDmAtMeasurement: r.model_dm_at_measurement,
        offset: r.dm_offset,
        source: r.source as DmcMeasurementSource,
        notes: r.notes,
        observedBy: r.observer,
        supersededAt: iso(r.superseded_at),
        createdAt: iso(r.created_at)!,
      }));
    });
  }

  /**
   * Standard model DM at a date: a stored standard run whose window covers the date, else
   * today's standard run (nearest day). Null when the service is not configured or fails.
   */
  private async modelDmAt(ctx: Ctx, cropCycleId: string, date: string, resolution: DmcResolution): Promise<number | null> {
    const stored = await this.db.run(ctx, (trx) =>
      trx
        .selectFrom('maize_dmc_runs')
        .select(['pred_from_date', 'pred_medians', 'pred_p10', 'pred_p90'])
        .where('crop_cycle_id', '=', cropCycleId)
        .where('mode', '=', 'standard')
        .where('run_date', '<=', date)
        .where('run_date', '>=', addDaysUTC(date, -DMC_FORECAST_HORIZON_DAYS))
        .orderBy('run_date', 'desc')
        .orderBy('created_at', 'desc')
        .execute(),
    );
    for (const r of stored) {
      const v = storedValueOn(r, date);
      if (v) return v.median;
    }
    if (!this.configured) return null;
    try {
      const today = todayUTC();
      const prep = await this.db.run(ctx, (trx) => this.prepare(trx, cropCycleId, resolution, today));
      const { run } = await this.getOrCreateRun(ctx, prep, 'standard', null, today);
      return modelMedianNearest(storedDays(run), date);
    } catch (e) {
      this.logger.warn(`no model DM for measurement on cycle ${cropCycleId}: ${(e as Error).message}`);
      return null;
    }
  }

  async addMeasurement(ctx: Ctx, cropCycleId: string, input: CreateDmcMeasurementInput): Promise<DmcMeasurement> {
    const today = todayUTC();
    const cycle = await this.db.run(ctx, async (trx) => (await this.cycles(trx, { cropCycleId }))[0]);
    if (!cycle) throw notFound('Maize crop');
    if (input.measurementDate > today) throw badRequest('measurement_in_future', 'The measurement date lies in the future');
    const sowing = sowingOf(cycle);
    if (sowing && input.measurementDate < sowing) throw badRequest('measurement_before_sowing', `The measurement date is before sowing (${sowing})`);
    if (input.measuredDm == null && !this.configured) throw notConfigured();

    const model = await this.modelDmAt(ctx, cycle.id, input.measurementDate, input.resolution);
    const measuredDm = input.measuredDm ?? (model != null && input.offset != null ? model + input.offset : null);
    if (measuredDm == null) throw new DomainError(422, 'dmc_no_model_value', 'There is no model value at the measurement date to apply the offset to');
    if (measuredDm <= 0 || measuredDm >= 1) throw badRequest('invalid_value', 'The resulting dry matter is out of range');

    const id = await this.db.run(ctx, async (trx) => {
      // One active measurement per cycle: the newest calibrates, older ones stay as history.
      await trx.updateTable('maize_dmc_calibrations').set({ superseded_at: new Date() }).where('crop_cycle_id', '=', cycle.id).where('superseded_at', 'is', null).execute();
      const row = await trx
        .insertInto('maize_dmc_calibrations')
        .values({
          organization_id: ctx.orgId,
          crop_cycle_id: cycle.id,
          field_id: cycle.field_id,
          variety_id: cycle.variety_id,
          harvest_year: cycle.harvest_year,
          measurement_date: input.measurementDate,
          measured_dm: measuredDm,
          model_dm_at_measurement: model,
          dm_offset: model != null ? measuredDm - model : null,
          source: input.source,
          notes: input.notes ?? null,
          samples: input.samples ? JSON.stringify(input.samples) : null,
          observed_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    return (await this.measurements(ctx, cycle.id)).find((m) => m.id === id)!;
  }

  /** Corrects a measurement's date or value; its offset is recomputed. */
  async updateMeasurement(ctx: Ctx, id: string, input: UpdateDmcMeasurementInput): Promise<DmcMeasurement> {
    const row = await this.db.run(ctx, (trx) => trx.selectFrom('maize_dmc_calibrations').selectAll().where('id', '=', id).executeTakeFirst());
    if (!row) throw notFound('Measurement');
    const measurementDate = input.measurementDate ?? row.measurement_date;
    if (measurementDate > todayUTC()) throw badRequest('measurement_in_future', 'The measurement date lies in the future');
    const measuredDm = input.measuredDm ?? row.measured_dm;
    const model = measurementDate === row.measurement_date ? row.model_dm_at_measurement : await this.modelDmAt(ctx, row.crop_cycle_id, measurementDate, '10m');
    await this.db.run(ctx, (trx) =>
      trx
        .updateTable('maize_dmc_calibrations')
        .set({ measurement_date: measurementDate, measured_dm: measuredDm, model_dm_at_measurement: model, dm_offset: model != null ? measuredDm - model : null })
        .where('id', '=', id)
        .execute(),
    );
    return (await this.measurements(ctx, row.crop_cycle_id)).find((m) => m.id === id)!;
  }

  /** Deletes a wrong measurement; when it was the active one, the previous one becomes active again. */
  deleteMeasurement(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const row = await trx.selectFrom('maize_dmc_calibrations').select(['crop_cycle_id', 'superseded_at']).where('id', '=', id).executeTakeFirst();
      if (!row) throw notFound('Measurement');
      await trx.deleteFrom('maize_dmc_calibrations').where('id', '=', id).execute();
      if (row.superseded_at == null) {
        const prev = await trx
          .selectFrom('maize_dmc_calibrations')
          .select('id')
          .where('crop_cycle_id', '=', row.crop_cycle_id)
          .orderBy('measurement_date', 'desc')
          .orderBy('created_at', 'desc')
          .executeTakeFirst();
        if (prev) await trx.updateTable('maize_dmc_calibrations').set({ superseded_at: null }).where('id', '=', prev.id).execute();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Variety offsets
  // ---------------------------------------------------------------------------

  /** Varieties sown on maize this harvest year, with their measurement counts (the offset basis). */
  offsetVarieties(ctx: Ctx, harvestYear: number): Promise<DmcOffsetVariety[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<DmcOffsetVariety>`
        SELECT v.id AS "varietyId", v.name AS variety, count(DISTINCT cc.id)::int AS "cycleCount",
               (SELECT count(*)::int FROM maize_dmc_calibrations m
                 WHERE m.variety_id = v.id AND m.harvest_year = ${harvestYear} AND m.superseded_at IS NULL AND m.dm_offset IS NOT NULL) AS "measurementCount"
        FROM crop_cycles cc
        JOIN growing_seasons s ON s.id = cc.season_id AND s.harvest_year = ${harvestYear}
        JOIN crops c ON c.id = cc.crop_id AND c.category = 'maize'
        JOIN crop_varieties v ON v.id = cc.variety_id
        WHERE cc.role = 'main'
        GROUP BY v.id, v.name
        ORDER BY v.name`.execute(trx);
      return rows;
    });
  }

  /** Active measurements of the selected varieties in a date range, and their mean offset. */
  offsetBasis(ctx: Ctx, harvestYear: number, q: { varietyIds: string[]; from: string; to: string }): Promise<DmcOffsetBasis> {
    if (!q.varietyIds.length) return Promise.resolve({ points: [], suggestedOffset: null });
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('maize_dmc_calibrations as m')
        .innerJoin('fields as f', 'f.id', 'm.field_id')
        .innerJoin('crop_varieties as v', 'v.id', 'm.variety_id')
        .select([
          'm.id as calibrationId',
          'm.crop_cycle_id as cropCycleId',
          'f.name as fieldName',
          'v.id as varietyId',
          'v.name as variety',
          'm.measurement_date as measurementDate',
          'm.measured_dm as measuredDm',
          'm.model_dm_at_measurement as modelDmAtMeasurement',
          'm.dm_offset as offset',
        ])
        .where('m.harvest_year', '=', harvestYear)
        .where('m.superseded_at', 'is', null)
        .where('m.variety_id', 'in', q.varietyIds)
        .where('m.measurement_date', '>=', q.from)
        .where('m.measurement_date', '<=', q.to)
        .where('m.dm_offset', 'is not', null)
        .where('m.model_dm_at_measurement', 'is not', null)
        .orderBy('m.measurement_date')
        .orderBy('f.name')
        .execute();
      const points = rows as DmcOffsetBasisPoint[];
      return { points, suggestedOffset: meanOffset(points.map((p) => p.offset)) };
    });
  }

  /** Applied offsets of the harvest year, active and superseded, as apply batches. */
  offsets(ctx: Ctx, harvestYear: number): Promise<DmcOffsetBatch[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('maize_dmc_variety_offsets as o')
        .leftJoin('crop_varieties as v', 'v.id', 'o.variety_id')
        .leftJoin('users as u', 'u.id', 'o.applied_by')
        .select(['o.id', 'o.variety_id', 'v.name as variety', 'o.dm_offset', 'o.suggested_offset', 'o.basis_count', 'o.basis_from', 'o.basis_to', 'o.comment', 'u.display_name as applied_by', 'o.applied_at', 'o.superseded_at'])
        .where('o.harvest_year', '=', harvestYear)
        .orderBy('o.applied_at', 'desc')
        .execute();
      return groupOffsetBatches(
        rows.map((r) => ({
          id: r.id,
          varietyId: r.variety_id,
          variety: r.variety,
          offset: r.dm_offset,
          suggestedOffset: r.suggested_offset,
          basisCount: r.basis_count,
          basisFrom: r.basis_from,
          basisTo: r.basis_to,
          comment: r.comment,
          appliedBy: r.applied_by,
          appliedAt: iso(r.applied_at)!,
          supersededAt: iso(r.superseded_at),
        })),
      );
    });
  }

  /** One offset for every selected variety; supersedes their active offsets. */
  applyOffset(ctx: Ctx, input: ApplyDmcOffsetInput): Promise<{ applied: number }> {
    if (input.basis.from > input.basis.to) throw badRequest('invalid_range', 'The basis range ends before it starts');
    return this.db.run(ctx, async (trx) => {
      const now = new Date();
      await trx
        .updateTable('maize_dmc_variety_offsets')
        .set({ superseded_at: now })
        .where('harvest_year', '=', input.harvestYear)
        .where('variety_id', 'in', input.varietyIds)
        .where('superseded_at', 'is', null)
        .execute();
      await trx
        .insertInto('maize_dmc_variety_offsets')
        .values(
          input.varietyIds.map((varietyId) => ({
            organization_id: ctx.orgId,
            harvest_year: input.harvestYear,
            variety_id: varietyId,
            dm_offset: input.offset,
            suggested_offset: input.suggestedOffset,
            basis_count: input.basis.calibrationIds.length,
            basis_from: input.basis.from,
            basis_to: input.basis.to,
            basis_calibration_ids: input.basis.calibrationIds,
            comment: input.comment ?? null,
            applied_by: ctx.userId,
            applied_at: now,
          })),
        )
        .execute();
      return { applied: input.varietyIds.length };
    });
  }

  /** Revokes active offset rows (without replacement: those varieties' runs go standard). */
  revokeOffsets(ctx: Ctx, input: RevokeDmcOffsetsInput): Promise<{ revoked: number }> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .updateTable('maize_dmc_variety_offsets')
        .set({ superseded_at: new Date() })
        .where('id', 'in', input.ids)
        .where('superseded_at', 'is', null)
        .returning('id')
        .execute();
      return { revoked: rows.length };
    });
  }
}
