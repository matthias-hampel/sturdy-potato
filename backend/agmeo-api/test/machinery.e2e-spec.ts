/**
 * Machinery details (machines and implements, catalogue, SCI data, archive), operator details and
 * the action catalogue with diesel per hectare.
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

describe('machinery and actions', () => {
  it('keeps machines, implements, operators and actions, and values diesel per hectare', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `mach-${run}@example.test`, displayName: 'Maschinen' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const del = (url: string) => http().delete(`/v1${url}`).set(auth)

    const org = (await post('/orgs', { name: `Maschinen ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`

    // Catalogue lookup.
    const makers = (await get(`${base}/machinery-catalogue/manufacturers?class=machine`).expect(200)).body as string[]
    expect(makers).toContain('Fendt')
    const models = (await get(`${base}/machinery-catalogue?class=machine&q=fendt 211`).expect(200)).body
    const fendt = models.find((m: { id: string }) => m.id === 'fendt-211-vario')
    expect(fendt).toMatchObject({ category: 'tractor_small', powerKw: 81, frontAxleFraction: 0.444, frontTyre: { size: '440/65R24' } })
    expect((await get(`${base}/machinery-catalogue?class=implement&q=bogballe`).expect(200)).body.length).toBeGreaterThan(0)
    await get(`${base}/machinery-catalogue?class=robot`).expect(400)

    // Operators.
    const lena = (await post(`${base}/employees`, { name: 'Lena', role: 'machine_operator', staffNumber: 'P-7', notes: 'Pflanzenschutz-Sachkunde', hourlyRate: 20 }).expect(201)).body
    expect(lena).toMatchObject({ role: 'machine_operator', staffNumber: 'P-7', notes: 'Pflanzenschutz-Sachkunde' })

    // A machine from the catalogue is SCI-ready; an implement cannot take a machine category.
    const tractor = (
      await post(`${base}/equipment`, {
        name: 'Fendt 211', class: 'machine', category: fendt.category, manufacturer: fendt.manufacturer, model: fendt.model, catalogueId: fendt.id,
        powerKw: fendt.powerKw, operatingMassKg: fendt.operatingMassKg, frontAxleFraction: fendt.frontAxleFraction, frontTyre: fendt.frontTyre, rearTyre: fendt.rearTyre,
        fuelLPerH: 9, purchaseDate: '2020-03-01', purchasePriceNet: 95000, acquisitionType: 'owned', depreciationMethod: 'linear', usefulLifeYears: 12,
        inspectionUntil: '2027-05-31', defaultEmployeeId: lena.id,
      }).expect(201)
    ).body
    expect(tractor).toMatchObject({ class: 'machine', kind: 'tractor', sciReady: true, defaultEmployeeName: 'Lena', purchasePriceNet: 95000 })
    await post(`${base}/equipment`, { name: 'Falsch', class: 'implement', category: 'tractor_small' }).expect(400)
    const grubber = (await post(`${base}/equipment`, { name: 'Grubber', class: 'implement', category: 'cultivator', mountType: 'three_point', workingWidthM: 3 }).expect(201)).body
    expect(grubber).toMatchObject({ class: 'implement', kind: 'tillage', mountType: 'three_point', workingWidthM: 3, sciReady: false })
    const pivot = (await post(`${base}/equipment`, { name: 'Kreisberegnung', class: 'implement', category: 'irrigation_pivot', irrigationType: 'pivot', irrigationFlowLPerMin: 2000, irrigationCoverageHa: 40 }).expect(201)).body
    expect(pivot).toMatchObject({ irrigationType: 'pivot', irrigationCoverageHa: 40 })

    // Archive hides it from the list.
    await put(`${base}/equipment/${pivot.id}`, { ...pivot, archived: true }).expect(200)
    expect((await get(`${base}/equipment`).expect(200)).body.map((e: { id: string }) => e.id)).not.toContain(pivot.id)
    expect((await get(`${base}/equipment?includeArchived=true`).expect(200)).body.map((e: { id: string }) => e.id)).toContain(pivot.id)

    // Action catalogue.
    await post(`${base}/operation-actions`, { name: 'Grubbern', operationType: 'tillage', machineId: grubber.id }).expect(400)
    const action = (
      await post(`${base}/operation-actions`, { name: 'Grubbern flach', operationType: 'tillage', dieselLPerHa: 12, hoursPerHa: 0.5, machineId: tractor.id, implementId: grubber.id, employeeId: lena.id }).expect(201)
    ).body
    expect(action).toMatchObject({ machineName: 'Fendt 211', implementName: 'Grubber', employeeName: 'Lena', dieselLPerHa: 12, usageCount: 0 })
    await post(`${base}/operation-actions`, { name: 'grubbern FLACH', operationType: 'tillage' }).expect(400)

    // An operation from the action: diesel per hectare drives the diesel emissions.
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    const season = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body.find((x: { harvestYear: number }) => x.harvestYear === 2026)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)
    const op = (
      await post(`${base}/operations`, {
        farmId: farm.id, type: 'tillage', title: 'Grubbern', plannedOn: '2026-03-10', actionId: action.id, dieselLPerHa: 12, fields: [{ fieldId: field.id }],
        equipment: [{ equipmentId: tractor.id, hours: 1 }], labor: [{ employeeId: lena.id, hours: 1 }],
      }).expect(201)
    ).body
    expect(op).toMatchObject({ actionId: action.id, dieselLPerHa: 12 })
    const area = op.fields.reduce((s: number, f: { treatedAreaHa: number }) => s + f.treatedAreaHa, 0)
    await post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: '2026-03-10T09:00:00+01:00' }).expect(200)
    const summary = (await get(`${base}/economics/summary?seasonId=${season.id}`).expect(200)).body
    // 12 l/ha × area × 3.013 kg CO2e/l, not machine hours × 9 l/h.
    expect(summary.carbon.bySource.diesel).toBeCloseTo(12 * area * 3.013, 1)
    expect((await get(`${base}/operation-actions`).expect(200)).body[0].usageCount).toBe(1)

    // Used actions are archived instead of deleted.
    expect((await del(`${base}/operation-actions/${action.id}`).expect(200)).body).toEqual({ archived: true })
    expect((await get(`${base}/operation-actions`).expect(200)).body).toHaveLength(0)
    const spare = (await post(`${base}/operation-actions`, { name: 'Walzen', operationType: 'tillage' }).expect(201)).body
    expect((await del(`${base}/operation-actions/${spare.id}`).expect(200)).body).toEqual({ archived: false })
  })
})
