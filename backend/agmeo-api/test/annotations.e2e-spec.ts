/**
 * Notes drawn on satellite scenes: per field and date, the geometry must match the tool,
 * viewers read but do not write, and other organizations see nothing.
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

const signIn = async (name: string) => {
  const email = `${name}-${run}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  return { email, token: res.body.accessToken as string }
}
const as = (token: string) => {
  const auth = { authorization: `Bearer ${token}` }
  return {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
  }
}

describe('satellite annotations', () => {
  it('stores notes per scene, checks the tool geometry and keeps viewers read-only', async () => {
    const owner = await signIn('ann-owner')
    const viewer = await signIn('ann-viewer')
    const stranger = await signIn('ann-stranger')
    const o = as(owner.token)
    const org = (await o.post('/orgs', { name: `Notizen ${run}` }).expect(201)).body
    await o.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    const farm = (await o.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await o.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'A', geometry: rect(10, 52, 10.01, 52.01) }).expect(201)).body
    const base = `/orgs/${org.id}/fields/${field.id}/annotations`

    const marker = (
      await o
        .post(base, { date: '2026-06-01', layer: 'ndvi', kind: 'marker', color: '#ef4444', note: ' Fahrgasse nass ', geometry: { type: 'Point', coordinates: [10.005, 52.005] } })
        .expect(201)
    ).body
    expect(marker).toMatchObject({ date: '2026-06-01', layer: 'ndvi', kind: 'marker', note: 'Fahrgasse nass', geometry: { type: 'Point', coordinates: [10.005, 52.005] } })
    await o.post(base, { date: '2026-06-01', kind: 'rectangle', color: '#3b82f6', geometry: rect(10.002, 52.002, 10.004, 52.004) }).expect(201)
    await o.post(base, { date: '2026-06-11', kind: 'freehand', color: '#22c55e', geometry: { type: 'LineString', coordinates: [[10.001, 52.001], [10.002, 52.003]] } }).expect(201)
    // A marker drawn as a polygon, or a colour outside the palette, is refused.
    await o.post(base, { date: '2026-06-01', kind: 'marker', color: '#ef4444', geometry: rect(10, 52, 10.001, 52.001) }).expect(400)
    await o.post(base, { date: '2026-06-01', kind: 'marker', color: '#123456', geometry: { type: 'Point', coordinates: [10, 52] } }).expect(400)

    expect((await o.get(base).expect(200)).body).toHaveLength(3)
    const june1 = (await o.get(`${base}?date=2026-06-01`).expect(200)).body
    expect(june1.map((a: { kind: string }) => a.kind).sort()).toEqual(['marker', 'rectangle'])

    expect((await o.patch(`${base}/${marker.id}`, { note: 'Staunässe' }).expect(200)).body.note).toBe('Staunässe')

    const v = as(viewer.token)
    expect((await v.get(base).expect(200)).body).toHaveLength(3)
    await v.post(base, { date: '2026-06-01', kind: 'marker', color: '#ef4444', geometry: { type: 'Point', coordinates: [10, 52] } }).expect(403)
    await v.del(`${base}/${marker.id}`).expect(403)

    const s = as(stranger.token)
    const other = (await s.post('/orgs', { name: `Fremd ${run}` }).expect(201)).body
    await s.get(`/orgs/${other.id}/fields/${field.id}/annotations`).expect(404)

    await o.del(`${base}/${marker.id}`).expect(204)
    await o.del(`${base}/${marker.id}`).expect(404)
    expect((await o.get(`${base}?date=2026-06-01`).expect(200)).body).toHaveLength(1)
  })
})
