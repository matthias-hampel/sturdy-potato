/**
 * Application maps: base zonings (uniform, soil copy, uploaded files, brush edits, default),
 * satellite jobs, maps on any base with a target stand, bulk maps, the organization list and
 * single and batch exports.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { openZip } from '../src/modules/yield/lib/zip.js'

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

type Zone = { zoneNo: number; areaHa: number; relativeProductivity: number | null }
type Zoning = { id: string; source: string; name: string | null; zoneCount: number; isDefault: boolean; mapCount: number; zones: Zone[] }

describe('application maps', () => {
  it('builds bases, maps and bulk maps and exports them singly and in batches', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `appmaps-${run}@example.test`, displayName: 'Karte' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const patch = (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body)
    const del = (url: string) => http().delete(`/v1${url}`).set(auth)

    const org = (await post('/orgs', { name: `Applikation ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    // ~270 × 220 m ≈ 6 ha, and a second field of ~2 ha.
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const other = (await post(`${base}/fields`, { farmId: farm.id, name: 'Acker', geometry: rect(9.97, 52.31, 9.972, 52.311) }).expect(201)).body
    const bases = `${base}/fields/${field.id}/vra-bases`

    let list = (await get(bases).expect(200)).body
    expect(list).toMatchObject({ fieldId: field.id, fieldName: 'Breite', zonings: [], soilZonation: null, jobs: [] })
    const fieldHa = list.fieldAreaHa as number

    // Uniform: one zone over the field, made once.
    const uniform = (await post(`${bases}/uniform`, { name: 'Einheitlich' }).expect(201)).body as Zoning
    expect(uniform).toMatchObject({ source: 'uniform', zoneCount: 1, name: 'Einheitlich' })
    expect(uniform.zones[0].areaHa).toBeCloseTo(fieldHa, 1)
    expect((await post(`${bases}/uniform`, {}).expect(201)).body.id).toBe(uniform.id)

    // Soil: copies the active soil zonation, relative yield spread over the zones.
    await post(`${bases}/soil`, {}).expect(400)
    await post(`${base}/fields/${field.id}/soil/plan`, { mode: 'voronoi', points: [[9.961, 52.311], [9.963, 52.311]] }).expect(201)
    const soil = (await post(`${bases}/soil`, {}).expect(201)).body as Zoning
    expect(soil).toMatchObject({ source: 'soil', zoneCount: 2 })
    expect(soil.zones.map((z) => z.relativeProductivity)).toEqual([expect.any(Number), expect.any(Number)])
    list = (await get(bases).expect(200)).body
    expect(list.soilZonation).toMatchObject({ zoneCount: 2, copiedZoningId: soil.id })

    // Upload: a GeoJSON with a rate column becomes one zone per rate, relative by area-weighted mean.
    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: rect(9.959, 52.309, 9.962, 52.313), properties: { RATE: 160 } },
        { type: 'Feature', geometry: rect(9.962, 52.309, 9.965, 52.313), properties: { RATE: 120 } },
      ],
    }
    const upload = (await http().post(`/v1${bases}/upload`).set(auth).attach('file', Buffer.from(JSON.stringify(geojson)), 'Streukarte.geojson').expect(201)).body
    expect(upload).toMatchObject({ targetKey: 'rate', dropped: 0, zoning: { source: 'upload', zoneCount: 2, name: 'Streukarte' } })
    expect(upload.meanTarget).toBeGreaterThan(120)
    expect(upload.meanTarget).toBeLessThan(160)
    const [low, high] = upload.zoning.zones as Zone[]
    expect(low.relativeProductivity!).toBeLessThan(100)
    expect(high.relativeProductivity!).toBeGreaterThan(100)
    await http().post(`/v1${bases}/upload`).set(auth).attach('file', Buffer.from('{"type":"Feature"}'), 'x.geojson').expect(400)
    const outside = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: rect(10, 53, 10.001, 53.001), properties: { RATE: 1 } }] }
    await http().post(`/v1${bases}/upload`).set(auth).attach('file', Buffer.from(JSON.stringify(outside)), 'x.geojson').expect(400)

    // Brush edits: zones clipped to the field and to each other, relative yields kept.
    const manual = (
      await post(`${bases}/manual`, {
        name: 'Handarbeit',
        baseZoningId: soil.id,
        zones: [
          { geometry: rect(9.959, 52.309, 9.9625, 52.313), relativeProductivity: 85 },
          { geometry: rect(9.961, 52.309, 9.965, 52.313), relativeProductivity: 115 },
        ],
      }).expect(201)
    ).body as Zoning
    expect(manual).toMatchObject({ source: 'manual', zoneCount: 2, name: 'Handarbeit' })
    expect(manual.zones.map((z) => z.relativeProductivity)).toEqual([85, 115])
    expect(manual.zones.reduce((s, z) => s + z.areaHa, 0)).toBeCloseTo(fieldHa, 1)

    // Default ("Favorit"): one per field.
    await patch(`${bases}/${manual.id}`, { isDefault: true }).expect(200)
    await patch(`${bases}/${upload.zoning.id}`, { isDefault: true, name: 'Externe Karte' }).expect(200)
    list = (await get(bases).expect(200)).body
    expect(list.zonings.filter((z: Zoning) => z.isDefault).map((z: Zoning) => z.id)).toEqual([upload.zoning.id])
    expect(list.zonings[0]).toMatchObject({ id: upload.zoning.id, name: 'Externe Karte' })
    await patch(`${bases}/${manual.id}`, { isDefault: true }).expect(200)

    // Satellite: needs imagery of every scene; the worker computes queued jobs.
    const noImagery = await post(`${bases}/satellite`, { indexType: 'ndvi', sceneDates: ['2020-01-01'], zoneCount: 3 }).expect(400)
    expect(noImagery.body.code).toBe('no_imagery')
    await post(`${bases}/satellite`, { indexType: 'ndvi', sceneDates: [], zoneCount: 3 }).expect(400)

    // A sowing map on the uploaded zones with a target stand: export turns plants into seeds.
    const map = (
      await post(`${base}/fields/${field.id}/vra-maps`, {
        zoningId: upload.zoning.id,
        type: 'sowing',
        title: 'Aussaat Breite',
        inputs: [
          { inputType: 'sowing', cropId: null, name: 'Absint', unit: 'plants/ha', standardRate: 3_000_000, germinationPct: 94, strategy: 'manual', rates: { '1': 2_800_000, '2': 3_200_000 } },
        ],
      }).expect(400)
    ).body
    expect(map.code).toBeDefined()
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string }[]
    const sowing = (
      await post(`${base}/fields/${field.id}/vra-maps`, {
        zoningId: upload.zoning.id,
        type: 'sowing',
        title: 'Aussaat Breite',
        inputs: [
          { inputType: 'sowing', cropId: crops[0].id, name: 'Absint', unit: 'plants/ha', standardRate: 3_000_000, germinationPct: 94, strategy: 'manual', rates: { '1': 2_800_000, '2': 3_200_000 } },
        ],
      }).expect(201)
    ).body
    expect(sowing).toMatchObject({ zoningSource: 'upload', zoningName: 'Externe Karte', inputs: [{ unit: 'plants/ha', germinationPct: 94, strategy: 'manual' }] })
    const fc = JSON.parse(
      ((await get(`${base}/fields/${field.id}/vra-maps/${sowing.id}/export?format=geojson`).buffer(true).parse(binary).expect(200)).body as Buffer).toString('utf8'),
    )
    expect(fc.features.map((f: { properties: { RATE: number; UNIT: string } }) => [f.properties.RATE, f.properties.UNIT])).toEqual([
      [Math.round(280_000_000 / 94), 'seeds/ha'],
      [Math.round(320_000_000 / 94), 'seeds/ha'],
    ])

    // A fertilizing map exported as Shapefile, uploaded again as a base: the round trip keeps the zones.
    const fert = (
      await post(`${base}/fields/${field.id}/vra-maps`, {
        zoningId: manual.id,
        type: 'fertilizing',
        title: 'N1',
        inputs: [{ inputType: 'fertilizing', name: 'KAS', unit: 'kg/ha', standardRate: 150, strategy: 'proportional', rates: { '1': 130, '2': 170 } }],
      }).expect(201)
    ).body
    const shpZip = (await get(`${base}/fields/${field.id}/vra-maps/${fert.id}/export?format=shp`).buffer(true).parse(binary).expect(200)).body as Buffer
    const shpEntries = await openZip(shpZip)
    expect(shpEntries.names.some((n) => n.endsWith('.cpg'))).toBe(true)
    shpEntries.close()
    const roundTrip = (await http().post(`/v1${bases}/upload`).set(auth).field('name', 'N1 zurück.zip').attach('file', shpZip, 'upload.bin').expect(201)).body
    expect(roundTrip).toMatchObject({ targetKey: 'rate', unit: 'kg/ha', zoning: { zoneCount: 2, name: 'N1 zurück' } })
    expect(roundTrip.zoning.zones.reduce((s: number, z: Zone) => s + z.areaHa, 0)).toBeCloseTo(fieldHa, 1)

    // Bulk: the default zoning where there is one, else uniform; rates by the strategy.
    const bulk = (
      await post(`${base}/vra-maps/bulk`, {
        type: 'fertilizing',
        title: '{field} · N2',
        base: 'default',
        fallback: 'uniform',
        strategy: 'inverse',
        input: { name: 'KAS', unit: 'kg/ha', standardRate: 100 },
        fields: [{ fieldId: field.id }, { fieldId: other.id, standardRate: 80 }],
      }).expect(201)
    ).body
    expect(bulk.failed).toEqual([])
    const byField = Object.fromEntries(bulk.created.map((m: { fieldId: string }) => [m.fieldId, m]))
    expect(byField[field.id]).toMatchObject({ title: 'Breite · N2', zoningId: manual.id, batchId: bulk.batchId, fieldName: 'Breite' })
    // 85 % / 115 % around their area-weighted mean, inverted.
    const rates = byField[field.id].inputs[0].rates as Record<string, number>
    expect(rates['1']).toBeGreaterThan(100)
    expect(rates['2']).toBeLessThan(100)
    expect(byField[other.id]).toMatchObject({ title: 'Acker · N2', zoneCount: 1, zoningSource: 'uniform', inputs: [{ standardRate: 80, rates: { '1': 80 } }] })
    const skipped = (
      await post(`${base}/vra-maps/bulk`, { type: 'fertilizing', title: 'X', base: 'yield', fallback: 'skip', input: { name: 'KAS', unit: 'kg/ha', standardRate: 1 }, fields: [{ fieldId: other.id }] }).expect(201)
    ).body
    expect(skipped).toMatchObject({ created: [], failed: [{ fieldId: other.id, fieldName: 'Acker', code: 'no_zoning' }] })

    // Organization list, by batch and by field.
    const all = (await get(`${base}/vra-maps`).expect(200)).body as { id: string; fieldName: string }[]
    expect(all).toHaveLength(4)
    expect((await get(`${base}/vra-maps?batchId=${bulk.batchId}`).expect(200)).body).toHaveLength(2)
    expect((await get(`${base}/vra-maps?fieldId=${other.id}`).expect(200)).body.map((m: { fieldName: string }) => m.fieldName)).toEqual(['Acker'])

    // Batch export: one TASKDATA with a task per map; Shapefiles in a folder per map.
    const ids = bulk.created.map((m: { id: string }) => m.id)
    const isoZip = (await http().post(`/v1${base}/vra-maps/export`).set(auth).send({ mapIds: ids, format: 'isoxml' }).buffer(true).parse(binary).expect(200)).body as Buffer
    const iso = await openZip(isoZip)
    expect(iso.names).toEqual(['TASKDATA/TASKDATA.XML'])
    const xml = (await iso.read('TASKDATA/TASKDATA.XML')).toString('utf8')
    iso.close()
    expect(xml.match(/<TSK /g)).toHaveLength(2)
    expect(xml.match(/<PDT /g)).toHaveLength(1)
    const shpBatch = await openZip((await http().post(`/v1${base}/vra-maps/export`).set(auth).send({ mapIds: ids, format: 'shp' }).buffer(true).parse(binary).expect(200)).body as Buffer)
    expect(new Set(shpBatch.names.map((n) => n.split('/')[0])).size).toBe(2)
    expect(shpBatch.names.filter((n) => n.endsWith('.shp'))).toHaveLength(2)
    shpBatch.close()
    await http().post(`/v1${base}/vra-maps/export`).set(auth).send({ mapIds: [], format: 'shp' }).expect(400)

    // A zoning maps are made on stays; without maps it can be deleted. Productivity zonings are not ours to delete.
    expect((await del(`${bases}/${manual.id}`).expect(409)).body.code).toBe('zoning_in_use')
    await post(`${bases}/manual`, { replaceId: manual.id, zones: [{ geometry: rect(9.959, 52.309, 9.965, 52.313) }] }).expect(409)
    await del(`${bases}/${roundTrip.zoning.id}`).expect(204)
    list = (await get(bases).expect(200)).body
    expect(list.zonings.find((z: Zoning) => z.id === manual.id)).toMatchObject({ mapCount: 2, isDefault: true })
    expect(list.zonings.some((z: Zoning) => z.id === roundTrip.zoning.id)).toBe(false)
  })
})
