/**
 * ISIP disease risk, after the reference's disease cron (app/api/cron/disease-crawler: daily
 * 06:00 UTC, Feb 15 – Jun 30, ISIP crops only, crops not refreshed within 22 hours) and the
 * agmeo-crawlers disease worker (src/crawlers/disease.ts, src/lib/isip-client.ts).
 *
 * agmeo-crawlers takes jobs at POST /jobs/disease ({jobs: [{cultivationId, lat, lon, crop,
 * orgClerkId, simulationDate}]}, bearer JOBS_SECRET, answers {enqueued}) and writes the result
 * straight into the reference's database (CultivationTimeseries.disease); it offers no callback,
 * no result endpoint and no synchronous call. So the worker here calls ISIP the way the crawler
 * does — a Keycloak password-grant token (cached 25 minutes; ISIP tokens live 30) and GET
 * <ISIP_API_URL>/models/siggetreide?crop&latitude&longitude&simulation_date — and stores the
 * per-day, per-disease levels in disease_risk_days.
 */
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import { enqueue } from '../../jobs/queue.js';
import type { JobHandler } from '../../jobs/runner.js';
import { MODEL_CROP_BY_CODE, modelCrop } from '../../models/crops.js';
import { getISIPCrop, isWithinDiseaseModelPeriod, ISIP_SUPPORTED_CROPS, type ISIPCrop } from '../../models/disease/diseaseRisk.js';
import { isWithinIsipSeason, parseISIPResponse, type ISIPResponse } from '../../models/disease/isip.js';
import { requestJson, type FetchLike } from './http.js';

export const DISEASE_SCAN = 'disease.scan';
export const DISEASE_CROP = 'disease.crop';
const logger = new Logger('DiseaseRisk');

/** Rewrite crop codes whose model crop ISIP covers. */
export const ISIP_CROP_CODES = Object.entries(MODEL_CROP_BY_CODE)
  .filter(([, crop]) => Object.hasOwn(ISIP_SUPPORTED_CROPS, crop))
  .map(([code]) => code);

/** The ISIP crop of a rewrite crop code. */
export const isipCropOfCode = (code: string | null | undefined): ISIPCrop | undefined => {
  const crop = modelCrop(code);
  return crop ? getISIPCrop(crop) : undefined;
};

export interface IsipOptions {
  apiUrl: string;
  tokenUrl: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export class IsipClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly opts: IsipOptions = config.models.isip,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return !!this.opts.apiUrl && !!this.opts.tokenUrl && !!this.opts.username && !!this.opts.password && !!this.opts.clientSecret;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await requestJson<{ access_token: string }>(
      'isip',
      {
        url: this.opts.tokenUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', username: this.opts.username, password: this.opts.password, client_id: this.opts.clientId, client_secret: this.opts.clientSecret }),
        timeoutMs: this.opts.timeoutMs,
        attempts: 2,
      },
      this.fetchFn,
    );
    this.token = { value: res.access_token, expiresAt: Date.now() + 25 * 60_000 };
    return res.access_token;
  }

  /** The cereal disease model at a point; a rejected token is renewed once. */
  async diseaseRisks(lat: number, lon: number, crop: ISIPCrop, simulationDate: string): Promise<ISIPResponse> {
    const params = new URLSearchParams({ crop, latitude: String(lat), longitude: String(lon), simulation_date: simulationDate });
    const call = async () =>
      requestJson<ISIPResponse>(
        'isip',
        { url: `${this.opts.apiUrl}/models/siggetreide?${params}`, headers: { Authorization: `Bearer ${await this.accessToken()}` }, timeoutMs: this.opts.timeoutMs, attempts: 2 },
        this.fetchFn,
      );
    try {
      return await call();
    } catch (e) {
      if ((e as { status?: number }).status !== 401) throw e;
      this.token = null;
      return call();
    }
  }
}

/** Daily: one job per ISIP crop in a running season that was not refreshed within 22 hours. */
export function diseaseScanHandler(db: Kysely<DB>, client: IsipClient = new IsipClient(), today = () => new Date()): JobHandler {
  return async () => {
    if (!client.configured) {
      logger.log('ISIP is not configured; disease risk skipped');
      return;
    }
    const now = today();
    if (!isWithinDiseaseModelPeriod(now)) return;
    const date = now.toISOString().slice(0, 10);
    const { rows } = await sql<{ crop_cycle_id: string; organization_id: string; crop_code: string; lat: number; lng: number }>`
      SELECT * FROM app.disease_risk_demand(${ISIP_CROP_CODES}::text[], interval '22 hours')`.execute(db);
    for (const r of rows) {
      const crop = isipCropOfCode(r.crop_code);
      if (!crop || !isWithinIsipSeason(date, crop)) continue;
      await enqueue(db, {
        kind: DISEASE_CROP,
        organizationId: r.organization_id,
        payload: { cropCycleId: r.crop_cycle_id, organizationId: r.organization_id, cropCode: r.crop_code, lat: r.lat, lng: r.lng, simulationDate: date },
        dedupeKey: `${r.crop_cycle_id}:${date}`,
        maxAttempts: 3,
      });
    }
    logger.log(`Queued disease risk for ${rows.length} crops`);
  };
}

/** Fetches and stores the disease risk of one crop. */
export function diseaseCropHandler(db: Kysely<DB>, client: IsipClient = new IsipClient()): JobHandler {
  return async (job) => {
    const p = job.payload as { cropCycleId: string; organizationId: string; cropCode: string; lat: number; lng: number; simulationDate: string };
    const crop = isipCropOfCode(p.cropCode);
    if (!client.configured || !crop || !isWithinIsipSeason(p.simulationDate, crop)) return;
    const state = { organization_id: p.organizationId, crop_cycle_id: p.cropCycleId };
    let days: Map<string, Record<string, number>>;
    try {
      days = parseISIPResponse(await client.diseaseRisks(p.lat, p.lng, crop, p.simulationDate), crop) as Map<string, Record<string, number>>;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 2000);
      await db
        .insertInto('disease_risk_state')
        .values({ ...state, last_error: msg, last_error_at: new Date() })
        .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet({ last_error: msg, last_error_at: new Date() }))
        .execute();
      throw e;
    }
    const rows = [...days].flatMap(([date, day]) => Object.entries(day).map(([disease, level]) => ({ ...state, date, disease, level })));
    await db.transaction().execute(async (trx) => {
      // As the crawler merges into the stored series: later fetches overwrite the days they return.
      for (let i = 0; i < rows.length; i += 500) {
        await trx
          .insertInto('disease_risk_days')
          .values(rows.slice(i, i + 500))
          .onConflict((oc) => oc.columns(['crop_cycle_id', 'date', 'disease']).doUpdateSet({ level: (eb) => eb.ref('excluded.level') }))
          .execute();
      }
      const done = { refreshed_at: new Date(), simulation_date: p.simulationDate, last_error: null, last_error_at: null };
      await trx
        .insertInto('disease_risk_state')
        .values({ ...state, ...done })
        .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet(done))
        .execute();
    }).catch((e: unknown) => {
      // The crop was deleted since the scan.
      if ((e as { code?: string }).code === '23503') return;
      throw e;
    });
  };
}
