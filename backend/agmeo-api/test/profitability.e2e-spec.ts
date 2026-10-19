/**
 * Profitability per field down to the farm result, coverage, multi-year, benchmarks and market prices.
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

describe('profitability', () => {
  it('carries the margins per field down to the farm result and reports coverage', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `pnl-${run}@example.test`, displayName: 'PnL' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `PnL ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(9.96, 52.31, 9.97, 52.32) }).expect(201)).body
    const season = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2026)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!
    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [a.id], cropId: wheat.id }).expect(201)).body
    const area = cycle.areaHa as number

    const kas = (await post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.4, nPct: 27 }).expect(201)).body
    await post(`${base}/stock/movements`, { productId: kas.id, kind: 'receipt', quantityDelta: 100_000 }).expect(201)
    // No own rate: the season's salary per hour applies.
    const worker = (await post(`${base}/employees`, { name: 'Lena' }).expect(201)).body
    await put(`${base}/economics/overheads`, {
      seasonId: season.id, leasePerHa: 300, landTaxPerHa: 20, accidentInsurancePerHa: 10, buildingsPerHa: 50, rightsPerHa: 5,
      insurancePerHa: 15, accountingPerHa: 10, otherPerHa: 5, basicPaymentPerHa: 150, ecoSchemesPerHa: 40, agriEnvPerHa: 20, youngFarmersPerHa: 0, salaryPerHour: 25,
    }).expect(200)
    const done = (await post(`${base}/operations`, {
      farmId: farm.id, type: 'fertilization', title: 'N', plannedOn: '2026-03-10', dieselLPerHa: 2,
      fields: [{ fieldId: a.id }], inputs: [{ productId: kas.id, ratePerHa: 200 }], labor: [{ employeeId: worker.id, hours: 2 }],
    }).expect(201)).body
    await post(`${base}/operations/${done.id}/complete`, { version: done.version, performedAt: '2026-03-10T09:00:00+01:00' }).expect(200)
    await post(`${base}/operations`, { farmId: farm.id, type: 'crop_protection', title: 'Fungizid', plannedOn: '2026-05-01', fields: [{ fieldId: a.id }] }).expect(201)
    await post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: '2026-07-20', quantityT: area * 8, pricePerT: 200, priceBasis: 'actual' }).expect(201)

    const p = (await get(`${base}/economics/profitability?seasonId=${season.id}`).expect(200)).body
    expect(p).toMatchObject({ harvestYear: 2026, subsidies: { perHa: 210 } })
    const f = p.fields[0]
    expect(f.revenue).toBeCloseTo(1600, 0)
    expect(f.fertilizerCost).toBeCloseTo(80, 0)
    expect(f.laborCosts).toBeCloseTo(50 / area, 0)
    expect(f.landCosts).toBe(330)
    expect(f.singleCostFreeMargin).toBeCloseTo(f.db2 - 50 - 330 - 5, 0)
    expect(f.farmResult).toBeCloseTo(f.singleCostFreeMargin - 30 + 210, 0)
    expect(f).toMatchObject({ dieselLHa: 2, nKgHa: 54, passes: 1, yieldTHa: 8 })
    expect(p.coverage).toMatchObject({ documentedOps: 1, totalOps: 2, fieldsWithCrop: 1, totalCycles: 1, pricedProducts: 1, totalProducts: 1 })
    expect(p.coverage.undocumentedOps[0]).toMatchObject({ title: 'Fungizid', fieldName: 'A' })

    // A field's own lease replaces the farm's.
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    await owner.updateTable('fields').set({ lease_per_ha: 500 }).where('id', '=', a.id).execute()
    await owner.destroy()
    expect((await get(`${base}/economics/profitability?seasonId=${season.id}`).expect(200)).body.fields[0]).toMatchObject({ leasePerHa: 500, landCosts: 530 })
    expect((await get(`${base}/economics/profitability/years?fromYear=2025&toYear=2027`).expect(200)).body.map((y: { harvestYear: number }) => y.harvestYear)).toContain(2026)
    await get(`${base}/economics/profitability/years?fromYear=2000&toYear=2030`).expect(400)

    // Benchmarks.
    const b = (await post(`${base}/economics/benchmarks`, { cropId: wheat.id, name: 'KTBL 2026', yieldTHa: 8.5, db1PerHa: 700, source: 'KTBL' }).expect(201)).body
    expect(b).toMatchObject({ cropName: expect.any(String), yieldTHa: 8.5 })
    await post(`${base}/economics/benchmarks`, { cropId: wheat.id, name: 'KTBL 2026' }).expect(400)
    await put(`${base}/economics/benchmarks/${b.id}`, { cropId: wheat.id, name: 'KTBL 2026', yieldTHa: 9 }).expect(200)
    expect((await get(`${base}/economics/benchmarks`).expect(200)).body).toEqual([expect.objectContaining({ yieldTHa: 9, db1PerHa: null })])
    await http().delete(`/v1${base}/economics/benchmarks/${b.id}`).set(auth).expect(204)

    // Market prices: wheat maps to bread and feed wheat.
    const m = (await get(`${base}/economics/market-prices?harvestYear=2026`).expect(200)).body
    expect(m).toEqual([expect.objectContaining({ cropId: wheat.id, commodities: ['WHEAT_BREAD', 'WHEAT_FEED'] })])
  })
})
