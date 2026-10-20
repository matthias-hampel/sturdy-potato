/**
 * Public soil share links: created with a password and expiry, opened without signing in,
 * the archived lab file downloaded, revoked.
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

describe('soil share links', () => {
  it('shares lab results behind a password, without sign-in, until revoked', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `soils-${run}@example.test`, displayName: 'Freigabe' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `Freigabe ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'Am Bach', geometry: rect(9.96, 52.31, 9.963, 52.312) }).expect(201)).body
    const b = (await post(`${base}/fields`, { farmId: farm.id, name: 'Nicht geteilt', geometry: rect(9.97, 52.31, 9.971, 52.311) }).expect(201)).body
    await post(`${base}/fields/${a.id}/soil/plan`, { mode: 'voronoi', points: [[9.961, 52.311], [9.962, 52.311]] }).expect(201)
    await post(`${base}/fields/${b.id}/soil/plan`, { mode: 'grid', cellHa: 5 }).expect(201)
    await post(`${base}/soil/probe-numbers`, { fieldIds: [a.id], start: 1 }).expect(200)
    const csv = Buffer.from('Gpsnr;PNDatum;pH;P\n1;06.03.2026;6,4;5,2\n2;06.03.2026;5,8;3', 'utf8')
    const imported = (
      await http().post(`/v1${base}/soil/lab-results`).set(auth).attach('files', csv, 'Labor.csv').field('names', JSON.stringify(['Labor.csv'])).expect(201)
    ).body

    await post(`${base}/soil/shares`, { title: 'X', fieldIds: [] }).expect(400)
    await post(`${base}/soil/shares`, { title: 'X', fieldIds: [a.id], password: 'kurz' }).expect(400)
    const share = (await post(`${base}/soil/shares`, { title: 'Bodenproben 2026', fieldIds: [a.id], password: 'geheim123', labImportId: imported.importId }).expect(201)).body
    expect(share).toMatchObject({ kind: 'results', hasPassword: true, hasFile: true, fieldNames: ['Am Bach'], revokedAt: null })
    expect((await get(`${base}/soil/shares`).expect(200)).body[0].id).toBe(share.id)

    // Anyone with the link sees title and the password prompt; no data without the password.
    const pub = `/v1/share/soil/${share.token}`
    expect((await http().get(pub).expect(200)).body).toMatchObject({ title: 'Bodenproben 2026', orgName: `Freigabe ${run}`, status: 'ok', requiresPassword: true, hasFile: true })
    await http().get('/v1/share/soil/unknown-token-unknown-token').expect(404)
    await http().post(`${pub}/open`).send({}).expect(401)
    await http().post(`${pub}/open`).send({ password: 'falsch!!' }).expect(401)
    const data = (await http().post(`${pub}/open`).send({ password: 'geheim123' }).expect(200)).body
    expect(data.fields.map((f: { fieldName: string }) => f.fieldName)).toEqual(['Am Bach'])
    expect(data.params).toEqual(['ph', 'p2o5'])
    expect(data.fields[0].campaigns).toHaveLength(1)
    expect(data.fields[0].campaigns[0]).toMatchObject({ active: true, sampledOn: '2026-03-06' })
    expect(data.fields[0].campaigns[0].zones[0]).toMatchObject({ probeNr: 1, values: { ph: 6.4 } })

    // The access token replaces the password for later requests and the file download.
    await http().post(`${pub}/open`).set('x-share-access', data.accessToken).send({}).expect(200)
    const file = await http().get(`${pub}/file?access=${encodeURIComponent(data.accessToken)}`).buffer(true).expect(200)
    expect(file.headers['content-disposition']).toContain('Labor.csv')
    await http().get(`${pub}/file`).expect(401)

    // A new password invalidates handed-out access tokens.
    await http().patch(`/v1${base}/soil/shares/${share.id}`).set(auth).send({ password: 'anders456' }).expect(200)
    await http().post(`${pub}/open`).set('x-share-access', data.accessToken).send({}).expect(401)

    // History permalink of all fields, without password.
    const history = (await post(`${base}/soil/shares`, { kind: 'history', title: 'Historie', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body
    const hist = (await http().post(`/v1/share/soil/${history.token}/open`).send({}).expect(200)).body
    expect(hist.fields.map((f: { fieldName: string }) => f.fieldName)).toEqual(['Am Bach', 'Nicht geteilt'])

    // Expired and revoked links answer 410.
    await http().patch(`/v1${base}/soil/shares/${history.id}`).set(auth).send({ expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(200)
    expect((await http().get(`/v1/share/soil/${history.token}`).expect(200)).body.status).toBe('expired')
    await http().post(`/v1/share/soil/${history.token}/open`).send({}).expect(410)
    await http().delete(`/v1${base}/soil/shares/${share.id}`).set(auth).expect(204)
    expect((await http().get(pub).expect(200)).body.status).toBe('revoked')
    await http().post(`${pub}/open`).send({ password: 'anders456' }).expect(410)
    await http().delete(`/v1${base}/soil/shares/${share.id}`).set(auth).expect(404)
  })
})
