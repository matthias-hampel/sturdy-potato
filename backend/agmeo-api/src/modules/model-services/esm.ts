/**
 * ESM — the ecosystem model server of AGVOLUTION (lvl0-models pymodels/ecosystem/esm/endpoints),
 * after the reference's lib/farmalyzer/cultivations.ts (callEsmRun), lib/farmalyzer/zones.ts
 * (zonesModelWriteback) and app/api/[orgId]/predictions/timeseries/getTimeseries.ts.
 *
 * Contract (ESM endpoints, Elysia, Clerk bearer auth):
 * - POST /esm/run?sync=true {cultivation, parameters, meta} queues the model run on the ESM's
 *   RabbitMQ and, in sync mode, waits for the worker's reply (ESM gives up after 300 s). With
 *   meta.includeResultInResponse the reply carries the zones file: {cultivationId, executionId,
 *   success, zones: FeatureCollection} whose features have areaInHa, yieldInTpHa_model,
 *   nCropInKgNpHa_model, nMinInKgNpHa_model, nMinSpringInKgNpHa_model, nLossInKgNpHa_model,
 *   soilTypeLUFA and soilOrganicCarbon.
 * - Without sync the ESM worker posts the zones to https://<meta.sourceDomain>/api/esm/writeback
 *   instead (the reference's path); it skips that for a "localhost" domain when it runs on its
 *   Hetzner host. This port uses the sync reply, so no public writeback endpoint is needed.
 * - GET /results/<year>/<cultivation id>/timeseries.json: the crop timeseries of the last run
 *   (404 while there is none).
 *
 * The API stores the request in the user's context (esm_runs.request); the worker sends it.
 */
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import type { JobHandler } from '../../jobs/runner.js';
import { requestJson, ServiceHttpError, type FetchLike } from './http.js';

export const ESM_RUN = 'esm.run';
const logger = new Logger('Esm');

export interface EsmOptions {
  url: string;
  token: string;
  writebackDomain: string;
  runTimeoutMs: number;
  timeoutMs: number;
}

/** The /esm/run body (lvl0-models esm/endpoints src/types.ts esmRunBodySchema). */
export interface EsmRunRequest {
  cultivation: {
    id: string;
    year: number;
    crop: string;
    geom4326: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
    sowingDate?: string;
    soil?: {
      map: {
        type: 'FeatureCollection';
        features: { type: 'Feature'; geometry: unknown; properties: { soilTypeLUFA: string; soilOrganicCarbon: number } }[];
      };
    };
  };
  parameters: { nrZones: number };
  meta: { sourceDomain: string; includeResultInResponse: boolean };
}

export interface EsmRunReply {
  cultivationId?: string;
  executionId?: string;
  success?: boolean;
  zones?: unknown;
}

export class EsmClient {
  constructor(
    private readonly opts: EsmOptions = config.models.esm,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.opts.url && !!this.opts.token;
  }

  get writebackDomain(): string {
    return this.opts.writebackDomain;
  }

  private get headers() {
    return { Authorization: `Bearer ${this.opts.token}` };
  }

  /** Runs the model and waits for its zones (one attempt: a run takes minutes). */
  run(body: EsmRunRequest): Promise<EsmRunReply> {
    return requestJson<EsmRunReply>('esm', { url: `${this.opts.url}/esm/run?sync=true`, method: 'POST', headers: this.headers, body, timeoutMs: this.opts.runTimeoutMs }, this.fetchFn);
  }

  /** The crop timeseries of the last run; null while the ESM has none (404). */
  async timeseries(year: number, cropCycleId: string): Promise<unknown | null> {
    try {
      return await requestJson<unknown>(
        'esm',
        { url: `${this.opts.url}/results/${year}/${cropCycleId}/timeseries.json`, headers: this.headers, timeoutMs: this.opts.timeoutMs, attempts: 3, retryDelaysMs: [1000, 2000] },
        this.fetchFn,
      );
    } catch (e) {
      if (e instanceof ServiceHttpError && e.status === 404) return null;
      throw e;
    }
  }
}

