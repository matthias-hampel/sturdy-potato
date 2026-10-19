/**
 * Thematic layers of the organization map: key figures per field (margin, yield, CO2e, N), soil
 * zones with a parameter and content class, and trafficability of a machine on every field.
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

describe('map layers', () => {
  it('serves margin, yield, CO2e, N, soil and trafficability per field', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `maplayers-${run}@example.test`, displayName: 'Karte' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `Karte ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(lng + 0.001, lat + 0.001, lng + 0.004, lat + 0.003) }).expect(201)).body
    const bare = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Brache', geometry: rect(lng + 0.006, lat + 0.001, lng + 0.008, lat + 0.003) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!.id
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheat, expectedYieldTHa: 8 }).expect(201)).body[0]
    const area = cycle.areaHa as number

    const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.4, nPct: 27, fertilizerType: 'can' }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: kas.id, kind: 'receipt', quantityDelta: 10_000 }).expect(201)
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'N', plannedOn: '2026-03-10', fields: [{ fieldId: field.id }], inputs: [{ productId: kas.id, ratePerHa: 300 }] }).expect(201)).body
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: '2026-03-10T09:00:00+01:00' }).expect(200)
    await u.post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: '2026-07-25', quantityT: 9 * area }).expect(201)

    const k = (await u.get(`${base}/map/kpis?seasonId=${season.id}`).expect(200)).body
    expect(k).toMatchObject({ seasonId: season.id, harvestYear: 2026, finance: true })
    const kamp = k.fields.find((f: { fieldId: string }) => f.fieldId === field.id)
    expect(kamp).toMatchObject({ cropName: 'Winterweizen', cropNames: ['Winterweizen'] })
    expect(kamp.yieldTHa).toBeCloseTo(9, 1)
    expect(kamp.nKgPerHa).toBeCloseTo(81, 0)
    // Straw left on the field earns credits: the balance may be negative, but it is there.
    expect(kamp.co2eKgPerHa).toEqual(expect.any(Number))
    expect(kamp.co2eKgPerHa).not.toBe(0)
    expect(typeof kamp.db1PerHa).toBe('number')
    expect(k.fields.find((f: { fieldId: string }) => f.fieldId === bare.id)).toBeUndefined()
    await u.get(`${base}/map/kpis?seasonId=nope`).expect(400)

    // Soil: zones of the active zonation with value and VDLUFA class.
    const plan = (await u.post(`${base}/fields/${field.id}/soil/plan`, { mode: 'grid', cellHa: 5 }).expect(201)).body
    const zoneId = plan.zonation.zones[0].id as string
    await u.patch(`${base}/soil/zones/${zoneId}`, { values: { ph: 6.1, p2o5: 14 }, sampledOn: '2026-03-01' }).expect(200)
    const soil = (await u.get(`${base}/map/soil?parameter=p2o5`).expect(200)).body
    expect(soil.available).toEqual(expect.arrayContaining(['ph', 'p2o5']))
    const z = soil.zones.find((x: { id: string }) => x.id === zoneId)
    expect(z).toMatchObject({ fieldId: field.id, fieldName: 'Kamp', value: 14, sampledOn: '2026-03-01', contentClass: expect.stringMatching(/^[A-E]$/) })
    expect(z.geometry.type).toBe('MultiPolygon')
    await u.get(`${base}/map/soil?parameter=gold`).expect(400)

    // Trafficability from stored weather; fields without a soil class are left out.
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)
    const tractor = (await u.post(`${base}/equipment`, {
      name: 'Fendt', class: 'machine', category: 'tractor_small', operatingMassKg: 5200, frontAxleFraction: 0.444,
      frontTyre: { size: '440/65R24', widthM: 0.44, recommendedPressureKpa: 120 }, rearTyre: { size: '540/65R34', widthM: 0.54, recommendedPressureKpa: 120 },
    }).expect(201)).body
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    try {
      await owner.insertInto('weather_cells').values({ lat, lng, timezone: 'Europe/Berlin', utc_offset_seconds: 7200, refreshed_at: new Date() }).execute()
      await owner
        .insertInto('weather_daily')
        .values(
          Array.from({ length: 135 }, (_, i) => {
            const t = 10 + 5 * Math.sin(i / 9)
            return {
              lat, lng, date: day(i - 120), temp_min: t - 5, temp_max: t + 5, temp_mean: t, precipitation: i % 4 === 0 ? 6 : 0,
              humidity_min: 55, humidity_max: 95, humidity_mean: 75, dew_point_min: t - 8, dew_point_max: t - 2, dew_point_mean: t - 5,
              wind_speed_max: 14, wind_speed_mean: 9, wind_gusts_max: 25, wind_gusts_mean: 15, et0: 1.8, radiation_sum: 8,
              soil_temp_0_7: t, soil_temp_7_28: t - 1, soil_moisture_0_7: 0.3, soil_moisture_7_28: 0.31, source: i < 120 ? 'archive' : 'forecast',
            }
          }),
        )
        .execute()
      const tr = (await u.get(`${base}/map/trafficability?equipmentId=${tractor.id}&day=1`).expect(200)).body
      expect(tr.date).toBe(day(1))
      expect(tr.fields).toEqual([{ fieldId: field.id, band: expect.any(String), sci: expect.any(Number), pf: expect.any(Number) }])
      expect(tr.skipped).toEqual([{ fieldId: bare.id, reason: 'no_soil_texture' }])
      await u.get(`${base}/map/trafficability?equipmentId=${tractor.id}&day=9`).expect(400)
      await u.get(`${base}/map/trafficability?equipmentId=00000000-0000-4000-8000-000000000000`).expect(404)
    } finally {
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', 'in', [field.id, bare.id]).execute()
      await owner.deleteFrom('weather_cells').where('lat', '=', lat).where('lng', '=', lng).execute()
      await owner.destroy()
    }
  })
})
