/**
 * Field management: numbers, archiving, deleting, merging, restoring boundaries and groups.
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
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `fm-${run}-${Math.random()}@example.test`, displayName: 'FM' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
  }
  const org = (await u.post('/orgs', { name: `FM ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
  const field = (name: string, x0: number, x1: number) => u.post(`${base}/fields`, { farmId: farm.id, name, geometry: rect(x0, 52.31, x1, 52.312) }).expect(201).then((r) => r.body)
  return { u, base, farm, field }
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

describe('field management', () => {
  it('numbers, archives, restores and deletes fields', async () => {
    const { u, base, farm, field } = await setup()
    const a = await field('A', 9.96, 9.962)
    const b = await field('B', 9.963, 9.965)
    const c = await field('C', 9.966, 9.968)
    await u.post(`${base}/fields/renumber`, { fieldIds: [c.id, a.id, b.id], start: 10 }).expect(204)
    const numbered = (await u.get(`${base}/fields`).expect(200)).body as { id: string; parcelNumber: string }[]
    expect(numbered.find((f) => f.id === c.id)!.parcelNumber).toBe('10')
    expect(numbered.find((f) => f.id === b.id)!.parcelNumber).toBe('12')
    await u.patch(`${base}/fields/${a.id}`, { parcelNumber: '7a' }).expect(200)

    const archived = (await u.post(`${base}/fields/archive`, { fieldIds: [a.id], archivedFrom: '2026-09-01' }).expect(201)).body
    expect(archived.done).toEqual([a.id])
    expect((await u.get(`${base}/fields`).expect(200)).body.map((f: { id: string }) => f.id)).not.toContain(a.id)
    const withArchived = (await u.get(`${base}/fields?includeArchived=true`).expect(200)).body.find((f: { id: string }) => f.id === a.id)
    expect(withArchived).toMatchObject({ status: 'archived', archivedFrom: '2026-09-01', parcelNumber: '7a' })
    await u.post(`${base}/fields/restore`, { fieldIds: [a.id] }).expect(201)

    // A field with operations is kept; the others go.
    await u.post(`${base}/operations`, { farmId: farm.id, type: 'tillage', title: 'Grubber', plannedOn: '2027-03-01', fields: [{ fieldId: b.id }] }).expect(201)
    const deleted = (await u.post(`${base}/fields/delete`, { fieldIds: [b.id, c.id] }).expect(201)).body
    expect(deleted.done).toEqual([c.id])
    expect(deleted.failed).toMatchObject([{ fieldId: b.id, code: 'field_in_use' }])
  })

  it('merges two neighbouring fields and keeps the other as archived history', async () => {
    const { u, base, farm, field } = await setup()
    // 1 m gap between the fields (0.000015° ≈ 1 m): closed by the merge.
    const a = await field('West', 9.96, 9.962)
    const b = await field('Ost', 9.962015, 9.964)
    const groups = (await u.post(`/orgs/${base.split('/')[2]}/field-groups/members`, { fieldIds: [b.id], groupName: 'Pacht Müller' }).expect(201)).body
    expect(groups).toMatchObject([{ name: 'Pacht Müller', fieldCount: 1 }])

    const preview = (await u.post(`${base}/fields/merge/preview`, { survivorId: a.id, otherId: b.id }).expect(201)).body
    expect(preview.parts).toBe(1)
    expect(preview.areaHa).toBeGreaterThan(a.areaHa + b.areaHa - 0.01)
    expect(preview.blockers).toEqual([])

    // Planned work on the other field after the merge blocks it.
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'tillage', title: 'Pflug', plannedOn: '2099-03-01', fields: [{ fieldId: b.id }] }).expect(201)).body
    const blocked = await u.post(`${base}/fields/merge`, { survivorId: a.id, otherId: b.id, reason: 'Zusammengelegt' }).expect(409)
    expect(blocked.body.details.blockers[0]).toMatch(/^operations_after_merge/)
    await u.post(`${base}/operations/${op.id}/cancel`, { version: op.version }).expect(200)

    const merged = (await u.post(`${base}/fields/merge`, { survivorId: a.id, otherId: b.id, reason: 'Zusammengelegt' }).expect(201)).body
    expect(merged.areaHa).toBeCloseTo(preview.areaHa, 3)
    expect(merged.groups.map((g: { name: string }) => g.name)).toEqual(['Pacht Müller'])
    const other = (await u.get(`${base}/fields/${b.id}`).expect(200)).body
    expect(other).toMatchObject({ status: 'archived', mergedIntoId: a.id })
    const history = (await u.get(`${base}/fields/${a.id}/geometry-history`).expect(200)).body
    expect(history[0]).toMatchObject({ source: 'merge', reason: 'Zusammengelegt', validTo: null })

    // The original boundary can be made current again.
    const restored = (await u.post(`${base}/fields/${a.id}/geometry/restore`, { versionId: history[1].id, reason: 'Rückgängig' }).expect(201)).body
    expect(restored.areaHa).toBeCloseTo(a.areaHa, 3)
    const after = (await u.get(`${base}/fields/${a.id}/geometry-history`).expect(200)).body
    expect(after[0]).toMatchObject({ source: 'restore', reason: 'Rückgängig' })
  })

  it('filters fields by group and removes members', async () => {
    const { u, base, field } = await setup()
    const a = await field('A', 9.96, 9.962)
    const b = await field('B', 9.963, 9.965)
    const g = (await u.post(`${base}/field-groups`, { name: 'Bio', color: '#76b041' }).expect(201)).body
    await u.post(`${base}/field-groups/members`, { fieldIds: [a.id, b.id], groupId: g.id }).expect(201)
    expect((await u.get(`${base}/fields?groupId=${g.id}`).expect(200)).body).toHaveLength(2)
    await u.post(`${base}/field-groups/members/remove`, { fieldIds: [b.id], groupId: g.id }).expect(201)
    expect((await u.get(`${base}/fields?groupId=${g.id}`).expect(200)).body.map((f: { id: string }) => f.id)).toEqual([a.id])
    // Names are unique regardless of case.
    expect((await u.post(`${base}/field-groups/members`, { fieldIds: [b.id], groupName: 'bio' }).expect(201)).body).toHaveLength(1)
    await u.del(`${base}/field-groups/${g.id}`).expect(204)
    expect((await u.get(`${base}/fields/${a.id}`).expect(200)).body.groups).toEqual([])
  })

  it("carries last season's crops forward to fields without crops", async () => {
    const { u, base, field } = await setup()
    const a = await field('A', 9.96, 9.962)
    const b = await field('B', 9.963, 9.965)
    const s26 = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2026)
    const s27 = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2027)
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    await u.post(`${base}/crop-cycles`, { seasonId: s26.id, fieldIds: [a.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)
    const first = (await u.post(`${base}/crop-cycles/carry-forward`, { targetSeasonId: s27.id }).expect(201)).body
    expect(first.created).toBe(1)
    expect(first.fields.find((f: { fieldId: string }) => f.fieldId === a.id)).toMatchObject({ outcome: 'created', cropName: 'Winterweizen' })
    expect(first.fields.find((f: { fieldId: string }) => f.fieldId === b.id)).toMatchObject({ outcome: 'no_previous' })
    const again = (await u.post(`${base}/crop-cycles/carry-forward`, { targetSeasonId: s27.id, fieldIds: [a.id] }).expect(201)).body
    expect(again).toMatchObject({ created: 0, fields: [{ fieldId: a.id, outcome: 'already_planned' }] })
  })
})
