/**
 * The protection tab's register data: Auflagen of a product and its approved use, and the
 * approval findings of all plant-protection operations of a season.
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

describe('protection depth', () => {
  it('serves Auflagen and season findings', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `psmdepth-${run}@example.test`, displayName: 'PSM' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `PSM ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const season = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)
    const prosaro = (await post(`${base}/products`, { category: 'crop_protection', name: 'Prosaro', baseUnit: 'l', registrationNumber: '025662-00' }).expect(201)).body
    const unknown = (await post(`${base}/products`, { category: 'crop_protection', name: 'Unbekannt', baseUnit: 'l', registrationNumber: '999999-99' }).expect(201)).body
    const own = (await post(`${base}/products`, { category: 'crop_protection', name: 'Eigenes', baseUnit: 'l' }).expect(201)).body

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const nrs = [`9${Date.now()}1`, `9${Date.now()}2`]
    try {
      await owner
        .insertInto('psm_restrictions')
        .values([
          { auflagenr: nrs[0], awg_id: '025662-00/00-001', kennr: null, code: 'NW605', text: 'Abstand Gewässer', code_group: 'NW', water_buffer_m: 10, drift_reduction_pct: 50 },
          { auflagenr: nrs[1], awg_id: null, kennr: '025662-00', code: 'NT127', text: 'Uhrzeit dokumentieren', code_group: 'NT', water_buffer_m: null, drift_reduction_pct: null },
        ])
        .execute()
      await owner.insertInto('psm_restriction_reductions').values([{ auflagenr: nrs[0], reduction_pct: 50, distance_m: 10 }, { auflagenr: nrs[0], reduction_pct: 90, distance_m: 5 }]).execute()

      const info = (await get(`${base}/products/${prosaro.id}/psm-info?awgId=025662-00/00-001`).expect(200)).body
      expect(info).toMatchObject({ kennr: '025662-00', use: { awgId: '025662-00/00-001' } })
      expect(info.bvlName).toEqual(expect.any(String))
      const mine = info.restrictions.filter((r: { auflagenr: string }) => nrs.includes(r.auflagenr))
      expect(mine).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'NW605', awgId: '025662-00/00-001', waterBufferM: 10, tiers: [{ reductionPct: 50, distanceM: 10 }, { reductionPct: 90, distanceM: 5 }] }),
          expect.objectContaining({ code: 'NT127', awgId: null }),
        ]),
      )
      expect((await get(`${base}/products/${own.id}/psm-info`).expect(200)).body).toMatchObject({ kennr: null, use: null, restrictions: [] })

      const op = (await post(`${base}/operations`, { farmId: farm.id, type: 'crop_protection', title: 'Fungizid', plannedOn: '2026-05-10', fields: [{ fieldId: field.id }], inputs: [{ productId: unknown.id, ratePerHa: 1 }] }).expect(201)).body
      const findings = (await get(`${base}/protection/checks?seasonId=${season.id}`).expect(200)).body
      expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ operationId: op.id, code: 'unknown_registration', productId: unknown.id })]))
    } finally {
      await owner.deleteFrom('psm_restrictions').where('auflagenr', 'in', nrs).execute()
      await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
      await owner.destroy()
    }
  })
})
