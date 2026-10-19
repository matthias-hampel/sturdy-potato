/**
 * The agmeo N balance per crop with the farmer's values, and fertilization strategies applied as
 * planned fertilizer doses.
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

describe('nitrogen', () => {
  it('balances N per crop and applies strategies as planned doses', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `nitro-${run}@example.test`, displayName: 'N' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `N ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${field.id}/site`).set(auth).send({ soilTexture: 'L' }).expect(200)
    const season = (await post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body[0]
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const [wheat] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id, expectedYieldTHa: 8 }).expect(201)).body
    const kas = (await post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', nPct: 27, fertilizerType: 'can' }).expect(201)).body
    const seed = (await post(`${base}/products`, { category: 'seed', name: 'Saatgut', baseUnit: 'kg' }).expect(201)).body

    try {
      let [row] = (await get(`${base}/nitrogen?seasonId=${season.id}`).expect(200)).body
      expect(row).toMatchObject({ cropCycleId: wheat.id, yieldTHa: 8, soilTexture: 'L', totalN: 0, strategyId: null })
      expect(row.nDemand).toBeGreaterThan(100)
      // Medium soil, 2 % humus: the reference's soil-class estimates.
      expect(row.nMin).toEqual({ value: 35, source: 'estimate', estimate: 35 })
      expect(row.nMinSpring).toMatchObject({ value: 12, source: 'estimate' })
      expect(row.nLeaching).toMatchObject({ value: 13, source: 'estimate' })
      expect(row.nSupply).toBe(35 + 12 + row.deductions.total)
      expect(row.nDifference).toBe(Math.round(row.nDemand - Math.round(row.nSupply) + row.nLoss))
      expect(row.duevNeed).toEqual(expect.any(Number))

      row = (await put(`${base}/crop-cycles/${wheat.id}/n-planning`, { nMin: 60 }).expect(200)).body
      expect(row.nMin).toEqual({ value: 60, source: 'user', estimate: 35 })
      const target = row.nDifference as number

      const strategies = (await get(`${base}/fertilization-strategies`).expect(200)).body
      const split = strategies.find((s: { splitPercentages: number[]; public: boolean }) => s.public && s.splitPercentages.join('/') === '30/70')
      expect(split.products).toEqual([null, null])
      await post(`${base}/fertilization-strategies/${split.id}/apply`, { cropCycleIds: [wheat.id] }).expect(400)
      await post(`${base}/fertilization-strategies`, { name: 'Falsch', splitPercentages: [50, 40], productIds: [kas.id, kas.id] }).expect(400)
      await post(`${base}/fertilization-strategies`, { name: 'Saat', splitPercentages: [100], productIds: [seed.id] }).expect(400)
      const own = (await post(`${base}/fertilization-strategies`, { name: 'Eine Gabe', splitPercentages: [100], productIds: [kas.id] }).expect(201)).body
      expect(own).toMatchObject({ public: false, splitPercentages: [100], products: [{ id: kas.id, name: 'KAS' }] })
      await post(`${base}/fertilization-strategies`, { name: 'eine gabe', splitPercentages: [100], productIds: [kas.id] }).expect(409)

      expect((await post(`${base}/fertilization-strategies/${split.id}/apply`, { cropCycleIds: [wheat.id], productIds: [kas.id, kas.id] }).expect(200)).body).toEqual({ created: 2, updated: 0, canceled: 0, skipped: [] })
      let ops = (await get(`${base}/operations?seasonId=${season.id}&type=fertilization`).expect(200)).body as { id: string; status: string; plannedOn: string; inputs: { ratePerHa: number }[]; nutrientTotals: { n: number } }[]
      ops.sort((a, b) => a.plannedOn.localeCompare(b.plannedOn))
      expect(ops).toHaveLength(2)
      expect(ops[0].inputs[0].ratePerHa).toBeCloseTo((Math.round(target * 3) / 10) / 0.27, 0)
      expect(ops[0].plannedOn < ops[1].plannedOn).toBe(true)
      ;[row] = (await get(`${base}/nitrogen?seasonId=${season.id}`).expect(200)).body
      expect(row.strategyId).toBe(split.id)
      expect(row.totalN).toBeCloseTo(target, 0)

      // One dose instead of two: the first planned dose is rewritten, the second canceled.
      expect((await post(`${base}/fertilization-strategies/${own.id}/apply`, { cropCycleIds: [wheat.id] }).expect(200)).body).toEqual({ created: 0, updated: 1, canceled: 1, skipped: [] })
      ops = (await get(`${base}/operations?seasonId=${season.id}&type=fertilization`).expect(200)).body
      expect(ops.filter((o) => o.status === 'planned')).toHaveLength(1)
      expect(ops.find((o) => o.status === 'planned')!.nutrientTotals.n).toBeCloseTo(target, 0)
      await http().delete(`/v1${base}/fertilization-strategies/${own.id}`).set(auth).expect(204)
      await http().delete(`/v1${base}/fertilization-strategies/${split.id}`).set(auth).expect(404)
    } finally {
      const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.destroy()
    }
  })
})