export interface ParsedEsmZone {
  zoneNo: number;
  areaHa: number;
  areaFraction: number;
  yieldTHa: number;
  nCropKgHa: number | null;
  nMinKgHa: number;
  nMinSpringKgHa: number;
  nLossKgHa: number;
  soilTypeLufa: string | null;
  soilOrganicCarbonPct: number | null;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const LUFA = new Set(['S', 'lS', 'sU', 'ssL', 'lU', 'sL', 'uL', 'L', 'utL', 'tL', 'T']);

/**
 * The zones of the ESM's zones.geojson (as create_zone_data in the ESM's writeback.py reads
 * them): area fractions from the areas, numbered by rising yield. Features without a yield,
 * the N terms or a polygon geometry are dropped.
 */
export function parseEsmZones(fc: unknown): ParsedEsmZone[] {
  const features = (fc as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const zones = features.flatMap((f) => {
    const props = ((f as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    const geometry = (f as { geometry?: ParsedEsmZone['geometry'] }).geometry;
    const areaHa = num(props.areaInHa);
    const yieldTHa = num(props.yieldInTpHa_model);
    const nMin = num(props.nMinInKgNpHa_model);
    const nMinSpring = num(props.nMinSpringInKgNpHa_model);
    const nLoss = num(props.nLossInKgNpHa_model);
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return [];
    if (areaHa == null || yieldTHa == null || nMin == null || nMinSpring == null || nLoss == null) return [];
    const lufa = typeof props.soilTypeLUFA === 'string' && LUFA.has(props.soilTypeLUFA) ? props.soilTypeLUFA : null;
    return [{ areaHa, yieldTHa, nCropKgHa: num(props.nCropInKgNpHa_model), nMinKgHa: nMin, nMinSpringKgHa: nMinSpring, nLossKgHa: nLoss, soilTypeLufa: lufa, soilOrganicCarbonPct: num(props.soilOrganicCarbon), geometry }];
  });
  const total = zones.reduce((s, z) => s + z.areaHa, 0);
  if (total <= 0) return [];
  return zones
    .toSorted((a, b) => a.yieldTHa - b.yieldTHa)
    .map((z, i) => ({ ...z, zoneNo: i + 1, areaFraction: Math.min(1, Math.max(0, z.areaHa / total)) }));
}

/** Runs a queued ESM run and stores its zones. A failed run is recorded, not retried: a run takes minutes. */
export function esmRunHandler(db: Kysely<DB>, client: EsmClient = new EsmClient()): JobHandler {
  return async (job) => {
    const runId = job.payload.runId as string | undefined;
    if (!runId) return;
    const run = await db.selectFrom('esm_runs').select(['id', 'organization_id', 'status', 'request']).where('id', '=', runId).executeTakeFirst();
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
    const fail = (error: string) =>
      db.updateTable('esm_runs').set({ status: 'failed', error: error.slice(0, 2000), finished_at: new Date() }).where('id', '=', runId).execute();
    if (!client.configured) {
      logger.warn('ESM is not configured; run skipped');
      await fail('ESM is not configured');
      return;
    }
    await db.updateTable('esm_runs').set({ status: 'running', started_at: new Date() }).where('id', '=', runId).execute();

    let reply: EsmRunReply;
    try {
      reply = await client.run(run.request as unknown as EsmRunRequest);
    } catch (e) {
      logger.error(`ESM run ${runId} failed: ${(e as Error).message}`);
      await fail((e as Error).message);
      return;
    }
    // On failure the reply may still carry an older zones file: never take zones from a failed run.
    if (reply.success === false) return void (await fail('The ESM could not model the crop'));
    const zones = parseEsmZones(reply.zones);
    if (!zones.length) return void (await fail('The ESM returned no zones'));

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('esm_run_zones').where('run_id', '=', runId).execute();
      for (const z of zones) {
        await sql`
          INSERT INTO esm_run_zones (organization_id, run_id, zone_no, area_ha, area_fraction, yield_t_ha, n_crop_kg_ha, n_min_kg_ha, n_min_spring_kg_ha, n_loss_kg_ha, soil_type_lufa, soil_organic_carbon_pct, geometry)
          VALUES (${run.organization_id}, ${runId}, ${z.zoneNo}, ${z.areaHa}, ${z.areaFraction}, ${z.yieldTHa}, ${z.nCropKgHa}, ${z.nMinKgHa}, ${z.nMinSpringKgHa}, ${z.nLossKgHa}, ${z.soilTypeLufa}, ${z.soilOrganicCarbonPct},
                  ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(z.geometry)}), 4326)), 3)))`.execute(trx);
      }
      await trx
        .updateTable('esm_runs')
        .set({ status: 'succeeded', error: null, execution_id: reply.executionId ?? null, finished_at: new Date() })
        .where('id', '=', runId)
        .execute();
    });
  };
}
