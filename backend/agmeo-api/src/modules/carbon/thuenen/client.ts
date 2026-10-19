/**
 * Client of the Thünen RothC service (agmeo src/lib/co2nserve/thuenen/carbonModeling.ts). The batch
 * endpoint runs one simulation per request body; warnings and errors of any run fail the batch,
 * as in the reference.
 */
import { config } from '../../../config.js';
import {
  type ThuenenRunRRequest,
  ThuenenRunRRequestSchema,
  type ThuenenRunRResponse,
  ThuenenRunRResponseBatchSchema,
  type ThuenenRunRResponseBatch,
  ThuenenRunRResponseSchema,
} from './types.js';

export class RothCError extends Error {
  constructor(
    message: string,
    readonly input: ThuenenRunRRequest[],
    readonly output: unknown,
    /** HTTP status of the service, when it answered. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RothCError';
  }
}

export const thuenenConfigured = () => Boolean(config.thuenen.apiKey.trim());

function endpoint(path: string): URL {
  const key = config.thuenen.apiKey.trim();
  if (!key) throw new Error('THUENEN_API_KEY is not configured');
  const url = new URL(config.thuenen.baseUrl.replace(/\/$/, '') + path);
  url.searchParams.set('api_key', key);
  return url;
}

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export async function runRothC(
  body: ThuenenRunRRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ThuenenRunRResponse> {
  const validated = ThuenenRunRRequestSchema.parse(body);
  const res = await fetchImpl(endpoint('/humusbalancerothc/runR'), {
    method: 'POST',
    headers,
    body: JSON.stringify(validated),
  });
  if (!res.ok)
    throw new RothCError(
      `Thuenen runRothC failed with status ${res.status}: ${res.statusText}`,
      [body],
      null,
      res.status,
    );
  return ThuenenRunRResponseSchema.parse(JSON.parse(await res.text()));
}

export async function batchRunRothC(
  bodies: ThuenenRunRRequest[],
  fetchImpl: typeof fetch = fetch,
): Promise<ThuenenRunRResponseBatch> {
  if (bodies.length === 0)
    throw new Error('No requests provided for batchRunRothC');
  const validated = bodies.map((b) => ThuenenRunRRequestSchema.parse(b));
  const res = await fetchImpl(endpoint('/humusbalancerothc/batch'), {
    method: 'POST',
    headers,
    body: JSON.stringify(validated),
  });
  if (!res.ok) {
    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep the text
    }
    throw new RothCError(
      `Thuenen batchRunRothC failed with status ${res.status}: ${res.statusText}`,
      bodies,
      parsed,
      res.status,
    );
  }
  // The batch endpoint names its columns with brackets; normalise them to the single-run names.
  const text = (await res.text())
    .replaceAll('Time_[ISO_8601]', 'Time_ISO_8601')
    .replaceAll('SOC_stock_[Mg_C_ha-1]', 'SOC_stock_Mg_C_ha_1')
    .replaceAll('SOC_content_[%_C_ha-1]', 'SOC_content_percent_C_ha_1');
  const json = JSON.parse(text);
  const parsed = ThuenenRunRResponseBatchSchema.parse(json);
  if (parsed.processed_count !== bodies.length) {
    throw new RothCError(
      `Thuenen batchRunRothC processed ${parsed.processed_count} of ${bodies.length} requests`,
      bodies,
      json,
    );
  }
  if (parsed.results.some((r) => r.errors.length > 0))
    throw new RothCError('Thuenen batchRunRothC returned errors', bodies, json);
  if (parsed.results.some((r) => r.warnings.length > 0))
    throw new RothCError(
      'Thuenen batchRunRothC returned warnings',
      bodies,
      json,
    );
  return parsed;
}
