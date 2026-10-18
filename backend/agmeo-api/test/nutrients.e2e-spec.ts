/**
 * Agronomy end to end: soil samples, the DüV fertilizer need with its records, the season's
 * nutrient balance, closed-period findings and variable-rate suggestions.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'kysely'
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
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)

async function setup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `nut-${run}-${Math.random()}@example.test`, displayName: 'Nutrients' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Nut ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
  await owner.updateTable('farms').set({ federal_state: 'NI' }).where('id', '=', farm.id).execute()
  const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
  await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)
  const seasons = (await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)).body
  const s2026 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2026)
  const s2027 = seasons.find((s: { harvestYear: number }) => s.harvestYear === 2027)
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  return { u, base, farm, field, s2026, s2027, crop, orgId: org.id as string }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  await app?.close()
  await owner.destroy()
})

describe('agronomy', () => {
  it('calculates and records the fertilizer need from soil, crop history and organic N', async () => {
    const { u, base, farm, field, s2026, s2027, crop } = await setup()
    // Last season: oilseed rape with 30 m³ cattle slurry (0.4 % N → 120 kg N, 10 % credited).
    await u.post(`${base}/crop-cycles`, { seasonId: s2026.id, fieldIds: [field.id], cropId: crop('winter_rapeseed') }).expect(201)
    const slurry = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Rindergülle', baseUnit: 'm3', nPct: 0.4, nh4NPct: 0.2, fertilizerType: 'cattle_slurry' }).expect(201)).body
    const gülle = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'Gülle Raps', plannedOn: '2026-03-05', fields: [{ fieldId: field.id }], inputs: [{ productId: slurry.id, ratePerHa: 30 }] }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: slurry.id, kind: 'receipt', quantityDelta: 1000 }).expect(201)
    await u.post(`${base}/operations/${gülle.id}/complete`, { version: gülle.version, performedAt: '2026-03-05T09:00:00+01:00' }).expect(200)

    const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: crop('winter_wheat'), expectedYieldTHa: 9 }).expect(201)).body[0]
    await u.post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: crop('cc_mustard'), role: 'catch_crop' }).expect(201)
    await u.patch(`${base}/fields/${field.id}/site`, { soilTexture: 'sL', nitrateSensitiveZone: true }).expect(200)
    const basic = (await u.post(`${base}/soil-samples`, { fieldId: field.id, kind: 'basic', sampledOn: '2025-09-10', ph: 6.0, p2o5Mg100g: 6, k2oMg100g: 9, mgoMg100g: 6, humusPct: 2.4 }).expect(201)).body
    expect(basic.classes).toEqual({ ph: 'B', p: 'B', k: 'B', mg: 'C' })

    // Without an Nmin sample the need uses an estimate and says so.
    let need = (await u.get(`${base}/crop-cycles/${wheat.id}/fertilizer-need`).expect(200)).body
    expect(need.inputs.nmin).toEqual({ value: 35, source: 'default' })
    expect(need.warnings.map((w: { code: string }) => w.code)).toContain('nmin_estimated')
    expect(need.inputs.previousCrop.name).toBe('Winterraps')
    expect(need.inputs.organicNPreviousYear).toEqual({ value: 12, source: 'derived' })

    await u.post(`${base}/soil-samples`, { fieldId: field.id, kind: 'nmin', sampledOn: '2027-02-20', nmin0to30: 15, nmin30to60: 12, nmin60to90: 8 }).expect(201)
    need = (await u.get(`${base}/crop-cycles/${wheat.id}/fertilizer-need`).expect(200)).body
    expect(need.inputs.nmin).toMatchObject({ value: 35, source: 'sample', sampledOn: '2027-02-20' })
    // 230 + 10 (90 dt) − 35 Nmin − 10 rape − 0 frozen mustard − 12 organic = 183; red area −20 %.
    expect(need.n).toMatchObject({ yieldCorrection: 10, previousCropDeduction: 10, catchCropDeduction: 0, needBeforeZone: 183, zoneReduction: 36.6, need: 146.4 })
    expect(need.pk.find((p: { nutrient: string }) => p.nutrient === 'p2o5')).toMatchObject({ removal: 72, contentClass: 'B', need: 108 })
    expect(need.limeDtCaO).toBe(9)

    const preview = (await u.post(`${base}/crop-cycles/${wheat.id}/fertilizer-need/preview`, { expectedYieldTHa: 8, nitrateSensitiveZone: false }).expect(200)).body
    expect(preview.n.need).toBe(173)

    const saved = (await u.post(`${base}/crop-cycles/${wheat.id}/fertilizer-need`, { note: 'Planung Frühjahr' }).expect(201)).body
    expect(saved.lastRecord.n).toBe(146.4)
    const records = (await u.get(`${base}/crop-cycles/${wheat.id}/fertilizer-need/records`).expect(200)).body
    expect(records).toHaveLength(1)
    expect(records[0].result.n.need).toBe(146.4)
    expect(records[0].ruleset).toMatch(/^DE-DUEV/)

    const refs = (await u.get(`${base}/crop-cycles/${wheat.id}/nmin-references`).expect(200)).body
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r: { state: string }) => r.state === 'NI')).toBe(true)
    const withRef = (await u.post(`${base}/crop-cycles/${wheat.id}/fertilizer-need/preview`, { nminReferenceId: refs[0].id }).expect(200)).body
    expect(withRef.inputs.nmin).toMatchObject({ source: 'reference', value: refs[0].total })

    // Balance: 100 kg/ha KAS 27 completed, slurry planned in the closed period.
    const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', nPct: 27, fertilizerType: 'can' }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: kas.id, kind: 'receipt', quantityDelta: 5000 }).expect(201)
    const n1 = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: '1. N-Gabe', plannedOn: '2026-09-20', fields: [{ fieldId: field.id, cropCycleId: wheat.id }], inputs: [{ productId: kas.id, ratePerHa: 200 }] }).expect(201)).body
    await u.post(`${base}/operations/${n1.id}/complete`, { version: n1.version, performedAt: '2026-09-20T09:00:00+02:00' }).expect(200)
    await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'Gülle Herbst', plannedOn: '2026-10-20', fields: [{ fieldId: field.id, cropCycleId: wheat.id }], inputs: [{ productId: slurry.id, ratePerHa: 20 }] }).expect(201)
    const balance = (await u.get(`${base}/nutrients/season?seasonId=${s2027.id}`).expect(200)).body
    const row = balance.rows.find((r: { cropCycleId: string }) => r.cropCycleId === wheat.id)
    expect(row).toMatchObject({ nNeed: 146.4, nNeedRecorded: true, nitrateSensitiveZone: true })
    expect(row.applied).toMatchObject({ n: 54, availableN: 54 })
    // 20 m³ × 0.4 % = 80 kg N, available max(NH4 40, 60 % × 80 = 48).
    expect(row.planned).toMatchObject({ n: 80, availableN: 48 })
    expect(row.nRemaining).toBe(44.4)

    const report = (await u.get(`${base}/compliance/report?seasonId=${s2027.id}`).expect(200)).body
    const closed = report.issues.filter((i: { code: string }) => i.code === 'closed_period')
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ severity: 'warning', operationTitle: 'Gülle Herbst' })
  })

  it('suggests variable rates from zone productivity', async () => {
    const { u, base, field, s2027, crop, orgId } = await setup()
    const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: s2027.id, fieldIds: [field.id], cropId: crop('winter_wheat'), expectedYieldTHa: 8 }).expect(201)).body[0]
    // A finished productivity analysis with three zones (written by the geo worker in production).
    const { rows } = await sql<{ id: string }>`
      WITH g AS (SELECT id, geometry FROM field_current_geometry WHERE field_id = ${field.id}),
      a AS (INSERT INTO productivity_analyses (organization_id, field_id, geometry_version_id, status) SELECT ${orgId}, ${field.id}, g.id, 'finished' FROM g RETURNING id, geometry_version_id),
      z AS (INSERT INTO zonings (organization_id, field_id, geometry_version_id, analysis_id, source, zone_count) SELECT ${orgId}, ${field.id}, a.geometry_version_id, a.id, 'productivity', 3 FROM a RETURNING id)
      INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity)
      SELECT ${orgId}, z.id, v.no, g.geometry, v.area, v.rel FROM z, g, (VALUES (1, 4.0, 80.0), (2, 4.0, 100.0), (3, 2.0, 120.0)) AS v (no, area, rel)
      RETURNING zoning_id AS id`.execute(owner)
    const zoningId = rows[0].id

    const scale = (await u.post(`${base}/vra-suggestions`, { zoningId, mode: 'scale', standardRate: 200 }).expect(200)).body
    // Factors 0.8 / 1.0 / 1.2 have an area-weighted mean of 0.96 and are normalized to 1.
    expect(scale.rates).toEqual({ 1: 166.67, 2: 208.33, 3: 250 })
    expect(scale.meanRate).toBe(200)
    const inverse = (await u.post(`${base}/vra-suggestions`, { zoningId, mode: 'scale', standardRate: 200, inverse: true }).expect(200)).body
    expect(inverse.rates['1']).toBeGreaterThan(inverse.rates['3'])

    const seeds = (await u.post(`${base}/vra-suggestions`, { zoningId, mode: 'seeding', plantsPerM2: 282, germinationPct: 94, strategy: 'risk_mitigation' }).expect(200)).body
    expect(seeds.unit).toBe('seeds/ha')
    expect(seeds.meanRate).toBeCloseTo(3_000_000, -3)
    expect(seeds.rates['1']).toBeGreaterThan(seeds.rates['3'])

    const n = (await u.post(`${base}/vra-suggestions`, { zoningId, mode: 'nitrogen', cropCycleId: wheat.id, nPct: 27, passShare: 0.5 }).expect(200)).body
    expect(n.explanation).toMatch(/kg N\/ha/)
    expect(n.meanRate).toBeGreaterThan(0)
  })
})
