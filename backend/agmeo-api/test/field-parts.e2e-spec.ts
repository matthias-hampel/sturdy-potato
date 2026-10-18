/**
 * Part fields (Teilschläge) end to end against a real PostgreSQL (migrations applied).
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

async function setup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `parts-${run}-${Math.random()}@example.test`, displayName: 'Parts' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Parts ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
  // About 270 m × 220 m near Sehnde.
  const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Langer Acker', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
  const seasons = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body
  const season = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2027)
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  return { u, base, farm, field, season, crop }
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

describe('part fields', () => {
  it('clips drawn parts to the field, fills the remainder and keeps crops on re-split', async () => {
    const { u, base, field, season, crop } = await setup()
    const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crop('winter_wheat') }).expect(201)).body[0]

    // A flower strip drawn beyond the western edge; only the part inside the field counts.
    const strip = rect(9.959, 52.309, 9.9604, 52.313)
    const preview = (await u.post(`${base}/fields/${field.id}/parts/preview`, {
      seasonId: season.id,
      parts: [{ name: 'Blühstreifen', usage: 'flower_strip', geometry: strip }, { name: 'Hauptfläche' }],
    }).expect(201)).body
    expect(preview.parts).toHaveLength(2)
    const [p0, p1] = preview.parts
    expect(p0.areaHa).toBeGreaterThan(0.5)
    expect(p0.areaHa).toBeLessThan(0.7)
    expect(p0.areaHa + p1.areaHa).toBeCloseTo(field.areaHa, 2)
    expect(p1.isRemainder).toBe(true)

    // Parts must cover the field.
    const uncovered = await u.put(`${base}/fields/${field.id}/parts`, { seasonId: season.id, parts: [{ name: 'Blühstreifen', usage: 'flower_strip', geometry: strip }] }).expect(400)
    expect(uncovered.body.code).toBe('field_not_covered')

    const parts = (await u.put(`${base}/fields/${field.id}/parts`, {
      seasonId: season.id,
      parts: [{ name: 'Blühstreifen', usage: 'flower_strip', geometry: strip }, { name: 'Hauptfläche' }],
    }).expect(200)).body
    const main = parts.find((p: { isRemainder: boolean }) => p.isRemainder)
    const flower = parts.find((p: { usage: string }) => p.usage === 'flower_strip')
    // The wheat planned on the whole field moved to the main part.
    expect(main.crops.map((c: { cropCycleId: string }) => c.cropCycleId)).toEqual([wheat.id])
    const cycle = (await u.get(`${base}/crop-cycles?fieldId=${field.id}`).expect(200)).body[0]
    expect(cycle.fieldPartId).toBe(main.id)
    expect(cycle.areaHa).toBeCloseTo(main.areaHa, 4)

    const listed = (await u.get(`${base}/fields/${field.id}?seasonId=${season.id}`).expect(200)).body
    expect(listed.areaHa).toBeCloseTo(field.areaHa, 4)
    const all = (await u.get(`${base}/fields?seasonId=${season.id}`).expect(200)).body
    expect(all[0].partCount).toBe(2)
    expect(all[0].croppedAreaHa).toBeCloseTo(main.areaHa, 4)

    // Crops go on parts of a divided field, not on the field.
    const onField = await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crop('winter_barley') }).expect(400)
    expect(onField.body.code).toBe('field_is_divided')
    await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldPartIds: [flower.id], cropId: crop('cover_crop') }).expect(201)

    // Re-split: widen the strip and lease out a corner; existing parts keep their ids and crops.
    const corner = rect(9.963, 52.3115, 9.965, 52.313)
    const resplit = (await u.put(`${base}/fields/${field.id}/parts`, {
      seasonId: season.id,
      parts: [
        { id: flower.id, name: 'Blühstreifen', usage: 'flower_strip', geometry: rect(9.959, 52.309, 9.9606, 52.313) },
        { name: 'Verpachtet', usage: 'leased_out', geometry: corner },
        { id: main.id, name: 'Hauptfläche' },
      ],
    }).expect(200)).body
    expect(resplit).toHaveLength(3)
    expect(resplit.find((p: { id: string }) => p.id === flower.id).areaHa).toBeGreaterThan(flower.areaHa)
    expect(resplit.reduce((s: number, p: { areaHa: number }) => s + p.areaHa, 0)).toBeCloseTo(field.areaHa, 2)
    const leased = resplit.find((p: { usage: string }) => p.usage === 'leased_out')
    const onLeased = await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldPartIds: [leased.id], cropId: crop('winter_wheat') }).expect(400)
    expect(onLeased.body.code).toBe('field_part_leased_out')

    // A part with a crop cannot be dropped.
    const drop = await u.put(`${base}/fields/${field.id}/parts`, { seasonId: season.id, parts: [{ id: main.id, name: 'Hauptfläche' }, { id: leased.id, name: 'Verpachtet', usage: 'leased_out', geometry: corner }] }).expect(400)
    expect(drop.body.code).toBe('field_part_in_use')
  })

  it('records operations on the cropped parts and allocates costs per part', async () => {
    const { u, base, farm, field, season, crop } = await setup()
    const parts = (await u.put(`${base}/fields/${field.id}/parts`, {
      seasonId: season.id,
      parts: [{ name: 'Brache', usage: 'fallow', geometry: rect(9.959, 52.309, 9.961, 52.313) }, { name: 'Ost', geometry: null }],
    }).expect(200)).body
    const fallow = parts.find((p: { usage: string }) => p.usage === 'fallow')
    const east = parts.find((p: { isRemainder: boolean }) => p.isRemainder)
    const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldPartIds: [east.id], cropId: crop('winter_wheat') }).expect(201)).body[0]

    // Without a part, the operation covers the cropped part only.
    const op = (await u.post(`${base}/operations`, {
      farmId: farm.id,
      type: 'tillage',
      title: 'Grubbern',
      plannedOn: '2026-09-01',
      contractorName: 'LU',
      contractorCost: 100,
      fields: [{ fieldId: field.id }],
    }).expect(201)).body
    expect(op.fields).toHaveLength(1)
    expect(op.fields[0].fieldPartId).toBe(east.id)
    expect(op.fields[0].cropCycleId).toBe(wheat.id)
    expect(op.totalAreaHa).toBeCloseTo(east.areaHa, 4)

    // Both parts explicitly: two lines, costs split by area.
    const both = (await u.post(`${base}/operations`, {
      farmId: farm.id,
      type: 'other',
      title: 'Mulchen',
      plannedOn: '2026-09-02',
      contractorName: 'LU',
      contractorCost: 100,
      fields: [{ fieldId: field.id, fieldPartId: fallow.id }, { fieldId: field.id, fieldPartId: east.id }],
    }).expect(201)).body
    expect(both.fields).toHaveLength(2)
    await u.post(`${base}/operations/${both.id}/complete`, { version: both.version, performedAt: '2026-09-02T10:00:00Z' }).expect(200)
    const costs = (await u.get(`${base}/cost-entries?fieldId=${field.id}`).expect(200)).body as { amount: number }[]
    expect(costs).toHaveLength(2)
    expect(costs.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(100, 2)

    // A part with operations cannot be removed.
    const blocked = await u.put(`${base}/fields/${field.id}/parts`, { seasonId: season.id, parts: [] }).expect(400)
    expect(blocked.body.code).toBe('field_part_in_use')
  })

  it('names the part next to the field in the application records', async () => {
    const { u, base, farm, field, season, crop } = await setup()
    const parts = (await u.put(`${base}/fields/${field.id}/parts`, {
      seasonId: season.id,
      parts: [{ name: 'Blühstreifen', usage: 'flower_strip', geometry: rect(9.959, 52.309, 9.961, 52.313) }, { name: 'Ost', geometry: null }],
    }).expect(200)).body
    const east = parts.find((p: { isRemainder: boolean }) => p.isRemainder)
    await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldPartIds: [east.id], cropId: crop('winter_wheat') }).expect(201)
    const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', nPct: 27 }).expect(201)).body
    const op = (await u.post(`${base}/operations`, {
      farmId: farm.id,
      type: 'fertilization',
      title: 'KAS',
      plannedOn: '2026-09-10',
      contractorName: 'LU',
      fields: [{ fieldId: field.id }],
      inputs: [{ productId: kas.id, ratePerHa: 200 }],
    }).expect(201)).body
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: '2026-09-10T10:00:00Z', allowNegativeStock: true }).expect(200)

    const csv = (await u.get(`${base}/compliance/application-records.csv?seasonId=${season.id}`).expect(200)).text.replace(/^\uFEFF/, '')
    const [header, row] = csv.trim().split('\r\n').map((l) => l.split(','))
    expect(header.slice(4, 7)).toEqual(['field', 'field_part', 'field_identifier'])
    expect(row.slice(4, 6)).toEqual(['Langer Acker', 'Ost'])

    // Report rows name the part next to the field.
    const plain = (await u.post(`${base}/operations`, {
      farmId: farm.id,
      type: 'crop_protection',
      title: 'Herbizid',
      plannedOn: '2026-09-11',
      fields: [{ fieldId: field.id, fieldPartId: east.id }],
    }).expect(201)).body
    await u.post(`${base}/operations/${plain.id}/complete`, { version: plain.version, performedAt: '2026-09-11T10:00:00Z' }).expect(200)
    const report = (await u.get(`${base}/compliance/report?seasonId=${season.id}`).expect(200)).body as { issues: { operationId: string; fieldNames: string[] }[] }
    const issue = report.issues.find((i) => i.operationId === plain.id)!
    expect(issue.fieldNames).toEqual(['Langer Acker · Ost'])
  })

  it('removes a division and hands the main crop back to the whole field', async () => {
    const { u, base, field, season, crop } = await setup()
    await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crop('winter_wheat') }).expect(201)
    await u.put(`${base}/fields/${field.id}/parts`, {
      seasonId: season.id,
      parts: [{ name: 'Streifen', usage: 'buffer_strip', geometry: rect(9.959, 52.309, 9.9603, 52.313) }, { name: 'Rest' }],
    }).expect(200)
    expect((await u.put(`${base}/fields/${field.id}/parts`, { seasonId: season.id, parts: [] }).expect(200)).body).toEqual([])
    const cycle = (await u.get(`${base}/crop-cycles?fieldId=${field.id}`).expect(200)).body[0]
    expect(cycle.fieldPartId).toBeNull()
    expect(cycle.areaHa).toBeCloseTo(field.areaHa, 4)
  })
})
