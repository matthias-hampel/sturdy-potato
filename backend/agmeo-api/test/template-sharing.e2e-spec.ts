/**
 * Cultivation templates across the user's organizations: read-only listing, copies with product
 * matching, unique names, delete protection, and a crop's operations saved as a template.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'

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

describe('template sharing', () => {
  it('lists, copies and saves templates', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `tpl-${run}@example.test`, displayName: 'Vorlagen' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const a = (await post('/orgs', { name: `Betrieb A ${run}` }).expect(201)).body
    const b = (await post('/orgs', { name: `Betrieb B ${run}` }).expect(201)).body
    const A = `/orgs/${a.id}`
    const B = `/orgs/${b.id}`
    const crops = (await get(`${A}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheat = crops.find((c) => c.code === 'winter_wheat')!.id
    const kasB = (await post(`${B}/products`, { category: 'fertilizer', name: 'KAS 27', baseUnit: 'kg', nPct: 27 }).expect(201)).body
    const tplB = (await post(`${B}/templates`, {
      cropId: wheat,
      name: 'Weizen B',
      steps: [
        { type: 'sowing', title: 'Aussaat', anchor: 'sowing', offsetDays: 0 },
        { type: 'fertilization', title: '1. N-Gabe', anchor: 'sowing', offsetDays: 150, inputs: [{ productId: kasB.id, ratePerHa: 200 }] },
      ],
    }).expect(201)).body

    const shared = (await get(`${A}/templates/shared`).expect(200)).body
    expect(shared).toEqual([expect.objectContaining({ organization: { id: b.id, name: `Betrieb B ${run}` }, templates: [expect.objectContaining({ id: tplB.id, name: 'Weizen B' })] })])

    // Without a product of the same name here, the line is left out.
    let copy = (await post(`${A}/templates/${tplB.id}/copy`, { name: 'Weizen von B', sourceOrgId: b.id }).expect(201)).body
    expect(copy.droppedInputs).toBe(1)
    expect(copy.template.steps.map((s: { inputs: unknown[] }) => s.inputs.length)).toEqual([0, 0])
    const kasA = (await post(`${A}/products`, { category: 'fertilizer', name: 'KAS 27', baseUnit: 'kg', nPct: 27 }).expect(201)).body
    copy = (await post(`${A}/templates/${tplB.id}/copy`, { name: 'Weizen von B 2', sourceOrgId: b.id }).expect(201)).body
    expect(copy).toMatchObject({ droppedInputs: 0 })
    expect(copy.template.steps[1].inputs).toEqual([expect.objectContaining({ productId: kasA.id, ratePerHa: 200 })])
    expect((await post(`${A}/templates/${tplB.id}/copy`, { name: 'weizen von b', sourceOrgId: b.id }).expect(409)).body.code).toBe('template_exists')
    await post(`${A}/templates`, { cropId: wheat, name: 'Weizen von B' }).expect(409)
    await post(`${A}/templates/${tplB.id}/copy`, { name: 'Fremd' }).expect(404)

    // A used template cannot be deleted; a crop's operations become a new template.
    const farm = (await post(`${A}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${A}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await post(`${A}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body[0]
    const [cycle] = (await post(`${A}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheat, sowingDate: '2026-10-01' }).expect(201)).body
    await post(`${A}/crop-cycles/${cycle.id}/apply-template`, { templateId: copy.template.id }).expect(201)
    expect((await http().delete(`/v1${A}/templates/${copy.template.id}`).set(auth).expect(409)).body.code).toBe('template_in_use')
    const saved = (await post(`${A}/crop-cycles/${cycle.id}/save-as-template`, { name: 'Aus Kamp' }).expect(201)).body
    expect(saved.steps.map((s: { type: string; anchor: string; offsetDays: number }) => [s.type, s.anchor, s.offsetDays])).toEqual([['sowing', 'sowing', 0], ['fertilization', 'sowing', 150]])
    expect(saved.steps[1].inputs[0]).toMatchObject({ productId: kasA.id, ratePerHa: 200 })

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
    await owner.destroy()
  })
})
