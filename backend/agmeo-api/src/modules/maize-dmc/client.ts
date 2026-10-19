/**
 * HTTP client of AGVOLUTION's maize-dmc-api, ported from the reference's lib/maizeDmc/client.ts.
 * Configured by MAIZE_DMC_API_URL / MAIZE_DMC_API_TOKEN / MAIZE_DMC_API_TIMEOUT_MS; without a
 * URL `configured` is false and every call fails with 503 `dmc_not_configured`.
 *
 * Contract (service 0.3.x):
 *  - POST /dmc/predict  {geometry, sowing_date, fao_maturity, resolution, calibration?, weather?}
 *    → PredictResponse; synchronous (model run + S3 upload), 5–30 s.
 *  - GET  /dmc/results/{executionId}/{date}?output=png|tiff&band=mean|p10|p90&resolution=10m|3m
 *    → the raster, with header `x-bounding-box-epsg-3857`.
 *  - Authorization: Bearer <token> when a token is configured.
 */
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config.js';
import { DomainError } from '../../core/errors.js';
import type {
  PredictBody,
  PredictResponse,
  Resolution,
  ResultBand,
  ResultOutput,
} from './types.js';

export class MaizeDmcApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`maize-dmc-api ${status}: ${body.slice(0, 500)}`);
    this.name = 'MaizeDmcApiError';
  }
}

export const notConfigured = () =>
  new DomainError(
    503,
    'dmc_not_configured',
    'Maize dry-matter forecasts are not configured (MAIZE_DMC_API_URL is not set)',
  );

// Transient upstream failures (keep-alive races between maize-dmc-api and esm-sat-api surface
// as fast 5xx) resolve on a fresh attempt, so those are retried — never 4xx (deterministic
// rejections) and never our own timeout (that attempt already used the whole time budget).
export const PREDICT_ATTEMPTS = 3;
const PREDICT_RETRY_DELAY_MS = [1_000, 2_000];

function isRetryable(err: unknown): boolean {
  if (err instanceof MaizeDmcApiError) return err.status >= 500;
  // fetch network-level failure (connection reset, DNS, ...)
  return err instanceof TypeError;
}

export interface MaizeDmcResult {
  body: Buffer;
  contentType: string;
  bbox3857: string | null;
}

@Injectable()
export class MaizeDmcClient {
  private readonly logger = new Logger('MaizeDmcClient');

  /** Overridable in tests; defaults to the global fetch and real waits. */
  protected fetch: typeof fetch = (...args) => fetch(...args);
  protected sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  get configured(): boolean {
    return config.maizeDmc.apiUrl !== '';
  }

  private headers(): Record<string, string> {
    return config.maizeDmc.apiToken
      ? { authorization: `Bearer ${config.maizeDmc.apiToken}` }
      : {};
  }

  /** POST /dmc/predict with up to three attempts on 5xx and network errors. */
  async predict(body: PredictBody): Promise<PredictResponse> {
    if (!this.configured) throw notConfigured();
    const url = `${config.maizeDmc.apiUrl}/dmc/predict`;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.headers() },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.maizeDmc.timeoutMs),
        });
        if (!res.ok) throw new MaizeDmcApiError(res.status, await res.text());
        return (await res.json()) as PredictResponse;
      } catch (err) {
        if (attempt >= PREDICT_ATTEMPTS || !isRetryable(err)) throw err;
        this.logger.warn(
          `predict attempt ${attempt} failed, retrying: ${(err as Error).message}`,
        );
        await this.sleep(PREDICT_RETRY_DELAY_MS[attempt - 1]);
      }
    }
  }

  /** GET /dmc/results/{executionId}/{date}: one day's raster, buffered (a single field is small). */
  async result(args: {
    executionId: string;
    date: string;
    output: ResultOutput;
    band: ResultBand;
    resolution: Resolution;
  }): Promise<MaizeDmcResult> {
    if (!this.configured) throw notConfigured();
    const qs = new URLSearchParams({
      output: args.output,
      band: args.band,
      resolution: args.resolution,
    });
    const url = `${config.maizeDmc.apiUrl}/dmc/results/${encodeURIComponent(args.executionId)}/${args.date}?${qs}`;
    const res = await this.fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(config.maizeDmc.timeoutMs),
    });
    if (!res.ok) throw new MaizeDmcApiError(res.status, await res.text());
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: args.output === 'tiff' ? 'image/tiff' : 'image/png',
      bbox3857: res.headers.get('x-bounding-box-epsg-3857'),
    };
  }
}

/** Maps a failed service call to an API error: 4xx pass through, the rest is 502, our timeout 504. */
export function upstreamError(err: unknown): DomainError {
  if (err instanceof DomainError) return err;
  if (err instanceof MaizeDmcApiError) {
    const status =
      err.status === 404
        ? 404
        : err.status >= 400 && err.status < 500
          ? 422
          : 502;
    return new DomainError(
      status,
      'dmc_upstream_error',
      `The maize dry-matter service answered ${err.status}: ${err.body.slice(0, 200)}`,
    );
  }
  if (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  ) {
    return new DomainError(
      504,
      'dmc_upstream_timeout',
      'The maize dry-matter service did not answer in time',
    );
  }
  return new DomainError(
    502,
    'dmc_upstream_error',
    `The maize dry-matter service is not reachable: ${(err as Error)?.message ?? String(err)}`,
  );
}
