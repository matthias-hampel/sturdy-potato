/**
 * Model services end to end without real services: the not-configured answers, an ESM run
 * (API request → worker job with a fake ESM → N model on productivity zones), grassland
 * predictions with a fake grassland-api, and ISIP disease risk stored by the worker's job (fake
 * ISIP) showing up as the disease bar of the field conditions.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'kysely'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import type { Job } from '../src/jobs/runner.js'
import { DISEASE_CROP, diseaseCropHandler, IsipClient } from '../src/modules/model-services/disease.js'
import { ESM_RUN, EsmClient, esmRunHandler } from '../src/modules/model-services/esm.js'
import { GrasslandClient } from '../src/modules/model-services/grassland.js'
import type { FetchLike } from '../src/modules/model-services/http.js'
import { ModelServicesService } from '../src/modules/model-services/model-services.service.js'

const run = Math.random().toString(36).slice(2, 8)
const lat = 47 + Math.floor(Math.random() * 300) / 100
const lng = 6 + Math.floor(Math.random() * 300) / 100
const rect = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })
const multi = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'MultiPolygon', coordinates: [rect(x0, y0, x1, y1).coordinates] })
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const jobsDb = createKysely(config.jobsDatabaseUrl, 1)
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)

/** A fetch answering in order and recording the requests. */
function fake(answers: [number, unknown][]) {
  const calls: { url: string; body: unknown }[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
    const [status, body] = answers.shift() ?? [500, 'no answer']
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, calls }
}

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  await app?.close()
  await Promise.all([jobsDb.destroy(), owner.destroy()])
})

