/**
 * KTBL reference actions: listing by operation type and crop, per-hectare estimates and an
 * organization action filled from one.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'

const run = Math.random().toString(36).slice(2, 8)

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

describe('KTBL actions', () => {
  it('lists actions, estimates them for a crop and fills an organization action', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `ktbl-${run}@example.test`, displayName: 'KTBL' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `KTBL ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`

    // Tillage actions, all of them or those the reference offers for winter wheat.
    const tillage = (await get(`${base}/ktbl/actions?operationType=tillage`).expect(200)).body as { fqn: string; operationType: string; label: { de: string; en: string } }[]
    expect(tillage.length).toBeGreaterThan(100)
    expect(tillage.every((a) => a.operationType === 'tillage')).toBe(true)
    const plow = tillage.find((a) => a.fqn === 'PLOWING__RP7_1000')!
    expect(plow).toMatchObject({ group: { de: 'Pflügen', en: 'Plowing' }, label: { de: 'Drehpflug (7 Körper, 2.45 m, gezogen), 83 kW' } })
    expect(tillage.map((a) => a.fqn)).toContain('SEEDBED_PREPARATION__BF2_1000')
    const forWheat = (await get(`${base}/ktbl/actions?operationType=tillage&crop=winter_wheat`).expect(200)).body as { fqn: string }[]
    expect(forWheat.map((a) => a.fqn)).toContain('PLOWING__RP7_1000')
    expect(forWheat.map((a) => a.fqn)).not.toContain('SEEDBED_PREPARATION__BF2_1000')
    expect((await get(`${base}/ktbl/actions?q=drehpflug 7 körper`).expect(200)).body.map((a: { fqn: string }) => a.fqn)).toContain('PLOWING__RP7_1000')
    await get(`${base}/ktbl/actions?crop=no_such_crop`).expect(400)
    await get(`${base}/ktbl/actions?operationType=dancing`).expect(400)

    // Estimate for winter wheat (by id or code): the KTBL cereal table at 10 ha, 5 km, 120 kW.
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!
    const estimate = (await get(`${base}/ktbl/estimate?fqn=PLOWING__RP7_1000&crop=${wheat.id}&fieldSizeHa=10&distanceKm=5&mechKw=120`).expect(200)).body
    expect(estimate).toEqual({
      fqn: 'PLOWING__RP7_1000', cropGroup: 'cereals', method: 'grid', fieldSizeHa: 10, distanceKm: 5, mechKw: 120,
      hours: 1.03, diesel: 15.92, depreciation: 14, interest: 4.12, miscellaneous: 2.04, repairs: 19.7, materials: 13.53, services: 0,
    })
    expect((await get(`${base}/ktbl/estimate?fqn=PLOWING__RP7_1000&crop=winter_wheat`).expect(200)).body).toEqual(estimate)
    expect((await get(`${base}/ktbl/estimate?fqn=PLOWING__RP7_1000&cropGroup=cereals&fieldSizeHa=20`).expect(200)).body).toMatchObject({ hours: 0.98, diesel: 15.66 })
    const noCrop = (await get(`${base}/ktbl/estimate?fqn=PLOWING__RP7_1000`).expect(200)).body
    expect(noCrop).toMatchObject({ cropGroup: null, method: 'formula', fieldSizeHa: 10, distanceKm: 5, mechKw: 120 })
    expect(noCrop.hours).toBeCloseTo(0.931, 3)
    await get(`${base}/ktbl/estimate?fqn=NOPE__X_1000`).expect(404)
    await get(`${base}/ktbl/estimate?fqn=PLOWING__RP7_1000&fieldSizeHa=-1`).expect(400)

    // An organization action filled from it remembers its source.
    const action = (
      await post(`${base}/operation-actions`, { name: plow.label.de, operationType: 'tillage', dieselLPerHa: estimate.diesel, hoursPerHa: estimate.hours, ktblFqn: plow.fqn }).expect(201)
    ).body
    expect(action).toMatchObject({ name: 'Drehpflug (7 Körper, 2.45 m, gezogen), 83 kW', operationType: 'tillage', dieselLPerHa: 15.92, hoursPerHa: 1.03, ktblFqn: 'PLOWING__RP7_1000' })
    expect((await get(`${base}/operation-actions`).expect(200)).body[0].ktblFqn).toBe('PLOWING__RP7_1000')
    await post(`${base}/operation-actions`, { name: 'Erfunden', operationType: 'tillage', ktblFqn: 'NOPE__X_1000' }).expect(400)
  })
})
