/**
 * Settings tabs: logo, notification e-mails with unsubscribe links, organization export, the
 * soil zonation lock and the onboarding step.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { deflateSync } from 'node:zlib'
import { AppModule } from '../src/app.module.js'
import { signUnsubscribeToken } from '../src/mail/unsubscribe.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
}
/** 1×1 RGBA PNG. */
const PNG = (() => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 47, 93, 30, 255]))), chunk('IEND', Buffer.alloc(0))])
})()

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

async function signIn(name: string) {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `${name}-${run}@example.test`, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    userId: res.body.user.id as string,
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
    upload: (url: string, data: Buffer, name: string) => http().put(`/v1${url}`).set(auth).attach('file', data, name),
    download: (url: string) => http().get(`/v1${url}`).set(auth).buffer(true).parse(binary),
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  await app?.close()
})

describe('organization settings', () => {
  it('stores, serves and removes the logo', async () => {
    const u = await signIn('logo')
    const org = (await u.post('/orgs', { name: `Logo ${run}` }).expect(201)).body
    expect(org.logoUpdatedAt).toBeNull()
    await u.get(`/orgs/${org.id}/logo`).expect(404)
    await u.upload(`/orgs/${org.id}/logo`, Buffer.from('GIF89a not a logo'), 'logo.gif').expect(400)
    await u.upload(`/orgs/${org.id}/logo`, PNG, 'logo.png').expect(204)
    const logo = await u.download(`/orgs/${org.id}/logo`).expect(200)
    expect(logo.headers['content-type']).toBe('image/png')
    expect(Buffer.compare(logo.body as Buffer, PNG)).toBe(0)
    expect((await u.get(`/orgs/${org.id}`).expect(200)).body.logoUpdatedAt).not.toBeNull()

    // Viewers see the logo but cannot change it.
    const viewerEmail = `logo-viewer-${run}@example.test`
    await u.post(`/orgs/${org.id}/members`, { email: viewerEmail, role: 'viewer' }).expect(201)
    const viewer = await signIn('logo-viewer')
    await viewer.download(`/orgs/${org.id}/logo`).expect(200)
    await viewer.upload(`/orgs/${org.id}/logo`, PNG, 'logo.png').expect(403)

    await u.del(`/orgs/${org.id}/logo`).expect(204)
    await u.get(`/orgs/${org.id}/logo`).expect(404)
  })

  it('keeps notification switches per user and honours unsubscribe links', async () => {
    const u = await signIn('notify')
    expect((await u.get('/me/notifications').expect(200)).body).toEqual({ rain_digest: true, storage_digest: true })
    expect((await u.put('/me/notifications', { storage_digest: false }).expect(200)).body).toEqual({ rain_digest: true, storage_digest: false })

    await http().post('/v1/notifications/unsubscribe').send({ token: 'not-a-valid-token' }).expect(400)
    const token = signUnsubscribeToken(u.userId, 'rain_digest')
    const res = await http().post('/v1/notifications/unsubscribe').send({ token }).expect(200)
    expect(res.body).toEqual({ key: 'rain_digest', email: `notify-${run}@example.test` })
    expect((await u.get('/me/notifications').expect(200)).body.rain_digest).toBe(false)
    await http().post(`/v1/notifications/unsubscribe/one-click?token=${encodeURIComponent(token)}`).expect(200)
  })

  it('lists the services that process data for this deployment', async () => {
    const u = await signIn('dpa')
    const org = (await u.post('/orgs', { name: `DPA ${run}` }).expect(201)).body
    const rows = (await u.get(`/orgs/${org.id}/data-processing`).expect(200)).body as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['hosting', 'database', 'email', 'weather', 'geocoding']))
  })

  it('switches organization settings and the onboarding step', async () => {
    const u = await signIn('orgflags')
    const org = (await u.post('/orgs', { name: `Flags ${run}` }).expect(201)).body
    expect(org).toMatchObject({ onboardingStep: null, rainDigestEnabled: false, lockZonedFields: false, farmIds: null })
    const updated = (await u.patch(`/orgs/${org.id}`, { onboardingStep: 'crops', rainDigestEnabled: true }).expect(200)).body
    expect(updated).toMatchObject({ onboardingStep: 'crops', rainDigestEnabled: true })
    await u.patch(`/orgs/${org.id}`, { onboardingStep: 'unknown' }).expect(400)
    expect((await u.patch(`/orgs/${org.id}`, { onboardingStep: null }).expect(200)).body.onboardingStep).toBeNull()
  })

  it('exports the organization as a ZIP of tables and field boundaries', async () => {
    const u = await signIn('export')
    const org = (await u.post('/orgs', { name: `Export ${run}` }).expect(201)).body
    const farm = (await u.post(`/orgs/${org.id}/farms`, { name: 'Hof Export' }).expect(201)).body
    await u.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)
    const csv = await u.download(`/orgs/${org.id}/export?format=csv`).expect(200)
    expect(csv.headers['content-type']).toBe('application/zip')
    const body = (csv.body as Buffer).toString('latin1')
    for (const name of ['farms.csv', 'fields.csv', 'fields.geojson', 'fields_shapefile.zip']) expect(body).toContain(name)
    expect(body).not.toContain('audit_events')
    const json = await u.download(`/orgs/${org.id}/export?format=json`).expect(200)
    expect((json.body as Buffer).toString('latin1')).toContain('farms.json')
    await u.get(`/orgs/${org.id}/export?format=xml`).expect(400)
  })

  it('locks fields with a soil zonation when the organization asks for it', async () => {
    const u = await signIn('lock')
    const org = (await u.post('/orgs', { name: `Lock ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    await u.post(`${base}/fields/${field.id}/soil/plan`, { mode: 'grid', cellHa: 1 }).expect(201)
    await u.patch(base, { lockZonedFields: true }).expect(200)
    await u.post(`${base}/fields/${field.id}/soil/plan`, { mode: 'grid', cellHa: 2 }).expect(409)
    await u.del(`${base}/fields/${field.id}/soil/zonation`).expect(409)
    const batch = (await u.post(`${base}/soil/zonations`, { fieldIds: [field.id] }).expect(201)).body
    expect(batch.results[0]).toMatchObject({ status: 'skipped', reason: 'locked' })
    await u.patch(base, { lockZonedFields: false }).expect(200)
    await u.post(`${base}/fields/${field.id}/soil/plan`, { mode: 'grid', cellHa: 2 }).expect(201)
  })
})
