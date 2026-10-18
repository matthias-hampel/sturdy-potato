/**
 * Cultivation planning end to end: templates, rotations with roll-over, and the crop calendar.
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
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `plan-${run}-${Math.random()}@example.test`, displayName: 'Plan' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
  }
  const org = (await u.post('/orgs', { name: `Plan ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
  const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
  const field2 = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(9.97, 52.31, 9.974, 52.312) }).expect(201)).body
  await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)
  const seasons = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body
  const s2026 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2026)
  const s2027 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2027)
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS 27', baseUnit: 'kg', unitCost: 0.4, nPct: 27 }).expect(201)).body
  return { u, base, farm, field, field2, s2026, s2027, crop, kas }
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

describe('cultivation planning', () => {
  it('applies a template as planned operations dated from the crop and replaces it', async () => {
    const { u, base, field, s2027, crop, kas } = await setup()
    const template = (await u.post(`${base}/templates`, {
      cropId: crop('winter_wheat'),
      name: 'Weizen nach Raps',
      steps: [
        { type: 'tillage', title: 'Grubbern', anchor: 'sowing', offsetDays: -7 },
        { type: 'sowing', title: 'Aussaat', anchor: 'sowing', offsetDays: 0 },
        { type: 'fertilization', title: '1. N-Gabe', anchor: 'season_start', offsetDays: 220, bbchStage: '25', inputs: [{ productId: kas.id, ratePerHa: 200 }] },
        { type: 'harvest', title: 'Drusch', anchor: 'harvest', offsetDays: 0 },
      ],
    }).expect(201)).body
    expect(template.steps).toHaveLength(4)
    expect(template.steps[2].inputs[0]).toMatchObject({ productName: 'KAS 27', ratePerHa: 200 })

    // Wrong crop.
    const barley = (await u.post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: crop('winter_barley'), role: 'catch_crop' }).expect(201)).body[0]
    const wrong = await u.post(`${base}/crop-cycles/${barley.id}/apply-template`, { templateId: template.id }).expect(400)
    expect(wrong.body.code).toBe('template_crop_mismatch')

    const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: crop('winter_wheat'), sowingDate: '2026-10-05' }).expect(201)).body[0]
    expect(wheat.role).toBe('main')
    const applied = (await u.post(`${base}/crop-cycles/${wheat.id}/apply-template`, { templateId: template.id }).expect(201)).body
    expect(applied).toMatchObject({ created: 4, removed: 0 })

    const ops = (await u.get(`${base}/operations?fieldId=${field.id}`).expect(200)).body as { title: string; plannedOn: string; status: string; inputs: { totalQuantity: number }[]; fields: { cropCycleId: string }[] }[]
    const byTitle = Object.fromEntries(ops.map((o) => [o.title, o]))
    expect(byTitle.Grubbern.plannedOn).toBe('2026-09-28')
    expect(byTitle.Aussaat.plannedOn).toBe('2026-10-05')
    expect(byTitle['1. N-Gabe'].plannedOn).toBe('2027-03-09')
    // Default harvest day of winter wheat in the season.
    expect(byTitle.Drusch.plannedOn).toBe('2027-07-25')
    expect(byTitle['1. N-Gabe'].fields[0].cropCycleId).toBe(wheat.id)
    expect(byTitle['1. N-Gabe'].inputs[0].totalQuantity).toBeGreaterThan(0)

    const again = await u.post(`${base}/crop-cycles/${wheat.id}/apply-template`, { templateId: template.id }).expect(409)
    expect(again.body.code).toBe('template_applied')
    const replaced = (await u.post(`${base}/crop-cycles/${wheat.id}/apply-template`, { templateId: template.id, replace: true }).expect(201)).body
    expect(replaced).toMatchObject({ created: 4, removed: 4 })

    const cycles = (await u.get(`${base}/crop-cycles?seasonId=${s2027.id}`).expect(200)).body
    expect(cycles.find((c: { id: string }) => c.id === wheat.id).templateName).toBe('Weizen nach Raps')

    const calendar = (await u.get(`${base}/crop-calendar?seasonId=${s2027.id}`).expect(200)).body
    const row = calendar.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)
    expect(row.sowing).toEqual({ date: '2026-10-05', source: 'planned' })
    expect(row.harvest).toEqual({ date: '2027-07-25', source: 'planned' })
    expect(row.operations).toHaveLength(4)
    const catchRow = calendar.rows.find((r: { cropCycleId: string }) => r.cropCycleId === barley.id)
    expect(catchRow.role).toBe('catch_crop')
    expect(catchRow.sowing.source).toBe('default')
  })

  it('rolls a season over from the rotation, with catch crops and templates, once', async () => {
    const { u, base, field, field2, s2026, s2027, crop } = await setup()
    const template = (await u.post(`${base}/templates`, { cropId: crop('winter_wheat'), name: 'WW Standard', steps: [{ type: 'sowing', title: 'Aussaat' }] }).expect(201)).body
    const rotation = (await u.post(`${base}/rotations`, {
      name: 'Raps – Weizen – Gerste',
      entries: [
        { cropId: crop('winter_rapeseed') },
        { cropId: crop('winter_wheat'), templateId: template.id, expectedYieldTHa: 8.5 },
        { cropId: crop('winter_barley'), catchCropId: crop('cc_mustard') },
        { cropId: crop('sugar_beet') },
      ],
    }).expect(201)).body
    expect(rotation.entries.map((e: { position: number }) => e.position)).toEqual([0, 1, 2, 3])

    await u.post(`${base}/rotations/${rotation.id}/fields`, { fieldIds: [field.id, field2.id], startYear: 2026 }).expect(201)
    // Last season: rape on Kamp, barley on Breite.
    await u.post(`${base}/crop-cycles`, { seasonId: s2026.id, fieldIds: [field.id], cropId: crop('winter_rapeseed') }).expect(201)
    await u.post(`${base}/crop-cycles`, { seasonId: s2026.id, fieldIds: [field2.id], cropId: crop('winter_barley') }).expect(201)

    const result = (await u.post(`${base}/rotations/roll-over`, { targetSeasonId: s2027.id }).expect(201)).body
    expect(result.fields.map((f: { outcome: string }) => f.outcome)).toEqual(['created', 'created'])
    const cycles = (await u.get(`${base}/crop-cycles?seasonId=${s2027.id}`).expect(200)).body as { fieldId: string; cropId: string; role: string; expectedYieldTHa: number | null; templateId: string | null }[]
    const kamp = cycles.filter((c) => c.fieldId === field.id)
    expect(kamp).toHaveLength(1)
    expect(kamp[0]).toMatchObject({ cropId: crop('winter_wheat'), role: 'main', expectedYieldTHa: 8.5, templateId: template.id })
    const breite = cycles.filter((c) => c.fieldId === field2.id)
    expect(breite.map((c) => [c.cropId, c.role]).sort()).toEqual([[crop('cc_mustard'), 'catch_crop'], [crop('sugar_beet'), 'main']].sort())
    expect(result.created).toBe(3)

    const repeat = (await u.post(`${base}/rotations/roll-over`, { targetSeasonId: s2027.id }).expect(201)).body
    expect(repeat).toMatchObject({ created: 0, skipped: 2 })

    const listed = (await u.get(`${base}/rotations`).expect(200)).body
    expect(listed[0].fields.map((f: { fieldName: string }) => f.fieldName)).toEqual(['Breite', 'Kamp'])
    await u.del(`${base}/rotation-assignments/${listed[0].fields[0].id}`).expect(204)
    expect((await u.get(`${base}/rotations`).expect(200)).body[0].fields).toHaveLength(1)
  })
})
