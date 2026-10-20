/**
 * Stored weather per field: the field reads the grid cell under it; the cell's rows come from the
 * worker, inserted here directly.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'

const run = Math.random().toString(36).slice(2, 8)
// A cell far from the other tests' fields, unique per run.
// Built from whole hundredths so they equal the cell centre exactly (6 + 2.87 is 8.870000000000001).
const lat = (4700 + Math.floor(Math.random() * 300)) / 100
const lng = (600 + Math.floor(Math.random() * 300)) / 100
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

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

describe('field weather', () => {
  it('serves the stored days and the next hours of the field cell', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `wx-${run}@example.test`, displayName: 'Wetter' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Wetter ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.003, lat + 0.003) }).expect(201)).body

    let w = (await http().get(`/v1${base}/fields/${field.id}/weather`).set(auth).expect(200)).body
    expect(w).toMatchObject({ cell: { lat, lng }, refreshedAt: null, daily: [], hourly: [] })

    // Weather is written by the worker; the owner role stands in for it here.
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const today = new Date().toISOString().slice(0, 10)
    await owner.insertInto('weather_cells').values({ lat, lng, timezone: 'Europe/Berlin', refreshed_at: new Date() }).execute()
    await owner
      .insertInto('weather_daily')
      .values([
        { lat, lng, date: '2020-01-01', temp_min: -2, temp_max: 3, precipitation: 1.2, source: 'archive' },
        { lat, lng, date: today, temp_min: 5, temp_max: 12, precipitation: 0, et0: 1.1, source: 'forecast' },
      ])
      .execute()
    await owner
      .insertInto('weather_hourly')
      .values([0, 1, 2].map((h) => ({ lat, lng, time: new Date(Date.now() + h * 3_600_000), temp: 10 + h, wind_speed: 8, wind_gusts: 15 })))
      .execute()

    w = (await http().get(`/v1${base}/fields/${field.id}/weather`).set(auth).expect(200)).body
    expect(w.storedFrom).toBe('2020-01-01')
    expect(w.daily).toEqual([expect.objectContaining({ date: today, tempMax: 12, et0: 1.1, source: 'forecast' })])
    expect(w.hourly.length).toBeGreaterThanOrEqual(2)
    w = (await http().get(`/v1${base}/fields/${field.id}/weather?from=2019-12-31&to=2020-01-02`).set(auth).expect(200)).body
    expect(w.daily).toEqual([expect.objectContaining({ date: '2020-01-01', source: 'archive' })])
    await http().get(`/v1${base}/fields/${field.id}/weather?from=gestern`).set(auth).expect(400)

    // Leave no active field behind, or the worker would keep fetching this cell.
    await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
    await owner.deleteFrom('weather_cells').where('lat', '=', lat).where('lng', '=', lng).execute()
    await owner.destroy()
  })
})
