/**
 * Emission recommendations and the CO2 report: measures priced per crop cycle, management data per
 * crop, summary and notes per harvest year.
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

describe('CO2 recommendations and report', () => {
  it('prices measures on completed operations and keeps the report text per year', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `co2r-${run}@example.test`, displayName: 'CO2R' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `CO2R ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheatId = crops.find((c) => c.code === 'winter_wheat')!.id
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheatId, expectedYieldTHa: 8 }).expect(201)).body[0]
    const area = cycle.areaHa as number

    // Nothing documented yet.
    let rec = (await u.get(`${base}/carbon/recommendations?harvestYear=2026`).expect(200)).body
    expect(rec).toMatchObject({ harvestYear: 2026, cycles: [], savingsKg: 0 })

    const urea = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Harnstoff stabilisiert', baseUnit: 'kg', nPct: 46, fertilizerType: 'urea_inhibitor' }).expect(201)).body
    const slurry = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Rindergülle', baseUnit: 'm3', nPct: 0.4, nh4NPct: 0.2, densityTM3: 1, fertilizerType: 'cattle_slurry' }).expect(201)).body
    const ppp = (await u.post(`${base}/products`, { category: 'crop_protection', name: 'Fungizid', baseUnit: 'l' }).expect(201)).body
    for (const p of [urea, slurry, ppp]) await u.post(`${base}/stock/movements`, { productId: p.id, kind: 'receipt', quantityDelta: 100_000 }).expect(201)

    const complete = async (body: object, performedAt: string) => {
      const op = (await u.post(`${base}/operations`, { farmId: farm.id, fields: [{ fieldId: field.id }], ...body }).expect(201)).body
      await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt }).expect(200)
      return op
    }
    const n = await complete({ type: 'fertilization', title: 'Harnstoff', plannedOn: '2026-03-10', inputs: [{ productId: urea.id, ratePerHa: 200 }] }, '2026-03-10T09:00:00+01:00')
    const g = await complete({ type: 'fertilization', title: 'Gülle', plannedOn: '2026-03-20', details: { incorporationHours: 4 }, inputs: [{ productId: slurry.id, ratePerHa: 25 }] }, '2026-03-20T09:00:00+01:00')
    await complete({ type: 'crop_protection', title: 'Fungizid', plannedOn: '2026-05-01', inputs: [{ productId: ppp.id, ratePerHa: 1.5 }] }, '2026-05-01T09:00:00+02:00')

    rec = (await u.get(`${base}/carbon/recommendations?harvestYear=2026`).expect(200)).body
    expect(rec.cycles).toHaveLength(1)
    const c = rec.cycles[0]
    expect(c).toMatchObject({ cropCycleId: cycle.id, fieldId: field.id, fieldName: 'Kamp' })
    expect(c.emissionsKg).toBeGreaterThan(0)
    const blue = c.measures.find((m: { type: string }) => m.type === 'mineralBlueFertilizer')
    expect(blue).toMatchObject({ operationId: n.id, productName: 'Harnstoff stabilisiert', date: '2026-03-10' })
    expect(blue.savedKg).toBeCloseTo(blue.savedKgPerHa * area, 0)
    const inc = c.measures.find((m: { type: string }) => m.type === 'incorporation')
    expect(inc).toMatchObject({ operationId: g.id, productName: 'Rindergülle' })
    expect(inc.savedKgPerHa).toBeGreaterThan(0)
    expect(c.savingsKg).toBeCloseTo(blue.savedKg + inc.savedKg, 0)
    expect(rec.savingsKg).toBeCloseTo(c.savingsKg, 0)
    await u.get(`${base}/carbon/recommendations`).expect(400)

    // Report: management data per crop, generated summary until edited, notes per year.
    let report = (await u.get(`${base}/carbon/report?harvestYear=2026`).expect(200)).body
    expect(report.crops).toHaveLength(1)
    expect(report.crops[0]).toMatchObject({ cropCode: 'winter_wheat', hasModelData: true, dryMatterPct: 86, incorporated1hPct: 0 })
    expect(report.crops[0].mineralNKgHa).toBeCloseTo(92, 0)
    expect(report.crops[0].organicNKgHa).toBeCloseTo(100, 0)
    expect(report.crops[0].protectionKgLHa).toBeCloseTo(1.5, 1)
    expect(report.notes).toEqual({ harvestYear: 2026, summary: null, notes: '', updatedAt: null })
    await u.put(`${base}/carbon/report/notes`, { harvestYear: 2026, summary: 'Eigene Zusammenfassung', notes: 'Notiz' }).expect(200)
    report = (await u.get(`${base}/carbon/report?harvestYear=2026`).expect(200)).body
    expect(report.notes).toMatchObject({ summary: 'Eigene Zusammenfassung', notes: 'Notiz' })
    // An empty summary returns to the generated one.
    const saved = (await u.put(`${base}/carbon/report/notes`, { harvestYear: 2026, summary: '  ', notes: 'Notiz 2' }).expect(200)).body
    expect(saved).toMatchObject({ summary: null, notes: 'Notiz 2' })
    expect((await u.get(`${base}/carbon/report?harvestYear=2025`).expect(200)).body).toMatchObject({ crops: [], notes: { notes: '' } })
  })
})
