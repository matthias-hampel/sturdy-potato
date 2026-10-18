/**
 * Crop calendar over several years, seed multiplication details and the organization's crop colours.
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

describe('crop calendar', () => {
  it('lists several years with every field, seed lots and own crop colours', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `cal-${run}@example.test`, displayName: 'Cal' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const patch = (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `Cal ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    const b = (await post(`${base}/fields`, { farmId: farm.id, name: 'B', geometry: rect(9.963, 52.31, 9.965, 52.312) }).expect(201)).body
    const seasons = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body
    const s26 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2026)
    const s27 = (await post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2027)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string; color: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!

    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: s26.id, fieldIds: [a.id], cropId: wheat.id, usage: 'seed_multiplication', seedLot: 'P-123', multiplicationGeneration: 'Z1', sowingDate: '2025-10-05' }).expect(201)).body
    expect(cycle).toMatchObject({ usage: 'seed_multiplication', seedLot: 'P-123', multiplicationGeneration: 'Z1' })
    await post(`${base}/crop-cycles`, { seasonId: s27.id, fieldIds: [a.id], cropId: wheat.id, seedLot: 'ignored' }).expect(201)

    const cal = (await get(`${base}/crop-calendar/years?fromYear=2025&toYear=2028`).expect(200)).body
    expect(cal.seasons.map((s: { harvestYear: number }) => s.harvestYear)).toEqual([2026, 2027])
    expect(cal.fields.map((f: { id: string }) => f.id).sort()).toEqual([a.id, b.id].sort())
    expect(cal.rows).toHaveLength(2)
    expect(cal.rows.find((r: { harvestYear: number }) => r.harvestYear === 2026)).toMatchObject({ cropId: wheat.id, seedLot: 'P-123', sowing: { date: '2025-10-05', source: 'planned' } })
    expect(cal.rows.find((r: { harvestYear: number }) => r.harvestYear === 2027)).toMatchObject({ usage: 'commercial', seedLot: null })

    // Switching back to commercial clears the seed details.
    expect((await patch(`${base}/crop-cycles/${cycle.id}`, { usage: 'commercial' }).expect(200)).body).toMatchObject({ seedLot: null, multiplicationGeneration: null })

    await put(`${base}/crop-colors`, { colors: { [wheat.id]: '#123456' } }).expect(200)
    expect((await get(`${base}/crops`).expect(200)).body.find((c: { id: string }) => c.id === wheat.id).color).toBe('#123456')
    expect((await get(`${base}/crop-calendar/years?fromYear=2026&toYear=2026`).expect(200)).body.rows[0].cropColor).toBe('#123456')
    expect((await get(`${base}/fields`).expect(200)).body.find((f: { id: string }) => f.id === a.id)).toBeDefined()
    await put(`${base}/crop-colors`, { colors: { [wheat.id]: null } }).expect(200)
    expect((await get(`${base}/crop-colors`).expect(200)).body).toEqual({})
    expect((await get(`${base}/crops`).expect(200)).body.find((c: { id: string }) => c.id === wheat.id).color).toBe(wheat.color)

    await get(`${base}/crop-calendar/years?fromYear=2020&toYear=2035`).expect(400)
  })
})
