/**
 * Documents attached to a field: uploaded into the "Field documents" folder per harvest year,
 * existing files linked, and detaching trashes only files that were uploaded here.
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

async function signIn(name: string) {
  const email = `${name}-${run}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    email,
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
    upload: (url: string, files: { name: string; data: Buffer }[], fields: Record<string, string> = {}) => {
      let r = http().post(`/v1${url}`).set(auth).field('names', JSON.stringify(files.map((f) => f.name)))
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
      for (const f of files) r = r.attach('files', f.data, 'upload.bin')
      return r
    },
  }
}

describe('field documents', () => {
  it('uploads, links, filters by year and detaches documents', async () => {
    const u = await signIn('docs-owner')
    const viewer = await signIn('docs-viewer')
    const org = (await u.post('/orgs', { name: `Dokumente ${run}` }).expect(201)).body
    await u.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    const farm = (await u.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'A', geometry: rect(10, 52, 10.01, 52.01) }).expect(201)).body
    const other = (await u.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'B', geometry: rect(10.02, 52, 10.03, 52.01) }).expect(201)).body
    const base = `/orgs/${org.id}/fields/${field.id}/documents`

    const [lease] = (await u.upload(base, [{ name: 'Pachtvertrag.pdf', data: Buffer.from('%PDF-1.4 lease') }]).expect(201)).body
    expect(lease).toMatchObject({ name: 'Pachtvertrag.pdf', harvestYear: null })
    const [plan] = (await u.upload(base, [{ name: 'Düngeplan 2027.pdf', data: Buffer.from('%PDF-1.4 plan') }], { harvestYear: '2027' }).expect(201)).body
    expect(plan.harvestYear).toBe(2027)

    // Uploads land in the "Schlagdokumente" system folder.
    const folders = (await u.get(`/orgs/${org.id}/files/folders`).expect(200)).body
    const docsFolder = folders.find((f: { systemKey: string | null }) => f.systemKey === 'fieldDocuments')
    expect(docsFolder?.name).toBe('Schlagdokumente')
    expect(plan.folderId).toBe(docsFolder.id)

    // A year shows its own documents and the field-wide ones.
    expect((await u.get(`${base}?harvestYear=2027`).expect(200)).body.map((d: { name: string }) => d.name).sort()).toEqual(['Düngeplan 2027.pdf', 'Pachtvertrag.pdf'])
    expect((await u.get(`${base}?harvestYear=2026`).expect(200)).body.map((d: { name: string }) => d.name)).toEqual(['Pachtvertrag.pdf'])

    // A file filed by hand is linked to both fields; detaching it keeps the file.
    const [map] = (await u.upload(`/orgs/${org.id}/files/upload`, [{ name: 'Drainage.pdf', data: Buffer.from('%PDF-1.4 d') }]).expect(201)).body
    await u.post(`${base}/link`, { fileIds: [map.id], harvestYear: null }).expect(201)
    await u.post(`/orgs/${org.id}/fields/${other.id}/documents/link`, { fileIds: [map.id] }).expect(201)
    await u.del(`${base}/${map.id}`).expect(204)
    await u.get(`/orgs/${org.id}/files/${map.id}`).expect(200)
    expect((await u.get(`/orgs/${org.id}/fields/${other.id}/documents`).expect(200)).body).toHaveLength(1)

    // Viewers read but do not change.
    expect((await viewer.get(base).expect(200)).body).toHaveLength(2)
    await viewer.del(`${base}/${plan.id}`).expect(403)

    // Detaching an uploaded document moves it to the trash.
    await u.del(`${base}/${plan.id}`).expect(204)
    await u.get(`/orgs/${org.id}/files/${plan.id}`).expect(404)
    await u.del(`${base}/${plan.id}`).expect(404)
    await u.post(`${base}/link`, { fileIds: [plan.id] }).expect(404)
  })
})
