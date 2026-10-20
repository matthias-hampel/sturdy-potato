/**
 * Members limited to some farms: the database policies narrow every query of a limited member,
 * not only the screens.
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

async function signIn(email: string) {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: email.split('@')[0] }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
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

describe('members limited to farms', () => {
  it('sees and changes only the fields and operations of their farms', async () => {
    const owner = await signIn(`mf-owner-${run}@example.test`)
    const org = (await owner.post('/orgs', { name: `MF ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const north = (await owner.post(`${base}/farms`, { name: 'Nord' }).expect(201)).body
    const south = (await owner.post(`${base}/farms`, { name: 'Süd' }).expect(201)).body
    const fieldN = (await owner.post(`${base}/fields`, { farmId: north.id, name: 'N1', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    const fieldS = (await owner.post(`${base}/fields`, { farmId: south.id, name: 'S1', geometry: rect(9.97, 52.31, 9.972, 52.312) }).expect(201)).body
    await owner.post(`${base}/operations`, { farmId: south.id, type: 'tillage', title: 'Grubber Süd', plannedOn: '2027-03-01', fields: [{ fieldId: fieldS.id }] }).expect(201)

    // Owners cannot be limited; unknown farms are refused.
    const workerEmail = `mf-worker-${run}@example.test`
    await owner.post(`${base}/members`, { email: workerEmail, role: 'owner', farmIds: [north.id] }).expect(400)
    await owner.post(`${base}/members`, { email: workerEmail, role: 'agronomist', farmIds: ['01a1505f-34c6-7a61-a193-d7aaeec256ce'] }).expect(400)
    const members = (await owner.post(`${base}/members`, { email: workerEmail, role: 'agronomist', farmIds: [north.id] }).expect(201)).body
    const invited = members.find((m: { email: string }) => m.email === workerEmail)
    expect(invited).toMatchObject({ displayName: `mf-worker-${run}`, farmIds: [north.id] })

    const worker = await signIn(workerEmail)
    const me = (await worker.get('/me').expect(200)).body
    expect(me.organizations.find((o: { id: string }) => o.id === org.id).farmIds).toEqual([north.id])

    expect((await worker.get(`${base}/farms`).expect(200)).body.map((f: { id: string }) => f.id)).toEqual([north.id])
    expect((await worker.get(`${base}/fields`).expect(200)).body.map((f: { id: string }) => f.id)).toEqual([fieldN.id])
    await worker.get(`${base}/fields/${fieldS.id}`).expect(404)
    expect((await worker.get(`${base}/operations`).expect(200)).body.items ?? []).toEqual([])
    // Writing into the other farm is refused by the database.
    await worker.post(`${base}/fields`, { farmId: south.id, name: 'S2', geometry: rect(9.98, 52.31, 9.982, 52.312) }).expect((r) => expect([403, 404]).toContain(r.status))
    await worker.post(`${base}/fields`, { farmId: north.id, name: 'N2', geometry: rect(9.99, 52.31, 9.992, 52.312) }).expect(201)

    // Lifting the limit shows everything again; an empty list shows nothing.
    await owner.patch(`${base}/members/${invited.userId}`, { farmIds: null }).expect(200)
    expect((await worker.get(`${base}/fields`).expect(200)).body).toHaveLength(3)
    await owner.patch(`${base}/members/${invited.userId}`, { farmIds: [] }).expect(200)
    expect((await worker.get(`${base}/farms`).expect(200)).body).toEqual([])
    expect((await worker.get(`${base}/fields`).expect(200)).body).toEqual([])
    // Becoming owner lifts the limit.
    const promoted = (await owner.patch(`${base}/members/${invited.userId}`, { role: 'owner' }).expect(200)).body
    expect(promoted.find((m: { userId: string }) => m.userId === invited.userId).farmIds).toBeNull()
  })

  it('lets a limited manager hand out only the farms they see', async () => {
    const owner = await signIn(`mf-owner2-${run}@example.test`)
    const org = (await owner.post('/orgs', { name: `MF2 ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const a = (await owner.post(`${base}/farms`, { name: 'A' }).expect(201)).body
    const b = (await owner.post(`${base}/farms`, { name: 'B' }).expect(201)).body
    const managerEmail = `mf-manager-${run}@example.test`
    await owner.post(`${base}/members`, { email: managerEmail, role: 'manager', farmIds: [a.id] }).expect(201)
    const manager = await signIn(managerEmail)
    await manager.post(`${base}/members`, { email: `mf-x-${run}@example.test`, role: 'worker' }).expect(403)
    await manager.post(`${base}/members`, { email: `mf-x-${run}@example.test`, role: 'worker', farmIds: [b.id] }).expect(400)
    await manager.post(`${base}/members`, { email: `mf-x-${run}@example.test`, role: 'worker', farmIds: [a.id] }).expect(201)
  })

  it('hides the crop records of other farms, such as harvests', async () => {
    const owner = await signIn(`mf-hv-owner-${run}@example.test`)
    const org = (await owner.post('/orgs', { name: `MF3 ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const north = (await owner.post(`${base}/farms`, { name: 'Nord' }).expect(201)).body
    const south = (await owner.post(`${base}/farms`, { name: 'Süd' }).expect(201)).body
    const fieldN = (await owner.post(`${base}/fields`, { farmId: north.id, name: 'N1', geometry: rect(9.96, 52.33, 9.962, 52.332) }).expect(201)).body
    const fieldS = (await owner.post(`${base}/fields`, { farmId: south.id, name: 'S1', geometry: rect(9.97, 52.33, 9.972, 52.332) }).expect(201)).body
    const season = (await owner.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const wheat = ((await owner.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]).find((c) => c.code === 'winter_wheat')!
    const [cycleN] = (await owner.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [fieldN.id], cropId: wheat.id }).expect(201)).body
    const [cycleS] = (await owner.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [fieldS.id], cropId: wheat.id }).expect(201)).body
    await owner.post(`${base}/harvests`, { cropCycleId: cycleN.id, harvestDate: '2026-07-20', quantityT: 25 }).expect(201)
    await owner.post(`${base}/harvests`, { cropCycleId: cycleS.id, harvestDate: '2026-07-21', quantityT: 30 }).expect(201)

    const email = `mf-hv-worker-${run}@example.test`
    await owner.post(`${base}/members`, { email, role: 'agronomist', farmIds: [north.id] }).expect(201)
    const worker = await signIn(email)
    const harvests = (await worker.get(`${base}/harvests?seasonId=${season.id}`).expect(200)).body as { cropCycleId: string }[]
    expect(harvests.map((h) => h.cropCycleId)).toEqual([cycleN.id])
    await worker.post(`${base}/harvests`, { cropCycleId: cycleS.id, harvestDate: '2026-07-22', quantityT: 1 }).expect((r) => expect([403, 404]).toContain(r.status))
  })
})
