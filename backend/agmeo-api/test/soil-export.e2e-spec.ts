/**
 * Soil exports: the lab's sample card, zonation and results PDFs, GeoJSON and the zone
 * shapefile, each archived in the "Soil exports" folder.
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

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

describe('soil exports', () => {
  it('builds sample cards, PDFs, GeoJSON and shapefiles and archives them', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `soilx-${run}@example.test`, displayName: 'Export' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `Bodenexport ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'Am Bach', identifier: '12', geometry: rect(9.96, 52.31, 9.963, 52.312) }).expect(201)).body
    const b = (await post(`${base}/fields`, { farmId: farm.id, name: 'Ohne Zonen', geometry: rect(9.97, 52.31, 9.971, 52.311) }).expect(201)).body
    const plan = (await post(`${base}/fields/${a.id}/soil/plan`, { mode: 'grid', cellHa: 2 }).expect(201)).body
    const zoneCount = plan.zonation.zones.length as number

    // Without any zonation there is nothing to export (except the zonation PDF's list of fields).
    await post(`${base}/soil/exports`, { fieldIds: [b.id], format: 'sampleCard' }).expect(400)

    // Sample card: probe numbers are stamped on the zones, the zip holds PROBEKARTE and CONTOUR.
    const card = (await post(`${base}/soil/exports`, { fieldIds: [a.id, b.id], format: 'sampleCard', customerNumber: '4711', startProbeNr: 101 }).expect(201)).body
    expect(card.probeNumbers).toBe(zoneCount)
    expect(card.skippedFieldIds).toEqual([b.id])
    expect(card.file).toMatchObject({ mimeType: 'application/zip' })
    expect(card.file.name).toMatch(/^4711_.*_Probenkarte_\d{4}-\d{2}-\d{2}\.zip$/)
    const zipBody = (await get(`${base}/files/${card.file.id}/content`).buffer(true).parse(binary).expect(200)).body as Buffer
    expect(zipBody.subarray(0, 2).toString()).toBe('PK')
    expect(zipBody.toString('latin1')).toContain('_PROBEKARTE.zip')
    expect(zipBody.toString('latin1')).toContain('_CONTOUR.zip')
    const detail = (await get(`${base}/fields/${a.id}/soil`).expect(200)).body
    expect(detail.zonation.zones.map((z: { probeNr: number }) => z.probeNr)).toEqual(Array.from({ length: zoneCount }, (_, i) => 101 + i))

    // The archive folder.
    const folders = (await get(`${base}/files/folders`).expect(200)).body as { id: string; systemKey: string | null }[]
    expect(folders.some((f) => f.systemKey === 'soilExports')).toBe(true)

    // PDFs.
    const pdf = (await post(`${base}/soil/exports`, { fieldIds: [a.id, b.id], format: 'zonationPdf', locale: 'de' }).expect(201)).body
    expect(pdf.file.mimeType).toBe('application/pdf')
    const pdfBody = (await get(`${base}/files/${pdf.file.id}/content`).buffer(true).parse(binary).expect(200)).body as Buffer
    expect(pdfBody.subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect(pdfBody.toString('latin1')).toContain('/Count 2')
    const results = (await post(`${base}/soil/exports`, { fieldIds: [a.id], format: 'resultsPdf', locale: 'en', params: ['ph', 'p2o5'] }).expect(201)).body
    expect(results.file.name).toMatch(/\.pdf$/)

    // GeoJSON with the zone values.
    await http().patch(`/v1${base}/soil/zones/${detail.zonation.zones[0].id}`).set(auth).send({ values: { ph: 6.4 } }).expect(200)
    const geo = (await post(`${base}/soil/exports`, { fieldIds: [a.id], format: 'geojson' }).expect(201)).body
    const fc = JSON.parse(((await get(`${base}/files/${geo.file.id}/content`).buffer(true).parse(binary).expect(200)).body as Buffer).toString('utf8'))
    expect(fc.features).toHaveLength(zoneCount)
    expect(fc.features[0].properties).toMatchObject({ fieldName: 'Am Bach', probeNr: 101, ph: 6.4 })

    // Zone shapefile.
    const shp = (await post(`${base}/soil/exports`, { fieldIds: [a.id], format: 'shapefile' }).expect(201)).body
    const shpBody = (await get(`${base}/files/${shp.file.id}/content`).buffer(true).parse(binary).expect(200)).body as Buffer
    expect(shpBody.toString('latin1')).toContain('_Bodenzonenkarten.dbf')
  })
})