describe('model services', () => {
  it('answers not configured, runs the ESM N model, predicts grassland and shows the disease risk', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `models-${run}@example.test`, displayName: 'Modelle' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Modelle ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const [x0, y0, x1, y1] = [lng + 0.001, lat + 0.001, lng + 0.005, lat + 0.003]
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(x0, y0, x1, y1) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)
    const today = day(0)
    const year = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)
    const season = (await post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id, sowingDate: day(-60) }).expect(201)).body
    const models = app.get(ModelServicesService)

    try {
      // --- Not configured (no URLs or credentials in the test environment) -----------------------
      expect((await get(`${base}/crop-cycles/${cycle.id}/nitrogen-model`).expect(200)).body).toMatchObject({
        configured: false, esmCrop: 'winterWheat', hasNitrogenModel: true, latestRun: null, run: null, zones: [],
      })
      const refused = (await post(`${base}/crop-cycles/${cycle.id}/nitrogen-model/runs`, {}).expect(503)).body
      expect(refused).toMatchObject({ code: 'service_not_configured', details: { service: 'esm' } })
      expect((await get(`${base}/predictions/timeseries?cropCycleId=${cycle.id}`).expect(200)).body).toMatchObject({ configured: false, available: false, timeseries: null, harvestYear: year })
      expect((await get(`${base}/predictions/timeseries?fieldId=${field.id}&year=${year}`).expect(200)).body.cropCycleId).toBe(cycle.id)
      await get(`${base}/predictions/timeseries?fieldId=${field.id}`).expect(400)
      expect((await post(`${base}/predictions/grassland`, { fieldIds: [field.id], targetDMC: 0.3 }).expect(201)).body).toEqual({ configured: false, serviceVersion: null, total: null, fields: [] })
      expect((await get(`${base}/crop-cycles/${cycle.id}/grassland-prediction`).expect(200)).body).toEqual({ configured: false, applicable: false, prediction: null })

      // --- ESM run: the API stores the request, the worker sends it and stores the zones -----------
      const props = (y: number) => ({ areaInHa: 1, yieldInTpHa_model: y, nCropInKgNpHa_model: 150, nMinInKgNpHa_model: 30, nMinSpringInKgNpHa_model: 40, nLossInKgNpHa_model: 20, soilTypeLUFA: 'sL', soilOrganicCarbon: 1.1 })
      const xm = (x0 + x1) / 2
      const esm = fake([
        [200, { cultivationId: cycle.id, executionId: 'exec-1', success: true, zones: { type: 'FeatureCollection', features: [
          { type: 'Feature', geometry: rect(x0, y0, xm, y1), properties: props(9) },
          { type: 'Feature', geometry: rect(xm, y0, x1, y1), properties: props(6) },
        ] } }],
        [200, { cultivationId: cycle.id, executionId: 'exec-2', success: false, zones: { type: 'FeatureCollection', features: [] } }],
      ])
      const esmClient = new EsmClient({ url: 'https://esm.test', token: 'tok', writebackDomain: 'localhost', runTimeoutMs: 1000, timeoutMs: 1000 }, esm.fn)
      models.esm = esmClient
      const queued = (await post(`${base}/crop-cycles/${cycle.id}/nitrogen-model/runs`, { zoneCount: 2 }).expect(201)).body
      expect(queued).toMatchObject({ status: 'queued', zoneCount: 2 })
      // A second request while one is pending returns it.
      expect((await post(`${base}/crop-cycles/${cycle.id}/nitrogen-model/runs`, { zoneCount: 2 }).expect(201)).body.id).toBe(queued.id)
      const job = await owner.selectFrom('jobs').selectAll().where('kind', '=', ESM_RUN).where('dedupe_key', '=', queued.id).executeTakeFirstOrThrow()
      await owner.deleteFrom('jobs').where('id', '=', job.id).execute()
      await esmRunHandler(jobsDb, esmClient)({ ...job, payload: job.payload } as unknown as Job)
      expect(esm.calls[0].url).toBe('https://esm.test/esm/run?sync=true')
      expect(esm.calls[0].body).toMatchObject({
        cultivation: { id: cycle.id, year, crop: 'winterWheat', sowingDate: `${day(-60)}T00:00:00.000Z`, geom4326: { type: 'MultiPolygon' }, soil: { map: { features: [{ properties: { soilTypeLUFA: 'sL' } }] } } },
        parameters: { nrZones: 2 },
        meta: { sourceDomain: 'localhost', includeResultInResponse: true },
      })

      // Productivity zones split the other way: each overlaps both ESM zones half and half.
      const ym = (y0 + y1) / 2
      const geom = await owner.selectFrom('field_current_geometry').select('id').where('field_id', '=', field.id).executeTakeFirstOrThrow()
      const zoning = await owner.insertInto('zonings').values({ organization_id: org.id, field_id: field.id, geometry_version_id: geom.id!, source: 'productivity', zone_count: 2, is_custom: true }).returning('id').executeTakeFirstOrThrow()
      for (const [no, g] of [[1, multi(x0, y0, x1, ym)], [2, multi(x0, ym, x1, y1)]] as const) {
        await sql`INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha) VALUES (${org.id}, ${zoning.id}, ${no}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326), 1)`.execute(owner)
      }
      const m = (await get(`${base}/crop-cycles/${cycle.id}/nitrogen-model?zoningId=${zoning.id}`).expect(200)).body
      expect(m.run).toMatchObject({ id: queued.id, status: 'succeeded', executionId: 'exec-1' })
      expect(m.modelZones.map((z: { zoneNo: number; yieldTHa: number; areaFraction: number }) => [z.zoneNo, z.yieldTHa, z.areaFraction])).toEqual([[1, 6, 0.5], [2, 9, 0.5]])
      expect(m.zones).toHaveLength(2)
      for (const z of m.zones) {
        expect(z.coverage).toBeGreaterThan(0.99)
        expect(z.yieldTHa).toBeCloseTo(7.5, 1)
        // Winter wheat: 23 × 7.5 + 0.2193 − 30 − 40 + 20 + 25 residual.
        expect(z.nDemandKgHa).toBeCloseTo(23 * z.yieldTHa + 0.2193 - 30 - 40 + 20 + 25, 4)
        expect(z.soilTypeLufa).toBe('sL')
      }

      // A failed run is recorded; the last good run stays.
      await owner.updateTable('esm_runs').set({ requested_at: new Date(Date.now() - 3_600_000) }).where('id', '=', queued.id).execute()
      const second = (await post(`${base}/crop-cycles/${cycle.id}/nitrogen-model/runs`, {}).expect(201)).body
      expect(second.zoneCount).toBe(5)
      await owner.deleteFrom('jobs').where('kind', '=', ESM_RUN).where('dedupe_key', '=', second.id).execute()
      await esmRunHandler(jobsDb, esmClient)({ id: 0, kind: ESM_RUN, payload: { runId: second.id } } as unknown as Job)
      const after = (await get(`${base}/crop-cycles/${cycle.id}/nitrogen-model`).expect(200)).body
      expect(after.latestRun).toMatchObject({ id: second.id, status: 'failed', error: expect.any(String) })
      expect(after.run.id).toBe(queued.id)

      // The timeseries of a configured ESM: 404 = not modelled yet.
      models.esm = new EsmClient({ url: 'https://esm.test', token: 'tok', writebackDomain: 'localhost', runTimeoutMs: 1000, timeoutMs: 1000 }, fake([[404, 'File not found']]).fn)
      expect((await get(`${base}/predictions/timeseries?cropCycleId=${cycle.id}`).expect(200)).body).toMatchObject({ configured: true, available: false })

      // --- Grassland with a fake grassland-api -------------------------------------------------
      const keys = [day(-1), day(0), day(1)]
      const calendarYear = Number(today.slice(0, 4))
      const grass = fake([[200, { serviceVersion: '0.2.3', fields: [{ id: field.id, timeseries: { keys, DMC: [0.2, 0.2, 0.2], yieldDM: [1, 2, 3], yieldFM: [5, 10, 15], BBCH: [31, 32, 33], GDD: [1, 2, 3], CumulatedBiologicalDays: [1, 1, 1], DailyTemperatureUnit: [1, 1, 1], LeafAreaIndex: [1, 1, 1], nFK: [60, 60, 60] } }] }]])
      models.grassland = new GrasslandClient({ url: 'https://grass.test', token: '', timeoutMs: 1000 }, grass.fn)
      const g = (await post(`${base}/predictions/grassland`, { fieldIds: [field.id], year: calendarYear, lastHarvest: [day(-1)], targetDMC: 0.25 }).expect(201)).body
      expect(grass.calls[0]).toMatchObject({ url: 'https://grass.test/grassland/predict', body: { year: calendarYear, targetDMC: 0.25, lastHarvest: [day(-1)], fields: [{ id: field.id, geometry: { type: 'MultiPolygon' } }] } })
      expect(g).toMatchObject({ configured: true, serviceVersion: '0.2.3' })
      expect(g.fields[0].timeseries.yieldFM_targetDMC).toEqual([4, 8, 12])
      expect(g.fields[0].today.yieldDM.perArea).toBe(2)
      await post(`${base}/predictions/grassland`, { fieldIds: [field.id], targetDMC: 2 }).expect(400)

      // --- Disease risk: the worker's job with a fake ISIP, read back as the disease bar -----------
      const { rows: demand } = await sql<{ crop_cycle_id: string }>`SELECT crop_cycle_id FROM app.disease_risk_demand(${['winter_wheat']}::text[], interval '22 hours')`.execute(jobsDb)
      expect(demand.map((d) => d.crop_cycle_id)).toContain(cycle.id)
      await owner.insertInto('weather_cells').values({ lat: Math.round(((y0 + y1) / 2) * 100) / 100, lng: Math.round(((x0 + x1) / 2) * 100) / 100, timezone: 'Europe/Berlin', utc_offset_seconds: 7200, refreshed_at: new Date() }).execute()
      const cell = { lat: Math.round(((y0 + y1) / 2) * 100) / 100, lng: Math.round(((x0 + x1) / 2) * 100) / 100 }
      await owner
        .insertInto('weather_daily')
        .values(Array.from({ length: 30 }, (_, i) => ({ ...cell, date: day(i - 15), temp_min: 5, temp_max: 15, temp_mean: 10, precipitation: 0, humidity_min: 50, humidity_max: 90, humidity_mean: 70, dew_point_min: 2, dew_point_max: 8, dew_point_mean: 5, wind_speed_max: 10, wind_speed_mean: 6, wind_gusts_max: 20, wind_gusts_mean: 12, et0: 2, radiation_sum: 10, soil_temp_0_7: 10, soil_temp_7_28: 9, soil_moisture_0_7: 0.3, soil_moisture_7_28: 0.3, source: i < 15 ? 'archive' : 'forecast' })))
        .execute()
      const isipFetch = fake([
        [200, { access_token: 'T' }],
        [200, { nodes: { result: { variables: { date: { data: [day(0), day(1)] }, 'brown rust': { data: [1, 3] }, 'yellow rust': { data: [0, 2] }, 'net blotch': { data: [3, 3] } } } } }],
      ])
      const isip = new IsipClient({ apiUrl: 'https://isip.test', tokenUrl: 'https://login.test', username: 'u', password: 'p', clientId: 'c', clientSecret: 's', timeoutMs: 1000 }, isipFetch.fn)
      await diseaseCropHandler(jobsDb, isip)({ id: 0, kind: DISEASE_CROP, payload: { cropCycleId: cycle.id, organizationId: org.id, cropCode: 'winter_wheat', lat: cell.lat, lng: cell.lng, simulationDate: `${year}-04-15` } } as unknown as Job)
      expect(isipFetch.calls[1].url).toContain('/models/siggetreide?crop=winter+wheat')
      const { rows: after22h } = await sql<{ crop_cycle_id: string }>`SELECT crop_cycle_id FROM app.disease_risk_demand(${['winter_wheat']}::text[], interval '22 hours')`.execute(jobsDb)
      expect(after22h.map((d) => d.crop_cycle_id)).not.toContain(cycle.id)

      const c = (await get(`${base}/fields/${field.id}/conditions`).expect(200)).body
      expect(c.disease).toMatchObject({ configured: false, supported: true, refreshedAt: expect.any(String) })
      expect(c.disease.diseases.map((d: { key: string }) => d.key)).toEqual(['brownRust', 'dtr', 'yellowRust', 'powderyMildew', 'septoriaTritici'])
      expect(c.bars.disease.slice(0, 3).map((d: { value: number | null }) => d.value)).toEqual([1, 3, null])
      expect(c.bars.disease[1].reasons.map((r: { key: string }) => r.key)).toEqual(['reason.disease.brownRust', 'reason.disease.yellowRust'])
      // Net blotch is a barley disease: not counted for wheat.
      expect(c.disease.diseases.find((d: { key: string }) => d.key === 'brownRust').days).toEqual([{ date: day(0), value: 1 }, { date: day(1), value: 3 }])
    } finally {
      models.esm = new EsmClient()
      models.grassland = new GrasslandClient()
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', Math.round(((y0 + y1) / 2) * 100) / 100).where('lng', '=', Math.round(((x0 + x1) / 2) * 100) / 100).execute()
    }
  })
})
