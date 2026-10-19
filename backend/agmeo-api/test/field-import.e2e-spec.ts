/**
 * Field import end to end: boundaries from a file, optionally with the main crop of a season
 * (as the subsidy-application and ISO-XML imports send it).
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

async function setup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `imp-${run}-${Math.random()}@example.test`, displayName: 'Import' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Import ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof Import' }).expect(201)).body
  const season = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body[0]
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string; landUseCode: string | null }[]
  return { u, base, farm, season, crops }
}

describe('field import', () => {
  it('creates fields and plans the given crops in the season', async () => {
    const { u, base, farm, season, crops } = await setup()
    const wheat = crops.find((c) => c.code === 'winter_wheat')!
    expect(wheat.landUseCode).toBeTruthy()
    const result = (
      await u
        .post(`${base}/fields/import`, {
          farmId: farm.id,
          seasonId: season.id,
          features: [
            { name: 'Am Bach', identifier: '1', geometry: rect(9.96, 52.31, 9.97, 52.315), cropId: wheat.id, landUseCode: wheat.landUseCode },
            { name: 'Hinterm Hof', identifier: '2', geometry: rect(9.98, 52.31, 9.99, 52.315), cropId: wheat.id, landUseCode: '116' },
            { name: 'Unbekannt', identifier: '3', geometry: rect(10.02, 52.31, 10.03, 52.315), cropId: wheat.id, landUseCode: '99999' },
            { name: 'Brache', identifier: '4', geometry: rect(10.0, 52.31, 10.01, 52.315) },
          ],
        })
        .expect(201)
    ).body
    expect(result.created).toHaveLength(4)
    expect(result.cropsAssigned).toBe(3)
    expect(result.errors).toEqual([])

    const cycles = (await u.get(`${base}/crop-cycles?seasonId=${season.id}`).expect(200)).body as { fieldName: string; cropId: string; status: string; landUseCode: string | null; landUseCodeIsDefault: boolean }[]
    const byField = Object.fromEntries(cycles.map((c) => [c.fieldName, c]))
    expect(Object.keys(byField).sort()).toEqual(['Am Bach', 'Hinterm Hof', 'Unbekannt'])
    expect(byField['Am Bach']).toMatchObject({ cropId: wheat.id, status: 'planned', landUseCode: wheat.landUseCode, landUseCodeIsDefault: true })
    expect(byField['Hinterm Hof']).toMatchObject({ landUseCode: '116', landUseCodeIsDefault: false })
    expect(byField['Unbekannt']).toMatchObject({ landUseCode: wheat.landUseCode, landUseCodeIsDefault: true })
  })

  it('needs a season when crops are given', async () => {
    const { u, base, farm, crops } = await setup()
    const res = await u
      .post(`${base}/fields/import`, { farmId: farm.id, features: [{ name: 'A', geometry: rect(9.96, 52.31, 9.97, 52.315), cropId: crops[0].id }] })
      .expect(400)
    expect(res.body.code).toBe('season_required')
  })
})
