/**
 * Crop table batch values (conditions and evaluation of a season's crops in one request each)
 * and BBCH observations that shift the phenology model.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'

const run = Math.random().toString(36).slice(2, 8)
const lat = 47 + Math.floor(Math.random() * 300) / 100
const lng = 6 + Math.floor(Math.random() * 300) / 100
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

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
})

describe('crop table', () => {
  it('returns conditions and evaluation per crop and takes BBCH observations', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `table-${run}@example.test`, displayName: 'Tabelle' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Tabelle ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const fieldA = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.003, lat + 0.003) }).expect(201)).body
    const fieldB = (await post(`${base}/fields`, { farmId: farm.id, name: 'B', geometry: rect(lng + 0.004, lat + 0.001, lng + 0.006, lat + 0.003) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${fieldA.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)
    const today = day(0)
    const year = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)
    const season = (await post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const [wheat] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [fieldA.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id, sowingDate: day(-100), expectedYieldTHa: 8, expectedPricePerT: 200 }).expect(201)).body
    const [potato] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [fieldB.id], cropId: crops.find((c) => c.code === 'potatoes')!.id }).expect(201)).body

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    try {
      await owner.insertInto('weather_cells').values({ lat, lng, timezone: 'Europe/Berlin', utc_offset_seconds: 7200, refreshed_at: new Date() }).execute()
      const daily = Array.from({ length: 165 }, (_, i) => {
        const o = i - 150
        const t = 10 + 5 * Math.sin(i / 9)
        return {
          lat, lng, date: day(o), temp_min: t - 5, temp_max: t + 5, temp_mean: t, precipitation: i % 4 === 0 ? 6 : 0,
          humidity_min: 55, humidity_max: 95, humidity_mean: 75, dew_point_min: t - 8, dew_point_max: t - 2, dew_point_mean: t - 5,
          wind_speed_max: 14, wind_speed_mean: 9, wind_gusts_max: 25, wind_gusts_mean: 15, et0: 1.8, radiation_sum: 8,
          soil_temp_0_7: t, soil_temp_7_28: t - 1, soil_moisture_0_7: 0.3, soil_moisture_7_28: 0.31, source: o < 0 ? 'archive' : 'forecast',
        }
      })
      await owner.insertInto('weather_daily').values(daily).execute()
      await owner
        .insertInto('weather_hourly')
        .values(Array.from({ length: 60 }, (_, h) => ({ lat, lng, time: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + (h - 30) * 3_600_000), temp: 12, humidity: 70, precipitation: h === 10 ? 2 : 0, wind_speed: 8, wind_gusts: 15 })))
        .execute()
      await owner
        .insertInto('field_observations')
        .values([
          { organization_id: org.id, field_id: fieldA.id, observed_on: day(-20), index_type: 'ndvi', mean: 0.61, status: 'valid', valid_pixel_pct: 98, processing_version: 'test-0' },
          { organization_id: org.id, field_id: fieldA.id, observed_on: day(-5), index_type: 'ndvi', mean: 0.72, status: 'valid', valid_pixel_pct: 97, processing_version: 'test-1' },
          { organization_id: org.id, field_id: fieldA.id, observed_on: day(-2), index_type: 'ndvi', mean: 0.1, status: 'insufficient_coverage', valid_pixel_pct: 10, processing_version: 'test-2' },
          { organization_id: org.id, field_id: fieldA.id, observed_on: day(-5), index_type: 'lai', mean: 3.4, status: 'valid', valid_pixel_pct: 97, processing_version: 'test-3' },
        ])
        .execute()

      const c = (await get(`${base}/crop-table/conditions?seasonId=${season.id}`).expect(200)).body
      expect(c.rows).toHaveLength(2)
      const a = c.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)
      expect(a).toMatchObject({ fieldId: fieldA.id, sowingDate: day(-100), sowingSource: 'planned', bbchSource: 'model', bbchCalibratable: true, bbchCalibrated: false })
      expect(a.gdd).toBeGreaterThan(0)
      expect(a.bbch).toBeGreaterThan(0)
      expect(a.ndvi).toEqual({ value: 0.72, observedOn: day(-5) })
      expect(a.lai).toEqual({ value: 3.4, observedOn: day(-5) })
      expect(a.precipitation.seasonMm).toBeGreaterThan(0)
      expect(a.precipitation.last7dMm).toEqual(expect.any(Number))
      expect(a.precipitation.last24hMm).toEqual(expect.any(Number))
      expect(a.bars.spraying).toHaveLength(14)
      expect(a.bars.sowing).toHaveLength(14)
      expect(a.bars.weatherRisk).toHaveLength(14)
      expect(a.bars.trafficability).toHaveLength(14)
      const b = c.rows.find((r: { cropCycleId: string }) => r.cropCycleId === potato.id)
      expect(b).toMatchObject({ sowingDate: null, bbchCalibratable: false, ndvi: null })
      // No soil class: no water balance, no trafficability bar.
      expect(b.bars.trafficability).toBeNull()

      // A BBCH observation shifts the model to the observed stage.
      const observed = Math.max(0, a.bbch - 5)
      await post(`${base}/crop-cycles/${wheat.id}/bbch-observations`, { bbch: observed }).expect(204)
      const c2 = (await get(`${base}/crop-table/conditions?seasonId=${season.id}`).expect(200)).body
      const a2 = c2.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)
      expect(a2).toMatchObject({ bbchCalibrated: true, bbchObservedToday: observed })
      expect(Math.abs(a2.bbch - observed)).toBeLessThanOrEqual(1)
      const field = (await get(`${base}/fields/${fieldA.id}/conditions`).expect(200)).body
      expect(field.phenology).toMatchObject({ calibrated: true })
      await post(`${base}/crop-cycles/${potato.id}/bbch-observations`, { bbch: 20 }).expect(400)
      await post(`${base}/crop-cycles/${wheat.id}/bbch-observations`, { bbch: 20, date: day(3) }).expect(400)
      await http().delete(`/v1${base}/crop-cycles/${wheat.id}/bbch-observations/${today}`).set(auth).expect(204)
      await http().delete(`/v1${base}/crop-cycles/${wheat.id}/bbch-observations/${today}`).set(auth).expect(404)
      const c3 = (await get(`${base}/crop-table/conditions?seasonId=${season.id}`).expect(200)).body
      expect(c3.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)).toMatchObject({ bbchCalibrated: false, bbchObservedToday: null })

      const e = (await get(`${base}/crop-table/evaluation?seasonId=${season.id}`).expect(200)).body
      expect(e.currency).toEqual(expect.any(String))
      const ea = e.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)
      // Planned revenue 8 t/ha × 200 €/t without costs.
      expect(ea).toMatchObject({ revenueBasis: 'planned', db2PerHa: 1600, documentedYieldTHa: null, yieldMapTHa: null })
      expect(ea.nNeedKgHa).toEqual(expect.any(Number))
      await get(`${base}/crop-table/conditions?seasonId=not-a-uuid`).expect(400)
    } finally {
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', 'in', [fieldA.id, fieldB.id]).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', lat).where('lng', '=', lng).execute()
      await owner.destroy()
    }
  })
})
