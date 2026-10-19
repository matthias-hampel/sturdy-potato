/**
 * Condition bars, hourly spray levels, phenology, water balance and trafficability of a field,
 * computed from stored weather (inserted here; the worker writes it in production).
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

describe('field conditions', () => {
  it('computes bars, spray hours, phenology, water balance and trafficability from stored weather', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `cond-${run}@example.test`, displayName: 'Bedingungen' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Bedingungen ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.003, lat + 0.003) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)
    const today = day(0)
    const year = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)
    const season = (await post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id, sowingDate: day(-60) }).expect(201)

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    try {
      await owner.insertInto('weather_cells').values({ lat, lng, timezone: 'Europe/Berlin', utc_offset_seconds: 7200, refreshed_at: new Date() }).execute()
      const daily = Array.from({ length: 135 }, (_, i) => {
        const o = i - 120
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
        .values(Array.from({ length: 60 }, (_, h) => ({ lat, lng, time: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + (h - 6) * 3_600_000), temp: 12, humidity: 70, precipitation: h === 10 ? 2 : 0, wind_speed: h < 20 ? 8 : 30, wind_gusts: h < 20 ? 15 : 50 })))
        .execute()

      const c = (await get(`${base}/fields/${field.id}/conditions`).expect(200)).body
      expect(c.cropCycle).toMatchObject({ sowingDate: day(-60), sowingSource: 'planned' })
      expect(c.bars.spraying).toHaveLength(14)
      expect(c.bars.spraying[0]).toMatchObject({ date: today })
      expect(c.bars.sowing.length).toBe(14)
      expect(c.bars.weatherRisk.length).toBe(14)
      expect(c.sprayHours.length).toBeGreaterThan(40)
      // Strong wind later in the window makes spraying worse than in the calm hours.
      expect(Math.max(...c.sprayHours.map((h: { level: number }) => h.level))).toBeGreaterThan(c.sprayHours[0].level)
      expect(c.phenology.gdd).toBeGreaterThan(0)
      expect(c.phenology.currentBbch).toBeGreaterThanOrEqual(0)
      expect(c.waterBalance.awcMm).toBeGreaterThan(0)
      expect(c.waterBalance.days.length).toBeGreaterThan(30)
      expect(c.bars.trafficability).toHaveLength(14)

      const tractor = (await post(`${base}/equipment`, {
        name: 'Fendt', class: 'machine', category: 'tractor_small', operatingMassKg: 5200, frontAxleFraction: 0.444,
        frontTyre: { size: '440/65R24', widthM: 0.44, recommendedPressureKpa: 120 }, rearTyre: { size: '540/65R34', widthM: 0.54, recommendedPressureKpa: 120 },
      }).expect(201)).body
      const t = (await get(`${base}/fields/${field.id}/trafficability?equipmentId=${tractor.id}`).expect(200)).body
      expect(t).toMatchObject({ sciReady: true, frontKpa: 120, rearKpa: 120 })
      expect(t.days[0]).toMatchObject({ date: today })
      expect(t.days[0].sci).toEqual(expect.any(Number))
      expect(t.days[0].band).toEqual(expect.any(String))
      await get(`${base}/fields/${field.id}/trafficability?equipmentId=${tractor.id}&frontKpa=5`).expect(400)
    } finally {
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', lat).where('lng', '=', lng).execute()
      await owner.destroy()
    }
  })
})
