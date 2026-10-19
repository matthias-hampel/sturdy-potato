/**
 * Soil sampling planner: grid and Voronoi plans, the zone editor, probe numbers, history and
 * restore, and satellite zonations queued for the geospatial worker.
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

type Zone = { id: string; zoneNo: number; label: string; areaHa: number; probeNr: number | null; samplePoint: [number, number] | null }

describe('soil zonation', () => {
  it('plans grid and Voronoi zones, edits them, numbers the probes and keeps the history', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `soil-${run}@example.test`, displayName: 'Boden' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const patch = (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body)
    const del = (url: string) => http().delete(`/v1${url}`).set(auth)

    const org = (await post('/orgs', { name: `Boden ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    // ~270 × 220 m ≈ 6 ha
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const other = (await post(`${base}/fields`, { farmId: farm.id, name: 'Acker', geometry: rect(9.97, 52.31, 9.972, 52.311) }).expect(201)).body

    let overview = (await get(`${base}/soil/fields`).expect(200)).body
    expect(overview.find((f: { fieldId: string }) => f.fieldId === field.id)).toMatchObject({ zonation: null, probes: 0 })
    const fieldHa = overview.find((f: { fieldId: string }) => f.fieldId === field.id).areaHa as number

    // Grid preview: 1 ha cells covering the field, sliver cells merged into neighbours.
    const preview = (await post(`${base}/fields/${field.id}/soil/plan/preview`, { mode: 'grid', cellHa: 1 }).expect(200)).body
    expect(preview.tooMany).toBe(false)
    expect(preview.zones.length).toBeGreaterThanOrEqual(4)
    const sum = preview.zones.reduce((s: number, z: { areaHa: number }) => s + z.areaHa, 0)
    expect(sum).toBeCloseTo(fieldHa, 1)
    expect(preview.lines.length).toBeGreaterThan(2)
    await post(`${base}/fields/${field.id}/soil/plan/preview`, { mode: 'grid', cellHa: 0.1 }).expect(200)

    // Stored as the field's zonation.
    let detail = (await post(`${base}/fields/${field.id}/soil/plan`, { mode: 'grid', cellHa: 1 }).expect(201)).body
    expect(detail.zonation).toMatchObject({ method: 'grid', active: true, zoneCount: preview.zones.length })
    expect(detail.zonation.zones[0].samplePoint).toHaveLength(2)
    const gridId = detail.zonation.id as string

    // Voronoi: about area / cell size cells, generators relaxed inside the field.
    const voronoi = (await post(`${base}/fields/${field.id}/soil/plan/preview`, { mode: 'voronoi', cellHa: 2 }).expect(200)).body
    expect(voronoi.points.length).toBeGreaterThanOrEqual(2)
    expect(voronoi.zones.length).toBe(voronoi.points.length)
    // Hand-placed generators are taken as they are.
    const custom = (await post(`${base}/fields/${field.id}/soil/plan/preview`, { mode: 'voronoi', points: [[9.961, 52.311], [9.963, 52.311]] }).expect(200)).body
    expect(custom.zones).toHaveLength(2)
    expect(custom.zones[0].areaHa).toBeCloseTo(fieldHa / 2, 1)
    detail = (await post(`${base}/fields/${field.id}/soil/plan`, { mode: 'voronoi', points: [[9.961, 52.311], [9.963, 52.311]] }).expect(201)).body
    expect(detail.zonation.zones).toHaveLength(2)
    const [west, east] = detail.zonation.zones as Zone[]

    // Zone editor: the west zone grows to 9.9625, a third zone is drawn in the north-east corner.
    detail = (
      await put(`${base}/fields/${field.id}/soil/zones`, {
        zones: [
          { id: west.id, label: 'West', geometry: rect(9.959, 52.309, 9.9625, 52.313) },
          { label: 'Ecke', geometry: rect(9.963, 52.3115, 9.965, 52.313) },
          { id: east.id, label: 'Ost', geometry: rect(9.9625, 52.309, 9.965, 52.313) },
        ],
      }).expect(200)
    ).body
    const edited = detail.zonation.zones as Zone[]
    expect(edited.map((z) => z.label)).toEqual(['West', 'Ecke', 'Ost'])
    expect(edited[0].id).toBe(west.id)
    expect(edited[2].id).toBe(east.id)
    expect(edited[0].areaHa).toBeGreaterThan(west.areaHa)
    // Clipped to the field and to the zones before them: "Ost" loses the corner, nothing overlaps.
    expect(edited.reduce((s, z) => s + z.areaHa, 0)).toBeCloseTo(fieldHa, 1)
    await put(`${base}/fields/${field.id}/soil/zones`, { zones: [{ label: 'Draußen', geometry: rect(10, 53, 10.001, 53.001) }] }).expect(400)

    // Probe numbers continue across fields; a start number renumbers.
    await post(`${base}/fields/${other.id}/soil/plan`, { mode: 'grid', cellHa: 5 }).expect(201)
    let numbers = (await post(`${base}/soil/probe-numbers`, { fieldIds: [field.id, other.id] }).expect(200)).body
    expect(numbers.map((n: { probeNr: number }) => n.probeNr)).toEqual(numbers.map((_: unknown, i: number) => i + 1))
    numbers = (await post(`${base}/soil/probe-numbers`, { fieldIds: [field.id], start: 100 }).expect(200)).body
    expect(numbers[0].probeNr).toBe(100)
    const zone = (await patch(`${base}/soil/zones/${edited[0].id}`, { label: 'Westen', probeNr: 7, values: { ph: 6.1, p2o5: 14 }, sampledOn: '2026-03-01' }).expect(200)).body
    expect(zone).toMatchObject({ label: 'Westen', probeNr: 7, values: { ph: 6.1, p2o5: 14 }, dates: { ph: '2026-03-01' } })
    expect(zone.classes.p).toBeTruthy()

    overview = (await get(`${base}/soil/fields`).expect(200)).body
    expect(overview.find((f: { fieldId: string }) => f.fieldId === field.id)).toMatchObject({ probes: 3, sampledZones: 1, sampledOn: '2026-03-01' })

    // History and restore of the grid plan.
    const history = (await get(`${base}/fields/${field.id}/soil/zonations`).expect(200)).body
    expect(history.map((h: { method: string }) => h.method)).toEqual(['voronoi', 'grid'])
    detail = (await post(`${base}/fields/${field.id}/soil/zonations/${gridId}/restore`, {}).expect(200)).body
    expect(detail.zonation.id).toBe(gridId)

    // Satellite zonations are queued for the worker; a newer request replaces a queued one.
    const batch = (await post(`${base}/soil/zonations`, { fieldIds: [field.id, other.id], method: 'probe', source: 'ndvi', zoneCount: 3 }).expect(201)).body
    expect(batch.results.map((r: { status: string }) => r.status)).toEqual(['queued', 'queued'])
    const again = (await post(`${base}/soil/zonations`, { fieldIds: [field.id], method: 'kmeans', zoneCounts: { [field.id]: 4 } }).expect(201)).body
    const status = (await get(`${base}/soil/zonations?batchId=${batch.batchId}`).expect(200)).body
    expect(status).toHaveLength(1)
    expect((await get(`${base}/soil/zonations?batchId=${again.batchId}`).expect(200)).body[0]).toMatchObject({ method: 'kmeans', status: 'queued', params: { zoneCount: 4 } })
    detail = (await get(`${base}/fields/${field.id}/soil`).expect(200)).body
    expect(detail.zonation.id).toBe(gridId)
    expect(detail.pending[0]).toMatchObject({ status: 'queued' })
    await post(`${base}/soil/zonations`, { fieldIds: [field.id], method: 'magic' }).expect(400)

    // Retiring the active zonation keeps it in the history.
    await del(`${base}/fields/${field.id}/soil/zonation`).expect(204)
    detail = (await get(`${base}/fields/${field.id}/soil`).expect(200)).body
    expect(detail.zonation).toBeNull()
    expect((await get(`${base}/fields/${field.id}/soil/zonations`).expect(200)).body).toHaveLength(2)
  })
})
