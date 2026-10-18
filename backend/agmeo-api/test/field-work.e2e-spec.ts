/**
 * Field work records end to end: products from the fertilizer catalogue and the BVL register,
 * nutrient rates on operations, typed operation details, and plant-protection checks.
 * Needs the register loaded (`pnpm sync:psm`); the PSM test is skipped otherwise.
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
let registerLoaded = false
const http = () => request(app.getHttpServer())

async function setup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `work-${run}-${Math.random()}@example.test`, displayName: 'Work' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Work ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
  const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
  const season = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body[0]
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  return { u, base, farm, field, season, crop }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
  const db = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
  registerLoaded = !!(await db.selectFrom('psm_products').select('kennr').where('kennr', '=', '025662-00').executeTakeFirst())
  await db.destroy()
})

afterAll(async () => {
  await app?.close()
})

describe('field work records', () => {
  it('creates fertilizers from the catalogue and reports nutrient rates per operation', async () => {
    const { u, base, farm, field } = await setup()
    const found = (await u.get(`${base}/catalogue/fertilizers?q=ahl%2028`).expect(200)).body
    const ahl = found.find((e: { name: string }) => e.name === 'AHL 28')
    expect(ahl).toMatchObject({ fertilizerType: 'uan', suggestedUnit: 'l', nPct: 28 })
    expect(ahl.densityTM3).toBeCloseTo(1.28, 2)
    const slurryEntry = (await u.get(`${base}/catalogue/fertilizers?type=cattle_slurry`).expect(200)).body[0]
    expect(slurryEntry.suggestedUnit).toBe('m3')

    const ahlProduct = (await u.post(`${base}/products/from-catalogue`, { catalogueEntryId: ahl.id }).expect(201)).body
    expect(ahlProduct).toMatchObject({ category: 'fertilizer', baseUnit: 'l', fertilizerType: 'uan', catalogueEntryId: ahl.id })
    const slurry = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Rindergülle eigen', baseUnit: 'm3', nPct: 0.4, nh4NPct: 0.2, p2o5Pct: 0.17, k2oPct: 0.5, fertilizerType: 'cattle_slurry' }).expect(201)).body
    expect(slurry.fertilizerType).toBe('cattle_slurry')

    const op = (await u.post(`${base}/operations`, {
      farmId: farm.id,
      type: 'fertilization',
      title: 'Gülle + AHL',
      plannedOn: '2027-03-10',
      fields: [{ fieldId: field.id }],
      inputs: [{ productId: ahlProduct.id, ratePerHa: 100 }, { productId: slurry.id, ratePerHa: 20 }],
      details: { applicationTechnique: 'trailing_shoe', incorporationHours: 4 },
    }).expect(201)).body
    const [l1, l2] = op.inputs
    expect(l1.nutrients.n).toBeCloseTo(35.84, 1)
    expect(l2.nutrients).toMatchObject({ n: 80, nh4N: 40 })
    expect(l2.densityAssumed).toBe(true)
    expect(op.nutrientTotals.n).toBeCloseTo(115.84, 1)

    const bad = await u.post(`${base}/operations`, { farmId: farm.id, type: 'tillage', title: 'Pflug', fields: [{ fieldId: field.id }], details: { depthCm: 'tief' } }).expect(400)
    expect(bad.body.details[0].path).toBe('details.depthCm')
  })

  it('checks plant-protection applications against the BVL register', async () => {
    if (!registerLoaded) return
    const { u, base, farm, field, season, crop } = await setup()
    const hits = (await u.get(`${base}/catalogue/psm?q=prosaro`).expect(200)).body
    expect(hits.map((h: { kennr: string }) => h.kennr)).toContain('025662-00')
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crop('winter_wheat'), expectedHarvestDate: '2027-07-20' }).expect(201)).body[0]
    const uses = (await u.get(`${base}/catalogue/psm/025662-00/uses?cropId=${crop('winter_wheat')}`).expect(200)).body
    expect(uses[0]).toMatchObject({ matchesCrop: true, doseMax: 1, doseUnit: 'l/ha' })

    const prosaro = (await u.post(`${base}/products/from-psm`, { kennr: '025662-00' }).expect(201)).body
    expect(prosaro).toMatchObject({ category: 'crop_protection', baseUnit: 'l', registrationNumber: '025662-00' })
    expect(prosaro.psm.kennr).toBe('025662-00')
    expect((await u.post(`${base}/products/from-psm`, { kennr: '025662-00' }).expect(400)).body.code).toBe('product_exists')

    const spray = (title: string, plannedOn: string, rate: number, bbch: string) =>
      u.post(`${base}/operations`, { farmId: farm.id, type: 'crop_protection', title, plannedOn, bbchStage: bbch, fields: [{ fieldId: field.id }], inputs: [{ productId: prosaro.id, ratePerHa: rate }] }).expect(201)
    const ok = (await spray('Fungizid T1', '2027-04-20', 0.8, '32')).body
    expect((await u.get(`${base}/operations/${ok.id}/checks`).expect(200)).body.psm).toEqual([])

    const late = (await spray('Fungizid T3', '2027-06-25', 1.2, '75')).body
    const checks = (await u.get(`${base}/operations/${late.id}/checks`).expect(200)).body
    const codes = checks.psm.map((f: { code: string }) => f.code).sort()
    expect(codes).toEqual(expect.arrayContaining(['bbch_outside_window', 'dose_above_max']))
    expect(checks.psm[0]).toMatchObject({ operationId: late.id, productName: prosaro.name, cropName: 'Winterweizen', fieldName: 'Kamp' })
    expect(checks.psm.every((f: { operationId: string }) => f.operationId === late.id)).toBe(true)
    void cycle

    const report = (await u.get(`${base}/compliance/report?seasonId=${season.id}`).expect(200)).body
    expect(report.issues.some((i: { code: string; operationId: string }) => i.code === 'psm.dose_above_max' && i.operationId === late.id)).toBe(true)
  })
})
