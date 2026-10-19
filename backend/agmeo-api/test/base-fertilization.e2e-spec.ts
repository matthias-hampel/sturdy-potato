/**
 * Base fertilization per crop: need by content class, delivered and planned nutrients, lime,
 * straw, and the six-year P2O5 balance of the field.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'

const run = Math.random().toString(36).slice(2, 8)
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

describe('base fertilization', () => {
  it('serves need, delivery, lime and the P2O5 balance', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `basefert-${run}@example.test`, displayName: 'PK' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `PK ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'L' }).expect(200)
    const seasons = (await post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body
    const s2027 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2027)
    const s2026 = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2026)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!.id
    await post(`${base}/crop-cycles`, { seasonId: s2026.id, fieldIds: [field.id], cropId: wheat, expectedYieldTHa: 8 }).expect(201)
    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: wheat, expectedYieldTHa: 8 }).expect(201)).body
    await post(`${base}/soil-samples`, { fieldId: field.id, kind: 'basic', sampledOn: '2025-09-10', ph: 5.8, phMethod: 'cacl2', p2o5Mg100g: 6, k2oMg100g: 9, humusPct: 2 }).expect(201)
    const tsp = (await post(`${base}/products`, { category: 'fertilizer', name: 'TSP', baseUnit: 'kg', p2o5Pct: 46, fertilizerType: 'pk' }).expect(201)).body
    await post(`${base}/stock/movements`, { productId: tsp.id, kind: 'receipt', quantityDelta: 10000 }).expect(201)
    const done = (await post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'TSP', plannedOn: '2026-03-10', fields: [{ fieldId: field.id }], inputs: [{ productId: tsp.id, ratePerHa: 100 }] }).expect(201)).body
    await post(`${base}/operations/${done.id}/complete`, { version: done.version, performedAt: '2026-03-10T09:00:00Z' }).expect(200)
    await post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'TSP', plannedOn: '2027-03-10', fields: [{ fieldId: field.id }], inputs: [{ productId: tsp.id, ratePerHa: 50 }] }).expect(201)

    try {
      let [row] = (await get(`${base}/base-fertilization?seasonId=${s2027.id}`).expect(200)).body
      expect(row).toMatchObject({ cropCycleId: cycle.id, yieldTHa: 8, yieldSource: 'expected', strawRemoved: false, hasStraw: true, limeOverrideDtCaO: null, limeComputedDtCaO: 15 })
      const p = row.nutrients.find((n: { nutrient: string }) => n.nutrient === 'p2o5')
      // 6 mg P2O5 = 2.6 mg P: class B ×1.5 on a removal of 64 kg.
      expect(p).toMatchObject({ soilMg100g: 6, contentClass: 'B', removal: 64, need: 96, delivered: 0, planned: 23, balance: 96 })
      expect(row.nutrients.find((n: { nutrient: string }) => n.nutrient === 'mgo')).toMatchObject({ soilMg100g: null, need: null, balance: null })
      expect(row.p2o5Balance).toMatchObject({ fromYear: 2022, toYear: 2027, supply: 46, removal: 128, ratioPct: 36, compliant: true, yearsWithYield: 2 })
      expect(row.p2o5Balance.years.find((y: { year: number }) => y.year === 2026)).toEqual({ year: 2026, supply: 46, removal: 64 })

      await put(`${base}/crop-cycles/${cycle.id}/base-fertilization`, { strawRemoved: true, limeRequirementDtCaO: 20 }).expect(204)
      ;[row] = (await get(`${base}/base-fertilization?seasonId=${s2027.id}`).expect(200)).body
      expect(row).toMatchObject({ strawRemoved: true, limeOverrideDtCaO: 20 })
      expect(row.nutrients[0].removal).toBe(83.2)
    } finally {
      const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.destroy()
    }
  })
})
