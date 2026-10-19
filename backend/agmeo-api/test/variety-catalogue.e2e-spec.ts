/**
 * Variety browser over the Beschreibende Sortenliste: the import (as the reference-data role),
 * species with the organization's crops, traits and 1–9 ratings per variety, details and the
 * resistance lookup by name or crop cycle.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import { syncBsl } from '../src/refdata/bsl.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

beforeAll(async () => {
  const refdata = createKysely(config.refdataDatabaseUrl, 1)
  try {
    const r = await syncBsl(refdata)
    expect(r.varieties).toBe(2231)
  } finally {
    await refdata.destroy()
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('variety catalogue', () => {
  it('lists BSL varieties with traits and disease ratings', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `bsl-${run}@example.test`, displayName: 'BSL' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `BSL ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`

    const species = (await u.get(`${base}/variety-catalogue/species`).expect(200)).body as { key: string; speciesCode: string | null; count: number; crops: { id: string; name: string }[] }[]
    const ww = species.find((s) => s.key === 'WW')!
    expect(ww.count).toBeGreaterThan(400)
    expect(ww.crops.map((c) => c.name)).toContain('Winterweizen')
    expect(species.find((s) => s.key === 'bsl:hanf')).toMatchObject({ speciesCode: null, crops: [] })

    // By crop: winter wheat has ratings on the 1–9 scale and sowing traits.
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!
    const list = (await u.get(`${base}/variety-catalogue?cropId=${wheat.id}`).expect(200)).body as {
      id: string
      name: string
      speciesCode: string
      ratings: { disease: string; susceptibility: number }[]
      traits: Record<string, { value: number }>
      propertiesCount: number
    }[]
    expect(list.length).toBe(ww.count)
    expect(list.every((v) => v.speciesCode === 'WW')).toBe(true)
    const rated = list.filter((v) => v.ratings.length)
    expect(rated.length).toBeGreaterThan(100)
    expect(rated.every((v) => v.ratings.every((r) => r.susceptibility >= 1 && r.susceptibility <= 9))).toBe(true)
    expect(list.some((v) => v.traits.lodging && v.traits.maturity)).toBe(true)

    // Search and details.
    const v = rated[0]
    const found = (await u.get(`${base}/variety-catalogue?q=${encodeURIComponent(v.name.toLowerCase())}`).expect(200)).body as { id: string }[]
    expect(found.map((x) => x.id)).toContain(v.id)
    const detail = (await u.get(`${base}/variety-catalogue/${v.id}`).expect(200)).body
    expect(detail.properties.length).toBe(v.propertiesCount + detail.qualityCount)
    expect(detail.properties[0]).toMatchObject({ kind: 'property', name: expect.any(String) })
    await u.get(`${base}/variety-catalogue`).expect(400)
    await u.get(`${base}/variety-catalogue/00000000-0000-4000-8000-000000000000`).expect(404)

    // Resistance by name and through a crop cycle's variety.
    const byName = (await u.get(`${base}/variety-catalogue/resistance?variety=${encodeURIComponent(v.name)}`).expect(200)).body
    expect(byName).toMatchObject({ variety: v.name, ratings: v.ratings })
    await u.get(`${base}/variety-catalogue/resistance?variety=Gibtesnicht${run}`).expect(404)
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const variety = (await u.post(`${base}/varieties`, { cropId: wheat.id, name: v.name }).expect(201)).body
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheat.id, varietyId: variety.id }).expect(201)).body[0]
    const byCycle = (await u.get(`${base}/variety-catalogue/resistance?cropCycleId=${cycle.id}`).expect(200)).body
    expect(byCycle).toMatchObject({ crop: 'Winterweizen', variety: v.name })
    expect(byCycle.ratings.length).toBeGreaterThan(0)
  })
})
