import { IsipClient, ISIP_CROP_CODES, isipCropOfCode } from './disease.js';
import { EsmClient, parseEsmZones } from './esm.js';
import { GrasslandClient, shapeGrasslandPredictions } from './grassland.js';
import { requestJson, ServiceHttpError, ServiceTimeoutError, type FetchLike } from './http.js';
import { parseCropTimeseries } from './model-services.service.js';


type Call = { url: string; init?: RequestInit };
/** A fetch that answers from a queue of [status, body] (or throws an Error instance). */
function fakeFetch(answers: ([number, unknown] | Error)[]) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (!a) throw new Error('no answer queued');
    if (a instanceof Error) throw a;
    return new Response(typeof a[1] === 'string' ? a[1] : JSON.stringify(a[1]), { status: a[0] });
  };
  return { fn, calls };
}

describe('model service HTTP', () => {
  it('retries 5xx answers and network errors, not 4xx', async () => {
    const f = fakeFetch([[502, 'bad gateway'], new TypeError('fetch failed'), [200, { ok: 1 }]]);
    await expect(requestJson('grassland', { url: 'http://x', timeoutMs: 1000, attempts: 3, retryDelaysMs: [1, 1] }, f.fn)).resolves.toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(3);

    const g = fakeFetch([[400, 'nope'], [200, {}]]);
    await expect(requestJson('grassland', { url: 'http://x', timeoutMs: 1000, attempts: 3, retryDelaysMs: [1, 1] }, g.fn)).rejects.toBeInstanceOf(ServiceHttpError);
    expect(g.calls).toHaveLength(1);
  });

  it('gives up after the timeout without retrying', async () => {
    let calls = 0;
    const hang: FetchLike = (_url, init) =>
      new Promise((_, reject) => {
        calls++;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    await expect(requestJson('esm', { url: 'http://x', timeoutMs: 20, attempts: 3 }, hang)).rejects.toBeInstanceOf(ServiceTimeoutError);
    expect(calls).toBe(1);
  });
});

describe('ESM', () => {
  const opts = { url: 'https://esm.test', token: 'tok', writebackDomain: 'localhost', runTimeoutMs: 1000, timeoutMs: 1000 };

  it('is configured only with URL and token', () => {
    expect(new EsmClient({ ...opts, url: '' }).configured).toBe(false);
    expect(new EsmClient({ ...opts, token: '' }).configured).toBe(false);
    expect(new EsmClient(opts).configured).toBe(true);
  });

  it('runs in sync mode with the bearer token, and reads a missing timeseries as null', async () => {
    const f = fakeFetch([[200, { success: true, zones: { type: 'FeatureCollection', features: [] } }], [404, 'File not found'], [200, { keys: [] }]]);
    const c = new EsmClient(opts, f.fn);
    await c.run({ cultivation: { id: 'c', year: 2026, crop: 'winterWheat', geom4326: { type: 'Polygon', coordinates: [] } }, parameters: { nrZones: 3 }, meta: { sourceDomain: 'localhost', includeResultInResponse: true } });
    expect(f.calls[0].url).toBe('https://esm.test/esm/run?sync=true');
    expect(f.calls[0].init?.method).toBe('POST');
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(await c.timeseries(2026, 'c')).toBeNull();
    expect(f.calls[1].url).toBe('https://esm.test/results/2026/c/timeseries.json');
    expect(await c.timeseries(2026, 'c')).toEqual({ keys: [] });
  });

  it('reads the zones file: area fractions, numbered by rising yield, invalid features dropped', () => {
    const poly = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const zone = (yieldT: number, area: number) => ({
      type: 'Feature',
      geometry: poly,
      properties: { id: 0, areaInHa: area, yieldInTpHa_model: yieldT, nCropInKgNpHa_model: 180, nMinInKgNpHa_model: 30, nMinSpringInKgNpHa_model: 40, nLossInKgNpHa_model: 20, soilTypeLUFA: 'sL', soilOrganicCarbon: 1.2 },
    });
    const zones = parseEsmZones({ type: 'FeatureCollection', features: [zone(9, 3), zone(6, 1), { type: 'Feature', geometry: null, properties: {} }, { ...zone(7, 1), properties: { areaInHa: 1 } }] });
    expect(zones.map((z) => [z.zoneNo, z.yieldTHa, z.areaFraction])).toEqual([
      [1, 6, 0.25],
      [2, 9, 0.75],
    ]);
    expect(zones[0]).toMatchObject({ nCropKgHa: 180, nMinKgHa: 30, nMinSpringKgHa: 40, nLossKgHa: 20, soilTypeLufa: 'sL', soilOrganicCarbonPct: 1.2 });
    expect(parseEsmZones(null)).toEqual([]);
    expect(parseEsmZones([])).toEqual([]);
  });

  it('accepts only complete timeseries', () => {
    const keys = ['2026-04-01', '2026-04-02'];
    const series = Object.fromEntries(['FRESH_MATTER', 'DRY_MATTER', 'DMC', 'BBCH', 'GDD', 'CBD', 'DTU', 'LAI', 'NFK', 'CNMIN', 'CNUP'].map((k) => [k, [1, 2]]));
    expect(parseCropTimeseries({ keys, ...series, GRAIN_YIELD: [0, 0] })).toMatchObject({ keys, LAI: [1, 2] });
    expect(parseCropTimeseries({ keys, ...series, LAI: [1] })).toBeNull();
    expect(parseCropTimeseries({ message: 'x' })).toBeNull();
  });
});

describe('grassland', () => {
  it('posts to /grassland/predict, with a token only when set', async () => {
    const f = fakeFetch([[503, 'busy'], [200, { fields: [] }], [200, { fields: [] }]]);
    const body = { fields: [], targetDMC: 0.3 };
    await new GrasslandClient({ url: 'https://g.test', token: 't', timeoutMs: 1000 }, f.fn).predict(body);
    expect(f.calls.map((c) => c.url)).toEqual(['https://g.test/grassland/predict', 'https://g.test/grassland/predict']);
    expect((f.calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
    await new GrasslandClient({ url: 'https://g.test', token: '', timeoutMs: 1000 }, f.fn).predict(body);
    expect((f.calls[2].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(new GrasslandClient({ url: '', token: '', timeoutMs: 1 }).configured).toBe(false);
  });

  it('cuts the series at the last cut, computes FM at the target DMC and today', () => {
    const keys = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'];
    const ts = { keys, yieldDM: [1, 2, 3, 4], yieldFM: [5, 6, 7, 8], DMC: [0.2, 0.2, 0.2, 0.2], BBCH: [30, 31, 32, 33], GDD: [1, 2, 3, 4], CumulatedBiologicalDays: [1, 1, 1, 1], DailyTemperatureUnit: [1, 1, 1, 1], LeafAreaIndex: [1, 1, 1, 1], nFK: [50, 50, 50, 50] };
    const p = shapeGrasslandPredictions({ fields: [{ id: 'a', areaHa: 2 }, { id: 'b', areaHa: 2 }], series: new Map([['a', ts]]), year: 2026, today: '2026-05-03', lastHarvest: ['2026-04-01', '2026-05-02'], targetDMC: 0.25, serviceVersion: '0.2.3' });
    const a = p.fields[0];
    expect(a.timeseries.keys).toEqual(['2026-05-02', '2026-05-03', '2026-05-04']);
    expect(a.timeseries.yieldFM_targetDMC).toEqual([8, 12, 16]);
    expect(a.today.yieldDM).toEqual({ perArea: 3, total: 6 });
    // Field b got no series: empty, zero today.
    expect(p.fields[1].timeseries.keys).toEqual([]);
    expect(p.fields[1].today.yieldDM.total).toBe(0);
    expect(p.total!.today.yieldDM).toEqual({ total: 6, perArea: 1.5 });
    expect(p.total!.timeseries.yieldDM).toEqual([1, 1.5, 2]);
    expect(p.serviceVersion).toBe('0.2.3');
  });
});

describe('ISIP', () => {
  const opts = { apiUrl: 'https://isip.test/api', tokenUrl: 'https://login.test/token', username: 'u', password: 'p', clientId: 'cid', clientSecret: 's', timeoutMs: 1000 };

  it('covers the rewrite crops ISIP models', () => {
    expect(ISIP_CROP_CODES.sort()).toEqual(['spring_barley', 'triticale', 'winter_barley', 'winter_rye', 'winter_wheat']);
    expect(isipCropOfCode('triticale')).toBe('winter triticale');
    expect(isipCropOfCode('silage_maize')).toBeUndefined();
  });

  it('needs username, password and client secret', () => {
    expect(new IsipClient({ ...opts, clientSecret: '' }).configured).toBe(false);
    expect(new IsipClient(opts).configured).toBe(true);
  });

  it('gets a password-grant token once, renews it on 401, and queries the cereal model', async () => {
    const f = fakeFetch([[200, { access_token: 'A' }], [200, { nodes: { result: { variables: {} } } }], [200, { nodes: { result: { variables: {} } } }], [401, 'expired'], [200, { access_token: 'B' }], [200, { nodes: { result: { variables: {} } } }]]);
    const c = new IsipClient(opts, f.fn);
    await c.diseaseRisks(50.98, 11.32, 'winter wheat', '2026-04-01');
    await c.diseaseRisks(50.98, 11.32, 'winter wheat', '2026-04-02');
    expect(f.calls.map((x) => x.url.split('?')[0])).toEqual(['https://login.test/token', 'https://isip.test/api/models/siggetreide', 'https://isip.test/api/models/siggetreide']);
    expect(String(f.calls[0].init?.body)).toContain('grant_type=password');
    expect(f.calls[1].url).toContain('crop=winter+wheat&latitude=50.98&longitude=11.32&simulation_date=2026-04-01');
    expect((f.calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer A');
    await c.diseaseRisks(50.98, 11.32, 'winter wheat', '2026-04-03');
    expect((f.calls[5].init?.headers as Record<string, string>).Authorization).toBe('Bearer B');
  });
});
