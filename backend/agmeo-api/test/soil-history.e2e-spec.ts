/**
 * Soil history: campaigns of a field with their means, past states of several fields' zone
 * maps with bulk restore, and the analysis dashboard's data.
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

describe('soil history and analysis', () => {
  it('lists campaigns, restores past states and aggregates the analysis', { timeout: 60_000 }, async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `soilh-${run}@example.test`, displayName: 'Verlauf' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const patch = (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `Verlauf ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'Acker', geometry: rect(9.96, 52.31, 9.963, 52.312) }).expect(201)).body
    const b = (await post(`${base}/fields`, { farmId: farm.id, name: 'Bach', geometry: rect(9.97, 52.31, 9.973, 52.312) }).expect(201)).body
    await http().patch(`/v1${base}/fields/${a.id}/site`).set(auth).send({ soilTexture: 'sL' }).expect(200)

    // Campaign 1: two zones sampled in 2024.
    const first = (await post(`${base}/soil/plans`, { fieldIds: [a.id, b.id], mode: 'voronoi', cellHa: 2 }).expect(201)).body
    expect(first.results.map((r: { status: string }) => r.status)).toEqual(['created', 'created'])
    let detail = (await get(`${base}/fields/${a.id}/soil`).expect(200)).body
    const firstZonation = detail.zonation.id as string
    for (const [i, z] of (detail.zonation.zones as { id: string }[]).entries()) {
      await patch(`${base}/soil/zones/${z.id}`, { values: { ph: 5.4 + i * 0.4, p2o5: 4 + i * 6, humus: 2.4 }, sampledOn: '2024-03-01' }).expect(200)
    }
    // Campaign 2: a new grid, sampled in 2026.
    await post(`${base}/fields/${a.id}/soil/plan`, { mode: 'grid', cellHa: 10 }).expect(201)
    detail = (await get(`${base}/fields/${a.id}/soil`).expect(200)).body
    await patch(`${base}/soil/zones/${detail.zonation.zones[0].id}`, { values: { ph: 6.6, p2o5: 20 }, sampledOn: '2026-03-01' }).expect(200)

    const history = (await get(`${base}/fields/${a.id}/soil/history`).expect(200)).body
    expect(history.campaigns.map((c: { method: string; active: boolean; sampledOn: string }) => [c.method, c.active, c.sampledOn])).toEqual([
      ['grid', true, '2026-03-01'],
      ['voronoi', false, '2024-03-01'],
    ])
    expect(history.campaigns[1].means.ph).toBeGreaterThan(5.4)
    expect(history.campaigns[1].means.ph).toBeLessThan(5.8)
    expect(history.campaigns[0].means).toMatchObject({ ph: 6.6, p2o5: 20 })

    // States: the batch of both fields, and the end of today.
    const states = (await get(`${base}/soil/history/states?fieldIds=${a.id},${b.id}`).expect(200)).body
    const batch = states.find((s: { key: string }) => s.key === `batch:${first.batchId}`)
    expect(batch).toMatchObject({ kind: 'batch', willChange: 1, unchanged: 1, noZonation: 0 })
    expect(states.some((s: { kind: string }) => s.kind === 'day')).toBe(true)
    await get(`${base}/soil/history/states?fieldIds=nope`).expect(400)

    const restored = (await post(`${base}/soil/history/restore`, { zonationIds: batch.fields.map((f: { zonationId: string }) => f.zonationId) }).expect(200)).body
    expect(restored).toEqual({ restored: 1, unchanged: 1 })
    expect((await get(`${base}/fields/${a.id}/soil`).expect(200)).body.zonation.id).toBe(firstZonation)

    // Analysis: zones of the active zonations that carry lab values.
    const analysis = (await get(`${base}/soil/analysis`).expect(200)).body
    expect(analysis.totalFieldCount).toBe(2)
    expect(analysis.fields).toHaveLength(1)
    expect(analysis.fields[0]).toMatchObject({ id: a.id, name: 'Acker', soilTexture: 'sL' })
    expect(analysis.fields[0].bbox).toHaveLength(4)
    expect(analysis.zones.length).toBe(analysis.fields[0].sampleCount)
    expect(analysis.zones[0]).toMatchObject({ fieldId: a.id, year: 2024 })
    expect(analysis.zones.some((z: { limeDt: number | null }) => (z.limeDt ?? 0) > 0)).toBe(true)
  })
})
