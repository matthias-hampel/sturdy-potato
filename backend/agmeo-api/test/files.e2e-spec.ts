/**
 * Files: folders, uploads, moving, copying, the trash, zips and the storage allowance.
 * Objects go to the local storage driver (STORAGE_DRIVER=local).
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { ZipArchive } from 'archiver'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'
import { toBuffer } from '../src/modules/files/zip.js'

const run = Math.random().toString(36).slice(2, 8)
let app: INestApplication<App>
const http = () => request(app.getHttpServer())
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 2)

async function signIn(name: string) {
  const email = `${name}-${run}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    email,
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
    upload: (url: string, files: { name: string; data: Buffer }[], fields: Record<string, string> = {}) => {
      let r = http().post(`/v1${url}`).set(auth).field('names', JSON.stringify(files.map((f) => f.name)))
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
      for (const f of files) r = r.attach('files', f.data, 'upload.bin')
      return r
    },
  }
}

async function zipOf(entries: Record<string, string>) {
  const a = new ZipArchive()
  for (const [path, text] of Object.entries(entries)) a.append(Buffer.from(text), { name: path })
  void a.finalize()
  return toBuffer(a)
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  await app?.close()
  await owner.destroy()
})

describe('files', () => {
  it('organizes files in folders and keeps names unique per folder', async () => {
    const u = await signIn('files')
    const org = (await u.post('/orgs', { name: `Files ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}/files`

    const docs = (await u.post(`${base}/folders`, { name: 'Belege' }).expect(201)).body
    expect((await u.post(`${base}/folders`, { name: 'belege' }).expect(201)).body.name).toBe('belege (2)')

    const up = (await u.upload(`${base}/upload`, [{ name: 'Rechnung Dünger.pdf', data: Buffer.from('%PDF-1.4 test') }, { name: 'Rechnung Dünger.pdf', data: Buffer.from('second') }], { folderId: docs.id, year: '2027' }).expect(201)).body
    expect(up.map((f: { name: string }) => f.name).sort()).toEqual(['Rechnung Dünger (2).pdf', 'Rechnung Dünger.pdf'])
    expect(up[0]).toMatchObject({ folderId: docs.id, year: 2027, mimeType: 'application/pdf' })

    const listing = (await u.get(`${base}?folderId=${docs.id}`).expect(200)).body
    expect(listing.files).toHaveLength(2)
    const top = (await u.get(base).expect(200)).body
    expect(top.folders.find((f: { id: string }) => f.id === docs.id).itemCount).toBe(2)

    // Search spans all folders and matches every word.
    expect((await u.get(`${base}?search=dünger rechnung`).expect(200)).body.files).toHaveLength(2)
    expect((await u.get(`${base}?search=dünger kalk`).expect(200)).body.files).toHaveLength(0)

    const content = await u.get(`${base}/${up[0].id}/content`).expect(200)
    expect(content.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect(content.headers['content-type']).toBe('application/octet-stream')
    const inline = await u.get(`${base}/${up[0].id}/content?inline=1`).expect(200)
    expect(inline.headers['content-type']).toBe('application/pdf')

    // Rename, describe, move to the top level.
    const edited = (await u.patch(`${base}/${up[0].id}`, { name: 'Rechnung.pdf', description: 'Juni', year: 2026, folderId: null }).expect(200)).body
    expect(edited).toMatchObject({ name: 'Rechnung.pdf', description: 'Juni', year: 2026, folderId: null })
  })

  it('moves and copies subtrees, and refuses moving a folder into itself', async () => {
    const u = await signIn('tree')
    const org = (await u.post('/orgs', { name: `Tree ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}/files`
    const ids = (await u.post(`${base}/folders/tree`, { paths: ['Proben/2026', 'Proben/2027', 'Karten'] }).expect(201)).body
    expect(Object.keys(ids).sort()).toEqual(['Karten', 'Proben/2026', 'Proben/2027'])
    await u.upload(`${base}/upload`, [{ name: 'a.csv', data: Buffer.from('x;y\n1;2') }], { folderId: ids['Proben/2026'] }).expect(201)
    const proben = (await u.get(base).expect(200)).body.folders.find((f: { name: string }) => f.name === 'Proben')

    await u.post(`${base}/move`, { folderIds: [proben.id], targetFolderId: ids['Proben/2026'] }).expect(400)
    await u.post(`${base}/move`, { folderIds: [proben.id], targetFolderId: ids.Karten }).expect(204)
    expect((await u.get(`${base}?folderId=${ids.Karten}`).expect(200)).body.folders.map((f: { name: string }) => f.name)).toEqual(['Proben'])

    await u.post(`${base}/copy`, { folderIds: [proben.id], targetFolderId: ids.Karten }).expect(204)
    const karten = (await u.get(`${base}?folderId=${ids.Karten}`).expect(200)).body.folders.map((f: { name: string }) => f.name).sort()
    expect(karten).toEqual(['Proben', 'Proben (2)'])
    expect((await u.get(`${base}?search=a.csv`).expect(200)).body.files).toHaveLength(2)

    const zip = await u.get(`${base}/folders/${proben.id}/zip`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    }).expect(200)
    expect((zip.body as Buffer).subarray(0, 2).toString()).toBe('PK')
  })

  it('trashes, restores and purges, and frees the storage', async () => {
    const u = await signIn('trash')
    const org = (await u.post('/orgs', { name: `Trash ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}/files`
    const folder = (await u.post(`${base}/folders`, { name: 'Alt' }).expect(201)).body
    const [inFolder] = (await u.upload(`${base}/upload`, [{ name: 'x.txt', data: Buffer.alloc(1000) }], { folderId: folder.id }).expect(201)).body
    const [loose] = (await u.upload(`${base}/upload`, [{ name: 'y.txt', data: Buffer.alloc(500) }]).expect(201)).body
    expect((await u.get(`${base}/storage`).expect(200)).body).toMatchObject({ usedBytes: 1500, trashBytes: 0, state: 'ok' })

    await u.post(`${base}/delete`, { folderIds: [folder.id], fileIds: [loose.id] }).expect(204)
    expect((await u.get(base).expect(200)).body).toEqual({ folders: [], files: [] })
    const trash = (await u.get(`${base}/trash`).expect(200)).body
    expect(trash.map((t: { kind: string; name: string }) => `${t.kind}:${t.name}`).sort()).toEqual(['file:y.txt', 'folder:Alt'])
    expect(trash.find((t: { kind: string }) => t.kind === 'folder').sizeBytes).toBe(1000)
    expect((await u.get(`${base}/storage`).expect(200)).body).toMatchObject({ usedBytes: 0, trashBytes: 1500 })

    await u.post(`${base}/trash/restore`, { folderIds: [folder.id] }).expect(204)
    expect((await u.get(`${base}?folderId=${folder.id}`).expect(200)).body.files.map((f: { id: string }) => f.id)).toEqual([inFolder.id])

    expect((await u.del(`${base}/trash`).expect(200)).body).toEqual({ deleted: 1 })
    expect(await owner.selectFrom('jobs').select('kind').where('organization_id', '=', org.id).where('kind', '=', 'files.purge_objects').execute()).toHaveLength(1)
    expect((await u.get(`${base}/trash`).expect(200)).body).toEqual([])
  })

  it('compresses a selection and extracts a zip into a sibling folder', async () => {
    const u = await signIn('zip')
    const org = (await u.post('/orgs', { name: `Zip ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}/files`
    const data = await zipOf({ 'Schlag 1/boden.csv': 'a;b', 'Schlag 1/sub/x.txt': 'x', 'readme.txt': 'r', '__MACOSX/._readme.txt': 'junk' })
    const [archive] = (await u.upload(`${base}/upload`, [{ name: 'Proben.zip', data }], { year: '2026' }).expect(201)).body
    const folder = (await u.post(`${base}/${archive.id}/extract`).expect(201)).body
    expect(folder.name).toBe('Proben')
    const inside = (await u.get(`${base}?folderId=${folder.id}`).expect(200)).body
    expect(inside.files.map((f: { name: string }) => f.name)).toEqual(['readme.txt'])
    expect(inside.files[0].year).toBe(2026)
    expect(inside.folders.map((f: { name: string }) => f.name)).toEqual(['Schlag 1'])

    const packed = (await u.post(`${base}/compress`, { fileIds: inside.files.map((f: { id: string }) => f.id), folderIds: [inside.folders[0].id], targetFolderId: folder.id, name: 'Paket' }).expect(201)).body
    expect(packed).toMatchObject({ name: 'Paket.zip', mimeType: 'application/zip', folderId: folder.id })
  })

  it('refuses uploads beyond the allowance and writes for viewers', async () => {
    const u = await signIn('quota')
    const org = (await u.post('/orgs', { name: `Quota ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}/files`
    await owner.updateTable('organizations').set({ storage_limit_bytes: 1000 }).where('id', '=', org.id).execute()
    await u.upload(`${base}/upload`, [{ name: 'ok.bin', data: Buffer.alloc(900) }]).expect(201)
    expect((await u.get(`${base}/storage`).expect(200)).body.state).toBe('warn')
    const refused = await u.upload(`${base}/upload`, [{ name: 'big.bin', data: Buffer.alloc(200) }]).expect(413)
    expect(refused.body.code).toBe('storage_full')

    const viewer = await signIn('viewer')
    await u.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    expect((await viewer.get(base).expect(200)).body.files).toHaveLength(1)
    await viewer.post(`${base}/folders`, { name: 'Nope' }).expect(403)
    await viewer.upload(`${base}/upload`, [{ name: 'v.txt', data: Buffer.from('v') }]).expect(403)
  })
})
