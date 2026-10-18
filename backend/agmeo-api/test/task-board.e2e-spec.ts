/**
 * Task board: operations by status, board metadata, status moves, comments, task sync.
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

async function signIn(name: string) {
  const email = `${name}-${run}-${Math.random()}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    email,
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
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

describe('task board', () => {
  it('moves operations across the board and keeps board metadata', async () => {
    const u = await signIn('board')
    const org = (await u.post('/orgs', { name: `Board ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Acker', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    const worker = (await u.post(`${base}/employees`, { name: 'Lena', hourlyRate: 20 }).expect(201)).body
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'tillage', title: 'Grubbern', plannedOn: '2027-03-01', fields: [{ fieldId: field.id }] }).expect(201)).body

    let board = (await u.get(`${base}/board?from=2026-01-01&to=2027-12-31`).expect(200)).body
    expect(board.planned.map((c: { id: string }) => c.id)).toEqual([op.id])
    expect(board.planned[0]).toMatchObject({ priority: 'normal', fields: [{ id: field.id, name: 'Acker' }], commentCount: 0 })

    const meta = (await u.patch(`${base}/board/${op.id}`, { priority: 'urgent', dueOn: '2027-03-05', responsibleEmployeeId: worker.id }).expect(200)).body
    expect(meta).toMatchObject({ priority: 'urgent', dueOn: '2027-03-05', assignee: { id: worker.id, name: 'Lena' }, version: op.version })

    const started = (await u.post(`${base}/board/${op.id}/status`, { status: 'in_progress', version: op.version }).expect(200)).body
    expect(started.status).toBe('in_progress')
    await u.post(`${base}/board/${op.id}/status`, { status: 'planned', version: op.version }).expect(409)
    board = (await u.get(`${base}/board?from=2026-01-01&to=2027-12-31&assigneeEmployeeId=${worker.id}`).expect(200)).body
    expect(board.in_progress.map((c: { id: string }) => c.id)).toEqual([op.id])
    expect((await u.get(`${base}/board?from=2026-01-01&to=2027-12-31&unassigned=true`).expect(200)).body.in_progress).toEqual([])

    // Completing is the existing completion; the card moves to done.
    await u.post(`${base}/operations/${op.id}/complete`, { version: started.version }).expect(200)
    board = (await u.get(`${base}/board?from=2026-01-01&to=2027-12-31`).expect(200)).body
    expect(board.completed.map((c: { id: string }) => c.id)).toEqual([op.id])
    await u.post(`${base}/board/${op.id}/status`, { status: 'planned', version: started.version + 1 }).expect(400)

    const bulk = (await u.post(`${base}/board/meta`, { operationIds: [op.id], priority: 'low' }).expect(200)).body
    expect(bulk[0].priority).toBe('low')
  })

  it('takes comments that authors edit and managers may delete', async () => {
    const owner = await signIn('owner')
    const org = (await owner.post('/orgs', { name: `Comments ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await owner.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const task = (await owner.post(`${base}/tasks`, { farmId: farm.id, title: 'Zaun reparieren' }).expect(201)).body
    const worker = await signIn('worker')
    await owner.post(`${base}/members`, { email: worker.email, displayName: 'Worker', role: 'worker' }).expect(201)

    const clientId = '01900000-0000-7000-8000-000000000001'.replace('0001', Math.floor(Math.random() * 9000 + 1000).toString())
    const c1 = (await worker.post(`${base}/comments`, { entityType: 'task', entityId: task.id, id: clientId, body: 'Pfosten fehlen' }).expect(201)).body
    expect(c1).toMatchObject({ id: clientId, authorName: 'worker', mine: true })
    // Retrying the same post does not duplicate it.
    await worker.post(`${base}/comments`, { entityType: 'task', entityId: task.id, id: clientId, body: 'Pfosten fehlen' }).expect(201)
    const list = (await owner.get(`${base}/comments?entityType=task&entityId=${task.id}`).expect(200)).body
    expect(list).toHaveLength(1)
    expect(list[0].mine).toBe(false)
    expect((await owner.get(`${base}/tasks`).expect(200)).body[0].commentCount).toBe(1)

    await owner.patch(`${base}/comments/${c1.id}`, { body: 'geändert' }).expect(403)
    expect((await worker.patch(`${base}/comments/${c1.id}`, { body: 'Pfosten und Draht fehlen' }).expect(200)).body.editedAt).not.toBeNull()
    await owner.del(`${base}/comments/${c1.id}`).expect(204)
    expect((await owner.get(`${base}/comments?entityType=task&entityId=${task.id}`).expect(200)).body).toEqual([])
  })

  it('syncs task changes with tombstones for deleted tasks', async () => {
    const u = await signIn('sync')
    const org = (await u.post('/orgs', { name: `Sync ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await u.post(`${base}/tasks`, { farmId: farm.id, title: 'A' }).expect(201)).body
    const first = (await u.get(`${base}/tasks/sync`).expect(200)).body
    expect(first.tasks.map((t: { id: string }) => t.id)).toEqual([a.id])
    expect(first.deleted).toEqual([])

    const b = (await u.post(`${base}/tasks`, { farmId: farm.id, title: 'B' }).expect(201)).body
    await u.del(`${base}/tasks/${a.id}`).expect(204)
    const next = (await u.get(`${base}/tasks/sync?since=${encodeURIComponent(first.serverTime)}`).expect(200)).body
    expect(next.tasks.map((t: { id: string }) => t.id)).toEqual([b.id])
    expect(next.deleted).toEqual([a.id])
    expect((await u.get(`${base}/tasks`).expect(200)).body.map((t: { id: string }) => t.id)).toEqual([b.id])
  })
})
