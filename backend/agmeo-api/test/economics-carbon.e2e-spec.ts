/**
 * Economics and carbon end to end: contribution margins (DfL, DB I, DB II), plan values, crop
 * prices, the farm result with overheads and payments, and the emission ledger.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'

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

describe('economics and carbon', () => {
  it('splits margins, values the plan, books and reverses emissions, and computes the farm result', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `eco-${run}@example.test`, displayName: 'Eco' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `Eco ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheatId = crops.find((c) => c.code === 'winter_wheat')!.id
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheatId, expectedYieldTHa: 8 }).expect(201)).body[0]
    const area = cycle.areaHa as number

    // Price of the harvest year applies when the crop has no expected price of its own.
    await u.put(`${base}/crop-prices`, { harvestYear: 2026, prices: [{ cropId: wheatId, pricePerT: 200 }] }).expect(200)
    expect((await u.get(`${base}/crop-prices?harvestYear=2026`).expect(200)).body[0]).toMatchObject({ pricePerT: 200 })

    const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.4, nPct: 27, fertilizerType: 'can' }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: kas.id, kind: 'receipt', quantityDelta: 10_000 }).expect(201)
    const tractor = (await u.post(`${base}/equipment`, { name: 'Schlepper', kind: 'tractor', hourlyCost: 50, fuelLPerH: 12 }).expect(201)).body
    expect(tractor.fuelLPerH).toBe(12)
    const worker = (await u.post(`${base}/employees`, { name: 'Lena', hourlyRate: 20 }).expect(201)).body

    const op = (await u.post(`${base}/operations`, {
      farmId: farm.id, type: 'fertilization', title: 'N', plannedOn: '2026-03-10', fields: [{ fieldId: field.id }],
      inputs: [{ productId: kas.id, ratePerHa: 200 }], equipment: [{ equipmentId: tractor.id, hours: 2 }], labor: [{ employeeId: worker.id, hours: 2 }],
    }).expect(201)).body
    let summary = (await u.get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    let c = summary.cycles[0]
    // Nothing completed yet: the plan holds the planned operation and the expected revenue.
    expect(c.planned).toMatchObject({ revenue: Math.round(area * 8 * 200 * 100) / 100, laborCosts: 40, machineryCosts: 100 })
    expect(c.planned.directCosts).toBeCloseTo(op.inputs[0].totalQuantity * 0.4, 1)
    expect(c.co2eKg).toBe(0)

    const done = (await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: '2026-03-10T09:00:00+01:00' }).expect(200)).body
    summary = (await u.get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    c = summary.cycles[0]
    expect(c.directCosts).toBeCloseTo(op.inputs[0].totalQuantity * 0.4, 0)
    expect(c.machineryCosts).toBe(100)
    expect(c.laborCosts).toBe(40)
    expect(c.db2).toBeCloseTo(c.revenue - c.directCosts - 140, 1)
    // 24 l diesel and 54 kg N/ha.
    expect(summary.carbon.bySource.diesel).toBeCloseTo(24 * 3.013, 1)
    expect(summary.carbon.bySource.n2o_direct).toBeGreaterThan(0)
    expect(c.co2eKg).toBeCloseTo(summary.carbon.totalKg, 0)
    expect(c.co2ePerT).toBeCloseTo(c.co2eKg / (8 * area), 0)
    expect(summary.farmResult).toBeNull()

    await u.put(`${base}/economics/overheads`, { seasonId: season.id, leasePerHa: 500, basicPaymentPerHa: 150, redistributive1PerHa: 150, redistributive2PerHa: 50 }).expect(200)
    summary = (await u.get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    const fr = summary.farmResult
    expect(fr.overheads.lease).toBeCloseTo(500 * area, 0)
    expect(fr.payments.redistributive).toBeCloseTo(150 * area, 0)
    expect(fr.result).toBeCloseTo(fr.db2 - fr.overheads.total + fr.payments.total, 1)

    // Reopening reverses the emissions, like the costs.
    await u.post(`${base}/operations/${op.id}/reopen`, { version: done.version, reason: 'Falsche Menge' }).expect(200)
    summary = (await u.get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    expect(summary.carbon.totalKg).toBe(0)
    expect(summary.cycles[0].co2eKg).toBe(0)
  })
})
