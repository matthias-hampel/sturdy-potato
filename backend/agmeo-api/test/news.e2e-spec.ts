/**
 * News feed: task summary from planned operations, plus generated weather, events and report reminders.
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
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

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

describe('news', () => {
  it('summarises overdue and upcoming operations', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `news-${run}@example.test`, displayName: 'News' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `News ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Feld A', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    await post(`${base}/operations`, { farmId: farm.id, type: 'tillage', title: 'Grubbern', plannedOn: day(-2), fields: [{ fieldId: field.id }] }).expect(201)
    await post(`${base}/operations`, { farmId: farm.id, type: 'sowing', title: 'Säen', plannedOn: day(3), fields: [{ fieldId: field.id }] }).expect(201)
    await post(`${base}/operations`, { farmId: farm.id, type: 'other', title: 'Weit weg', plannedOn: day(40), fields: [{ fieldId: field.id }] }).expect(201)

    const items = (await http().get(`/v1${base}/news`).set(auth).expect(200)).body as { id: string; category: string; headline: { key: string; params: Record<string, number> }; body: { key: string }[]; priority: number; validFrom: string }[]
    const tasks = items.find((i) => i.category === 'tasks')!
    expect(tasks.headline).toEqual({ key: 'tasks.headline', params: { overdue: 1, dueToday: 0, next7: 1 } })
    expect(tasks.priority).toBe(9)
    expect(tasks.body.filter((b) => b.key === 'tasks.line')).toHaveLength(2)
    expect(items.every((i) => i.headline.key && i.validFrom)).toBe(true)
  })
})
