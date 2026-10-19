/**
 * Maize dry-matter monitoring end to end, with the maize-dmc-api client replaced by a fake
 * (no real calls): the not-configured state, settings, forecast with same-day reuse and stored
 * weather, measurements calibrating the next forecast, variety offsets, the raster proxy's
 * tenant check, and the harvest detection job as agmeo_jobs.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'
import { MaizeDmcClient } from '../src/modules/maize-dmc/client.js'
import { runHarvestDetection } from '../src/modules/maize-dmc/harvest-detection.job.js'
import type { PredictBody, PredictResponse } from '../src/modules/maize-dmc/types.js'

const run = Math.random().toString(36).slice(2, 8)
const lat = 47 + Math.floor(Math.random() * 300) / 100
const lng = 6 + Math.floor(Math.random() * 300) / 100
const rect = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const uuid = () => crypto.randomUUID()

/** Fake maize-dmc-api: DM rising 0.5 pp a day from 30 % today, shifted by a calibration. */
class FakeClient {
  configured = true
  calls: PredictBody[] = []
  async predict(body: PredictBody): Promise<PredictResponse> {
    this.calls.push(body)
    const shift = body.calibration ? ('offset' in body.calibration ? body.calibration.offset : body.calibration.measured_dm - 0.28) : 0
    return {
      execution_id: uuid(),
      created_at: new Date().toISOString(),
      model_version: 'fake-1',
      scene: { date: day(-2), age_days: 2, source: 'esm-sat-api' },
      calibration: body.calibration ? ('offset' in body.calibration ? { mode: 'offset', measured_dm: null, measured_at: null, offset: body.calibration.offset } : { mode: 'field', measured_dm: body.calibration.measured_dm, measured_at: body.calibration.measured_at, offset: shift }) : null,
      field: { area_ha: 4, centroid: [lng, lat], valid_pixels: 400, pixel_resolution_m: 10, bounding_box_epsg_3857: [1113194.9, 6800125.5, 1113394.9, 6800325.5] },
      daily_predictions: Array.from({ length: 8 }, (_, i) => ({
        date: day(i), dm_mean: 0.3 + 0.005 * i + shift, dm_p10: 0.29 + 0.005 * i + shift, dm_p90: 0.31 + 0.005 * i + shift, dm_mean_uncalibrated: body.calibration ? 0.3 + 0.005 * i : null,
        accumulated_gdd: 1300 + 10 * i, temperature_mean_c: 15, valid_pixels: 400, url_png: '', url_tiff: '',
      })),
      weather: { days_total: 140, days_supplied: body.weather?.daily.length ?? 0, days_fetched: 0, days_fallback: 0, sources: ['client'] },
    }
  }
  async result() {
    return { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png', bbox3857: '1,2,3,4' }
  }
}

async function makeApp(client?: FakeClient) {
  let builder = Test.createTestingModule({ imports: [AppModule] })
  if (client) builder = builder.overrideProvider(MaizeDmcClient).useValue(client)
  const app = (await builder.compile()).createNestApplication<INestApplication<App>>()
  app.setGlobalPrefix('v1')
  await app.init()
  return app
}

let plain: INestApplication<App>
let faked: INestApplication<App>
const fake = new FakeClient()

beforeAll(async () => {
  plain = await makeApp()
  faked = await makeApp(fake)
})
afterAll(async () => {
  await plain?.close()
  await faked?.close()
})

describe('maize DMC', () => {
  it('works without the service, then forecasts, calibrates and detects with it', async () => {
    const http = (app: INestApplication<App>) => request(app.getHttpServer())
    const res = await http(plain).post('/v1/auth/dev/sign-in').send({ email: `dmc-${run}@example.test`, displayName: 'Mais' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const api = (app: INestApplication<App>) => ({
      get: (url: string) => http(app).get(`/v1${url}`).set(auth),
      post: (url: string, body: object) => http(app).post(`/v1${url}`).set(auth).send(body),
      put: (url: string, body: object) => http(app).put(`/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => http(app).patch(`/v1${url}`).set(auth).send(body),
      del: (url: string) => http(app).delete(`/v1${url}`).set(auth),
    })
    const p = api(plain)
    const f = api(faked)
    const org = (await p.post('/orgs', { name: `Mais ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await p.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await p.post(`${base}/fields`, { farmId: farm.id, name: 'Maisschlag', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.003, lat + 0.003) }).expect(201)).body
    const today = day(0)
    const year = Number(today.slice(0, 4))
    const seasons = (await p.post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect(201)).body
    const season = seasons.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await p.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const silage = crops.find((c) => c.code === 'silage_maize')!
    const variety = (await p.post(`${base}/varieties`, { cropId: silage.id, name: `KWS Test ${run}` }).expect(201)).body
    await p.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: silage.id, varietyId: variety.id, sowingDate: day(-120) }).expect(201)

    // Not configured: the overview lists the crop and says so; forecasts answer 503.
    let overview = (await p.get(`${base}/maize-dmc?harvestYear=${year}`).expect(200)).body
    expect(overview.configured).toBe(false)
    expect(overview.cycles).toHaveLength(1)
    const cycle = overview.cycles[0]
    expect(cycle).toMatchObject({ fieldId: field.id, kind: 'silage', varietyName: `KWS Test ${run}`, sowingDate: day(-120), missing: ['fao_maturity'], latestRun: null })
    expect((await p.get(`${base}/maize-dmc/status`).expect(200)).body).toEqual({ configured: false })
    expect((await p.get(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/forecast`).expect(503)).body.code).toBe('dmc_not_configured')
    // A measured DM is stored without the service (no model value, no offset).
    const m0 = (await p.post(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/measurements`, { measurementDate: day(-3), measuredDm: 0.27 }).expect(201)).body
    expect(m0).toMatchObject({ measuredDm: expect.closeTo(0.27, 5), modelDmAtMeasurement: null, offset: null, supersededAt: null })
    await p.post(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/measurements`, { measurementDate: day(-3), offset: -0.02 }).expect(503)
    await p.del(`${base}/maize-dmc/measurements/${m0.id}`).expect(204)

    // FAO maturity on the variety; the cycle can be forecast now.
    await p.put(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/settings`, { faoMaturity: 1000 }).expect(400)
    await p.put(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/settings`, { faoMaturity: 250, applyToVariety: true }).expect(200)
    overview = (await p.get(`${base}/maize-dmc?harvestYear=${year}`).expect(200)).body
    expect(overview.cycles[0]).toMatchObject({ faoMaturity: 250, faoSource: 'variety', missing: [] })

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const jobs = createKysely(process.env.JOBS_DATABASE_URL ?? 'postgres://agmeo_jobs_worker:agmeo_jobs_worker@localhost:5434/agmeo', 1)
    try {
      // Stored weather of the field's cell → sent as the weather block.
      await owner.insertInto('weather_cells').values({ lat: Math.round((lat + 0.002) * 100) / 100, lng: Math.round((lng + 0.002) * 100) / 100, timezone: 'Europe/Berlin', utc_offset_seconds: 7200, refreshed_at: new Date() }).execute()
      const cell = { lat: Math.round((lat + 0.002) * 100) / 100, lng: Math.round((lng + 0.002) * 100) / 100 }
      await owner
        .insertInto('weather_daily')
        .values(Array.from({ length: 128 }, (_, i) => ({ ...cell, date: day(i - 120), temp_min: 10, temp_max: 22, temp_mean: 16, precipitation: i % 5 === 0 ? 4 : 0, source: i < 120 ? 'archive' : 'forecast' })))
        .execute()

      const fc = (await f.get(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/forecast`).expect(200)).body
      expect(fc).toMatchObject({ mode: 'standard', cached: false, kind: 'silage', faoMaturity: 250, sowingDate: day(-120), calibration: null })
      expect(fc.dailyPredictions).toHaveLength(8)
      expect(fc.dailyPredictions[0].pngPath).toBe(`/orgs/${org.id}/maize-dmc/runs/${fc.executionId}/results/${today}?output=png&resolution=10m`)
      expect(fc.harvest).toMatchObject({ evaluatedFor: today })
      // 33.5 % on the last forecast day: the window closes beyond the horizon (extrapolated).
      expect(fc.harvestWindow).toMatchObject({ start: today, end: expect.any(String), estimated: true })
      expect(fc.bounds[0]).toBeCloseTo(10, 3)
      expect(fake.calls[0]).toMatchObject({ sowing_date: day(-120), fao_maturity: 250, resolution: '10m' })
      expect(fake.calls[0].weather?.daily).toHaveLength(128)
      // Same day: reused, no second call.
      expect((await f.get(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/forecast`).expect(200)).body).toMatchObject({ executionId: fc.executionId, cached: true })
      expect(fake.calls).toHaveLength(1)

      // The raster proxy only serves this organization's runs.
      const png = await f.get(`${base}/maize-dmc/runs/${fc.executionId}/results/${today}?band=p10`).expect(200)
      expect(png.headers['content-type']).toBe('image/png')
      await f.get(`${base}/maize-dmc/runs/${uuid()}/results/${today}`).expect(404)
      await f.get(`${base}/maize-dmc/runs/not-a-uuid/results/${today}`).expect(400)

      // A measurement gets today's model value as reference and calibrates the next forecast.
      const m = (await f.post(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/measurements`, { measurementDate: today, measuredDm: 0.28, notes: 'Probe Häcksler' }).expect(201)).body
      expect(m.modelDmAtMeasurement).toBeCloseTo(0.3, 5)
      expect(m.offset).toBeCloseTo(-0.02, 5)
      const calibrated = (await f.get(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/forecast`).expect(200)).body
      expect(calibrated).toMatchObject({ mode: 'calibrated', calibration: { kind: 'measurement', measuredDm: expect.closeTo(0.28, 5) } })
      expect(fake.calls.at(-1)?.calibration).toMatchObject({ measured_at: today })
      // Correcting the value supersedes nothing but recomputes the offset.
      expect((await f.patch(`${base}/maize-dmc/measurements/${m.id}`, { measuredDm: 0.29 }).expect(200)).body.offset).toBeCloseTo(-0.01, 5)
      expect((await f.get(`${base}/maize-dmc/cycles/${cycle.cropCycleId}/measurements`).expect(200)).body).toHaveLength(1)

      // Variety offsets: basis, apply (batch), revoke.
      const basis = (await f.get(`${base}/maize-dmc/offsets/basis?harvestYear=${year}&varietyIds=${variety.id}&from=${day(-30)}&to=${today}`).expect(200)).body
      expect(basis.points).toHaveLength(1)
      expect(basis.suggestedOffset).toBeCloseTo(-0.01, 5)
      expect((await f.get(`${base}/maize-dmc/offsets/varieties?harvestYear=${year}`).expect(200)).body).toEqual([{ varietyId: variety.id, variety: `KWS Test ${run}`, cycleCount: 1, measurementCount: 1 }])
      await f.post(`${base}/maize-dmc/offsets`, { harvestYear: year, varietyIds: [variety.id], offset: -0.015, suggestedOffset: basis.suggestedOffset, basis: { from: day(-30), to: today, calibrationIds: [basis.points[0].calibrationId] }, comment: 'Test' }).expect(201)
      let batches = (await f.get(`${base}/maize-dmc/offsets?harvestYear=${year}`).expect(200)).body
      expect(batches).toHaveLength(1)
      expect(batches[0]).toMatchObject({ offset: expect.closeTo(-0.015, 5), basisCount: 1, supersededAt: null, appliedBy: 'Mais' })
      overview = (await f.get(`${base}/maize-dmc?harvestYear=${year}`).expect(200)).body
      expect(overview.cycles[0]).toMatchObject({ varietyOffset: expect.closeTo(-0.015, 5), latestRun: { mode: 'calibrated' }, latestMeasurement: { id: m.id } })
      // The calibrated run of today (anchored on 28 % measured vs. 28 % fake baseline).
      expect(overview.cycles[0].dmToday).toBeCloseTo(0.3, 5)
      expect((await f.post(`${base}/maize-dmc/offsets/revoke`, { ids: [batches[0].varieties[0].rowId] }).expect(200)).body).toEqual({ revoked: 1 })
      batches = (await f.get(`${base}/maize-dmc/offsets?harvestYear=${year}`).expect(200)).body
      expect(batches[0].supersededAt).not.toBeNull()

      // Harvest detection as the jobs role: a sudden NDVI drop after the standard run's DM passed 27 %.
      // Back-date the standard run so its window covers the scenes.
      await owner.updateTable('maize_dmc_runs').set({ run_date: day(-7), pred_from_date: day(-7) }).where('crop_cycle_id', '=', cycle.cropCycleId).where('mode', '=', 'standard').execute()
      const scene = await owner
        .insertInto('satellite_scenes')
        .values({ scene_id: `dmc-test-${run}`, platform: 'sentinel-2a', acquired_at: new Date(), processing_version: 'test' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const obs = (offset: number, ndvi: number) => ({ organization_id: org.id, field_id: field.id, observed_on: day(offset), index_type: 'ndvi', mean: ndvi, valid_pixel_pct: 100, status: 'valid', processing_version: `test-${offset}`, scene_id: scene.id })
      await owner.insertInto('field_observations').values([obs(-7, 0.72), obs(-5, 0.7), obs(-3, 0.2), obs(-1, 0.19)]).execute()
      // Today's DM sample proves the crop was still standing after the drop: rejected.
      const result = await runHarvestDetection(jobs, year)
      expect(result.fields).toBeGreaterThanOrEqual(1)
      const detection = await owner.selectFrom('maize_dmc_harvest_detections').selectAll().where('crop_cycle_id', '=', cycle.cropCycleId).executeTakeFirst()
      expect(detection).toMatchObject({ trust: 'high', status: 'rejected' })
      expect(detection?.rejected_reason).toMatch(/crop sampled/)
      // Without the sample the drop is confirmed and overrides the probability.
      await f.del(`${base}/maize-dmc/measurements/${m.id}`).expect(204)
      await owner.deleteFrom('maize_dmc_harvest_detections').where('crop_cycle_id', '=', cycle.cropCycleId).execute()
      await runHarvestDetection(jobs, year)
      overview = (await f.get(`${base}/maize-dmc?harvestYear=${year}`).expect(200)).body
      expect(overview.cycles[0]).toMatchObject({ harvestDetected: { status: 'confirmed', trust: 'high', windowStart: day(-5), windowEnd: day(-3) }, harvest: { probability: 1, status: 'harvested' } })
      const status = await owner.selectFrom('maize_dmc_satellite_status').selectAll().where('crop_cycle_id', '=', cycle.cropCycleId).executeTakeFirst()
      expect(status).toMatchObject({ latest_clear_date: day(-1) })
      await owner.deleteFrom('satellite_scenes').where('id', '=', scene.id).execute()
    } finally {
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', Math.round((lat + 0.002) * 100) / 100).where('lng', '=', Math.round((lng + 0.002) * 100) / 100).execute()
      await owner.destroy()
      await jobs.destroy()
    }
  })
})
