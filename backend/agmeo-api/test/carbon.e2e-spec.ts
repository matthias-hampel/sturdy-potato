/**
 * CO2 analysis end to end: ledger by BEK source with the field's crop, crop-cycle terms (humus,
 * residues), levels, regional reference, scope 2, farm comparison, topsoil values, rotation CO2e
 * and the calculation parameters with citations.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { thuenenConfigured } from '../src/modules/carbon/thuenen/client.js'

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

describe('CO2 analysis', () => {
  it('books operations by BEK source, adds humus and residues of the crop and compares farms', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `co2-${run}@example.test`, displayName: 'CO2' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
      del: (url: string) => http().delete(`/v1${url}`).set(auth),
    }
    const org = (await u.post('/orgs', { name: `CO2 ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheatId = crops.find((c) => c.code === 'winter_wheat')!.id
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheatId, expectedYieldTHa: 8 }).expect(201)).body[0]
    const area = cycle.areaHa as number

    const seed = (await u.post(`${base}/products`, { category: 'seed', name: 'Weizen Z1', baseUnit: 'kg', unitCost: 0.8 }).expect(201)).body
    const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.4, nPct: 27, fertilizerType: 'can' }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: seed.id, kind: 'receipt', quantityDelta: 10_000 }).expect(201)
    await u.post(`${base}/stock/movements`, { productId: kas.id, kind: 'receipt', quantityDelta: 10_000 }).expect(201)

    // Nothing is established yet: no analysis rows.
    expect((await u.get(`${base}/carbon/analysis?level=crop`).expect(200)).body.rows).toEqual([])

    const sowing = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'sowing', title: 'Aussaat', plannedOn: '2025-10-10', fields: [{ fieldId: field.id }], inputs: [{ productId: seed.id, ratePerHa: 180 }], dieselLPerHa: 20 }).expect(201)).body
    await u.post(`${base}/operations/${sowing.id}/complete`, { version: sowing.version, performedAt: '2025-10-10T09:00:00+02:00' }).expect(200)
    const fert = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'N', plannedOn: '2026-03-10', fields: [{ fieldId: field.id }], inputs: [{ productId: kas.id, ratePerHa: 300 }] }).expect(201)).body
    await u.post(`${base}/operations/${fert.id}/complete`, { version: fert.version, performedAt: '2026-03-10T09:00:00+01:00' }).expect(200)

    let a = (await u.get(`${base}/carbon/analysis?level=crop&years=2026`).expect(200)).body
    expect(a.factorSet).toMatch(/^DE-BEK/)
    let row = a.rows[0]
    expect(row).toMatchObject({ year: 2026, cropCode: 'winter_wheat', carbonCrop: 'winterWheat', hasModelData: true, cyclesCount: 1 })
    // Seed with the wheat factor, diesel, N from 81 kg N/ha, and the wheat's humus loss (sown → established).
    expect(row.bySource.pb4).toBeGreaterThan(0)
    expect(row.bySource.pb6a).toBeCloseTo(20 * area * 3.013, 0)
    expect(row.bySource.pf4).toBeCloseTo(81 * area * 0.01225 * 1.57 * 273, 0)
    expect(row.bySource.pf9).toBeCloseTo(400 * area * 3.67, 0)
    expect(row.bySource.pf5a).toBeUndefined()
    expect(row.byOperationType.sowing).toBeGreaterThan(0)
    expect(row.total).toBeCloseTo(row.pf + row.pb + row.pn, 0)

    // The harvest adds residues and their credits at the harvested yield.
    await u.post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: '2026-07-25', quantityT: 9 * area }).expect(201)
    a = (await u.get(`${base}/carbon/analysis?level=field&years=2026`).expect(200)).body
    row = a.rows[0]
    expect(row.entityName).toBe('Kamp')
    expect(row.yieldT).toBeCloseTo(9 * area, 2)
    expect(row.yieldTDm).toBeCloseTo(9 * area * 0.86, 1)
    expect(row.bySource.pf5a).toBeGreaterThan(0)
    expect(row.bySource.pn1a).toBeLessThan(0)
    expect(row.byOperationType.harvest).toBeDefined()

    // Economics shows the same total by category.
    const summary = (await u.get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    expect(summary.carbon.totalKg).toBeCloseTo(row.total, 0)
    expect(summary.carbon.bySource.humus).toBeGreaterThan(0)
    expect(summary.carbon.bySource.credits).toBeLessThan(0)

    // Region and its reference per tonne of dry matter.
    const settings = (await u.get(`${base}/carbon/settings`).expect(200)).body
    expect(settings.regions.length).toBeGreaterThan(30)
    await u.put(`${base}/carbon/settings`, { nuts2Code: 'DE92' }).expect(200)
    a = (await u.get(`${base}/carbon/analysis?level=template`).expect(200)).body
    expect(a.nuts2Code).toBe('DE92')
    expect(a.regionalReference.winter_wheat).toBeGreaterThan(100)
    await u.put(`${base}/carbon/settings`, { nuts2Code: 'XX99' }).expect(400)

    // Scope 2 per harvest year.
    await u.put(`${base}/carbon/scope2`, { harvestYear: 2026, entries: [{ kind: 'electricityGrid', kwh: 10_000 }, { kind: 'heatingErdgas', kwh: 0 }] }).expect(200)
    const s2 = (await u.get(`${base}/carbon/scope2?harvestYear=2026`).expect(200)).body
    expect(s2.entries).toEqual([{ kind: 'electricityGrid', kwh: 10_000, kgCo2e: 4740 }])
    expect(s2.parameters.heatingErdgas.value).toBe(0.201)
    a = (await u.get(`${base}/carbon/analysis`).expect(200)).body
    expect(a.scope2).toEqual([{ harvestYear: 2026, entries: [{ kind: 'electricityGrid', kwh: 10_000, kgCo2e: 4740 }], electricityKg: 4740, totalKg: 4740 }])

    // Farm comparison over the user's organizations; foreign ones are left out.
    const other = (await u.post('/orgs', { name: `CO2 B ${run}` }).expect(201)).body
    const cmp = (await u.get(`${base}/carbon/comparison?orgIds=${other.id},00000000-0000-4000-8000-000000000000`).expect(200)).body
    expect(cmp.organizations.map((o: { id: string }) => o.id).sort()).toEqual([org.id, other.id].sort())
    expect(cmp.rows.every((r: { orgId: string }) => r.orgId === org.id)).toBe(true)
    expect(cmp.scope2[0]).toMatchObject({ orgId: org.id, totalKg: 4740 })
    expect((await u.get(`${base}/carbon/organizations`).expect(200)).body).toHaveLength(2)

    // Topsoil values: prefilled, saved, used by the simulation.
    let soil = (await u.get(`${base}/fields/${field.id}/carbon/soil`).expect(200)).body
    expect(soil).toMatchObject({ saved: null, prefillSource: 'default', values: { depthCm: 30, bulkDensity: 1.3 } })
    await u.put(`${base}/fields/${field.id}/carbon/soil`, { bulkDensity: 1.4, clayPct: 70, socPct: 1.2, sandPct: 40 }).expect(400)
    soil = (await u.put(`${base}/fields/${field.id}/carbon/soil`, { bulkDensity: 1.4, clayPct: 18, socPct: 1.2, sandPct: 40 }).expect(200)).body
    expect(soil.saved).toMatchObject({ bulkDensity: 1.4, clayPct: 18, socPct: 1.2, sandPct: 40, depthCm: 30 })

    // Rotation CO2e per entry and the simulation guard.
    const rapeId = crops.find((c) => c.code === 'winter_rapeseed')!.id
    const oatsId = crops.find((c) => c.code === 'winter_oats')!.id
    const rotation = (await u.post(`${base}/rotations`, { name: 'Raps-Weizen', entries: [{ cropId: rapeId, expectedYieldTHa: 4 }, { cropId: wheatId }, { cropId: oatsId }] }).expect(201)).body
    const rc = (await u.get(`${base}/carbon/rotations/${rotation.id}`).expect(200)).body
    expect(rc.entries).toHaveLength(3)
    // Without template inputs the straw left on the field outweighs the crops' humus loss (pn1a).
    expect(rc.entries[0].co2eKgPerHa).toBeLessThan(0)
    expect(rc.entries[1]).toMatchObject({ hasModelData: true, co2eKgPerHa: expect.any(Number) })
    expect(rc.entries[2]).toMatchObject({ hasModelData: false, co2eKgPerHa: null })
    if (!thuenenConfigured()) {
      const sim = await u.post(`${base}/fields/${field.id}/carbon/rothc`, { rotationId: rotation.id }).expect(503)
      expect(sim.body.code).toBe('carbon_model_unavailable')
    }
    await u.del(`${base}/fields/${field.id}/carbon/soil`).expect(204)

    // The calculation parameters carry their citations.
    const params = (await u.get(`${base}/calculation-parameters`).expect(200)).body
    expect(params.factorSet).toBe(a.factorSet)
    const diesel = params.parameters.find((p: { id: string }) => p.id === 'ef.diesel')
    expect(diesel).toMatchObject({ group: 'fuel', value: 3.013 })
    expect(diesel.source).toBeTruthy()
  })
})
