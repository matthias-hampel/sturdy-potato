/**
 * Per-crop model details of the crop tabs: the season's water balances with irrigation and a
 * rooting-depth override, and the BBCH dialog's phenology with an observation, computed from
 * stored weather inserted here.
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

describe('crop models', () => {
  it('serves water balances, root depths and the phenology with observations', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `seasoncond-${run}@example.test`, displayName: 'Saison' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Saison ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.003, lat + 0.003) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)
    const today = day(0)
    const year = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0)
    const season = (await post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id, sowingDate: day(-90) }).expect(201)).body
    await post(`${base}/operations`, { farmId: farm.id, type: 'irrigation', title: 'Beregnung', plannedOn: day(-10), details: { waterMm: 20, method: 'sprinkler' }, fields: [{ fieldId: field.id }] }).expect(201)

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
        .values(Array.from({ length: 60 }, (_, h) => ({ lat, lng, time: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + (h - 6) * 3_600_000), temp: 12, humidity: 70, precipitation: 0, wind_speed: 8, wind_gusts: 15 })))
        .execute()

      // Rooting depth override and the balance's days with the irrigation event.
      await http().patch(`/v1${base}/water-balances/root-depths`).set(auth).send({ updates: [{ cropCycleId: cycle.id, rootDepthM: 0.8 }] }).expect(200)
      const [wb] = (await get(`${base}/water-balances?seasonId=${season.id}`).expect(200)).body
      expect(wb).toMatchObject({ cropCycleId: cycle.id, rootDepthM: 0.8, rootDepthOverrideM: 0.8 })
      expect(wb.events).toEqual([expect.objectContaining({ date: day(-10), mm: 20, method: 'sprinkler', status: 'planned' })])
      expect(wb.days.find((d: { date: string }) => d.date === day(-10)).irrigationMm).toBe(20)
      expect(wb.fcMm).toBeGreaterThan(wb.pwpMm)

      // An observed stage shifts the model; the dialog shows it with the model run.
      const before = (await get(`${base}/crop-cycles/${cycle.id}/phenology`).expect(200)).body
      expect(before).toMatchObject({ supported: true, sowingDate: day(-90), sowingSource: 'planned', observations: [] })
      expect(before.days[before.days.length - 1].date).toBe(day(7))
      const modelled = before.days.find((d: { date: string }) => d.date === day(-5))
      const observed = Math.min(modelled.bbch + 4, 99)
      await post(`${base}/crop-cycles/${cycle.id}/bbch-observations`, { date: day(-5), bbch: observed }).expect(204)
      const after = (await get(`${base}/crop-cycles/${cycle.id}/phenology`).expect(200)).body
      expect(after.observations).toEqual([expect.objectContaining({ observedOn: day(-5), observedBbch: observed })])
      expect(after.days.find((d: { date: string }) => d.date === day(-5)).bbch).toBe(observed)
      expect(after.bbchOffset).toBeGreaterThan(0)
      const table = (await get(`${base}/crop-table/conditions?seasonId=${season.id}`).expect(200)).body
      const row = table.rows.find((r: { cropCycleId: string }) => r.cropCycleId === cycle.id)
      expect(row.bbchObservedDates).toEqual([day(-5)])
      expect(row.bbchByDate[day(-5)]).toBe(observed)
    } finally {
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', lat).where('lng', '=', lng).execute()
      await owner.destroy()
    }
  })
})
