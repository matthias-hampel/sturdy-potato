/**
 * HTTP to AGVOLUTION's model services (ESM, grassland-api, ISIP): a timeout per attempt and
 * retries of transient failures, as the reference's grassland client does it — 5xx answers and
 * network errors are retried, 4xx answers and timeouts are not (a timed-out attempt already used
 * the whole budget).
 */
import type { ModelService } from '@agmeo/contracts';
import { DomainError } from '../../core/errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ServiceHttpError extends Error {
  constructor(
    readonly service: ModelService,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${service} answered ${status}: ${body.slice(0, 300)}`);
  }
}

export class ServiceTimeoutError extends Error {
  constructor(
    readonly service: ModelService,
    readonly timeoutMs: number,
  ) {
    super(`${service} did not answer within ${Math.round(timeoutMs / 1000)} s`);
  }
}

/** A request that would need a service whose URL or credentials are not set. */
export const notConfigured = (service: ModelService) =>
  new DomainError(503, 'service_not_configured', `The ${service} service is not configured`, { service });

/** A service that answered with an error or not at all, for a request that needs its answer. */
export const unavailable = (service: ModelService, e: unknown) =>
  new DomainError(502, 'service_unavailable', `The ${service} service is not available`, { service, reason: (e as Error)?.message ?? String(e) });

export interface ServiceRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** JSON-encoded unless a string or URLSearchParams. */
  body?: unknown;
  timeoutMs: number;
  /** Total attempts (1 = no retry). */
  attempts?: number;
  /** Wait before the 2nd, 3rd, … attempt. */
  retryDelaysMs?: number[];
}

function isRetryable(e: unknown): boolean {
  if (e instanceof ServiceHttpError) return e.status >= 500;
  if (e instanceof ServiceTimeoutError) return false;
  // fetch network failures (connection refused or reset, DNS) are TypeErrors.
  return e instanceof TypeError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends the request and returns the parsed JSON body; throws ServiceHttpError / ServiceTimeoutError. */
export async function requestJson<T>(service: ModelService, req: ServiceRequest, fetchFn: FetchLike = fetch): Promise<T> {
  const attempts = Math.max(1, req.attempts ?? 1);
  const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
  let body: string | URLSearchParams | undefined;
  if (req.body instanceof URLSearchParams || typeof req.body === 'string') body = req.body;
  else if (req.body !== undefined) {
    body = JSON.stringify(req.body);
    headers['Content-Type'] = 'application/json';
  }
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetchFn(req.url, { method: req.method ?? 'GET', headers, body, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) throw new ServiceHttpError(service, res.status, text);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ServiceHttpError(service, res.status, `invalid JSON: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      const err = controller.signal.aborted && !(e instanceof ServiceHttpError) ? new ServiceTimeoutError(service, req.timeoutMs) : e;
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await sleep(req.retryDelaysMs?.[attempt - 1] ?? 1000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}
