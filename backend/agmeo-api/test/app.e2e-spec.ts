/**
 * End-to-end tests against a real PostgreSQL (docker compose up postgres; migrations applied).
 * Each run uses fresh users and organizations, so it can run against a seeded database.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'kysely'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { createKysely } from '../src/db/database.js'

const run = Math.random().toString(36).slice(2, 8)
const polygon = (x: number, y: number, d = 0.004) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + d, y], [x + d, y + d / 2], [x, y + d / 2], [x, y]]],
})

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

async function signIn(name: string) {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `${name}-${run}@example.test`, displayName: name }).expect(201)
  return { token: res.body.accessToken as string, email: `${name}-${run}@example.test` }
}

function as(token: string) {
  const auth = { authorization: `Bearer ${token}` }
  return {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
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

describe('tenant isolation', () => {
  it('hides other organizations and rejects their data', async () => {
    const alice = as((await signIn('alice')).token)
    const bob = as((await signIn('bob')).token)
    const org = (await alice.post('/orgs', { name: `Alice ${run}` }).expect(201)).body
    const farm = (await alice.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    await alice.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'A1', geometry: polygon(9.9, 52.3) }).expect(201)

    // Same response whether the organization exists or not.
    await bob.get(`/orgs/${org.id}/fields`).expect(404)
    await bob.get(`/orgs/00000000-0000-4000-8000-000000000000/fields`).expect(404)
    await bob.post(`/orgs/${org.id}/farms`, { name: 'Intruder' }).expect(404)
    const me = (await bob.get('/me').expect(200)).body
    expect(me.organizations.map((o: { id: string }) => o.id)).not.toContain(org.id)

    // Bob's own organization cannot reference Alice's farm either (RLS hides it).
    const bobOrg = (await bob.post('/orgs', { name: `Bob ${run}` }).expect(201)).body
    await bob.post(`/orgs/${bobOrg.id}/fields`, { farmId: farm.id, name: 'X', geometry: polygon(9.95, 52.3) }).expect(404)
  })

  it('enforces role permissions within an organization', async () => {
    const owner = await signIn('owner')
    const viewer = await signIn('viewer')
    const o = as(owner.token)
    const org = (await o.post('/orgs', { name: `Roles ${run}` }).expect(201)).body
    await o.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    const farm = (await o.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body

    const v = as(viewer.token)
    await v.get(`/orgs/${org.id}/farms`).expect(200)
    await v.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'No', geometry: polygon(9.9, 52.3) }).expect(403)
    await v.get(`/orgs/${org.id}/economics/summary`).expect(403)
  })
})

describe('field geometry', () => {
  it('rejects self-intersecting boundaries and reports overlaps', async () => {
    const u = as((await signIn('geo')).token)
    const org = (await u.post('/orgs', { name: `Geo ${run}` }).expect(201)).body
    const farm = (await u.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    const bowtie = { type: 'Polygon', coordinates: [[[9.9, 52.3], [9.91, 52.305], [9.91, 52.3], [9.9, 52.305], [9.9, 52.3]]] }
    const bad = await u.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'Bad', geometry: bowtie }).expect(400)
    expect(bad.body.code).toBe('invalid_geometry')

    const field = (await u.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'F', geometry: polygon(9.9, 52.3) }).expect(201)).body
    expect(field.areaHa).toBeGreaterThan(5)
    const check = (await u.post(`/orgs/${org.id}/fields/validate-geometry`, { geometry: polygon(9.902, 52.3) }).expect(201)).body
    expect(check.valid).toBe(true)
    expect(check.overlaps[0].fieldId).toBe(field.id)

    // A boundary change keeps the previous version.
    await u.put(`/orgs/${org.id}/fields/${field.id}/geometry`, { geometry: polygon(9.9, 52.3, 0.003) }).expect(200)
    const history = (await u.get(`/orgs/${org.id}/fields/${field.id}/geometry-history`).expect(200)).body
    expect(history).toHaveLength(2)
    expect(history[1].validTo).not.toBeNull()
    expect(history[0].status).toBe('current')
  })

  it('plans a boundary change that only takes effect on its date', async () => {
    const u = as((await signIn('geo')).token)
    const org = (await u.post('/orgs', { name: `Planned ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'F', geometry: polygon(9.9, 52.3) }).expect(201)).body
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString()

    const planned = (await u.put(`${base}/fields/${field.id}/geometry`, { geometry: polygon(9.9, 52.3, 0.003), validFrom: later }).expect(200)).body
    expect(planned.geometryVersionId).toBe(field.geometryVersionId)
    expect(planned.areaHa).toBe(field.areaHa)
    expect(planned.plannedGeometry.validFrom).toBe(later)
    let history = (await u.get(`${base}/fields/${field.id}/geometry-history`).expect(200)).body
    expect(history.map((v: { status: string }) => v.status)).toEqual(['planned', 'current'])
    expect(history[1].validTo).toBe(later)

    // A change effective now lands before the planned one.
    await u.put(`${base}/fields/${field.id}/geometry`, { geometry: polygon(9.9, 52.3, 0.004) }).expect(200)
    history = (await u.get(`${base}/fields/${field.id}/geometry-history`).expect(200)).body
    expect(history.map((v: { status: string }) => v.status)).toEqual(['planned', 'current', 'past'])
    expect(history[1].validTo).toBe(later)

    // Cancelling the planned change lets the current boundary continue.
    const after = (await u.del(`${base}/fields/${field.id}/geometry/${history[0].id}`).expect(200)).body
    expect(after.plannedGeometry).toBeNull()
    history = (await u.get(`${base}/fields/${field.id}/geometry-history`).expect(200)).body
    expect(history.map((v: { status: string }) => v.status)).toEqual(['current', 'past'])
    expect(history[0].validTo).toBeNull()
    await u.del(`${base}/fields/${field.id}/geometry/${history[0].id}`).expect(404)
  })
})

describe('operation lifecycle', () => {
  it('records stock and costs exactly once, and reverses them on correction', async () => {
    const u = as((await signIn('farmer')).token)
    const org = (await u.post('/orgs', { name: `Ops ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    await u.post(`${base}/seasons`, { harvestYear: 2027, startDate: '2026-08-01', endDate: '2027-07-31' }).expect(201)
    const f1 = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'F1', geometry: polygon(9.9, 52.3) }).expect(201)).body
    const f2 = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'F2', geometry: polygon(9.91, 52.3) }).expect(201)).body
    const product = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.5, nPct: 27 }).expect(201)).body
    await u.post(`${base}/stock/movements`, { productId: product.id, kind: 'receipt', quantityDelta: 3000, unitCost: 0.5 }).expect(201)

    const op = (
      await u
        .post(`${base}/operations`, {
          farmId: farm.id,
          type: 'fertilization',
          title: 'N1',
          plannedOn: '2026-10-01',
          fields: [{ fieldId: f1.id }, { fieldId: f2.id }],
          inputs: [{ productId: product.id, ratePerHa: 100 }],
        })
        .expect(201)
    ).body
    const area = f1.areaHa + f2.areaHa
    expect(op.inputs[0].totalQuantity).toBeCloseTo(100 * area, 2)

    // Planned operations have no side effects.
    let stock = (await u.get(`${base}/products`).expect(200)).body[0].stock
    expect(stock).toBe(3000)

    // A stale version is rejected.
    await u.put(`${base}/operations/${op.id}`, { ...editable(op), version: op.version + 5 }).expect(409)

    const performedAt = '2026-10-02T08:00:00.000Z'
    const done = (await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt }).expect(200)).body
    expect(done.status).toBe('completed')
    // Repeated completion (e.g. a retried request) is a no-op.
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt }).expect(200)

    stock = (await u.get(`${base}/products`).expect(200)).body[0].stock
    expect(stock).toBeCloseTo(3000 - 100 * area, 2)
    const costs = (await u.get(`${base}/cost-entries`).expect(200)).body
    const total = costs.reduce((s: number, c: { amount: number }) => s + c.amount, 0)
    expect(total).toBeCloseTo(100 * area * 0.5, 0)
    expect(new Set(costs.map((c: { fieldId: string }) => c.fieldId))).toEqual(new Set([f1.id, f2.id]))

    const reopened = (await u.post(`${base}/operations/${op.id}/reopen`, { version: done.version, reason: 'Wrong rate' }).expect(200)).body
    expect(reopened.status).toBe('in_progress')
    stock = (await u.get(`${base}/products`).expect(200)).body[0].stock
    expect(stock).toBeCloseTo(3000, 4)
    const net = (await u.get(`${base}/cost-entries`).expect(200)).body.reduce((s: number, c: { amount: number }) => s + c.amount, 0)
    expect(net).toBeCloseTo(0, 2)

    // Correct the rate and complete again: one new consumption, history kept.
    const edited = (await u.put(`${base}/operations/${op.id}`, { ...editable(reopened), inputs: [{ productId: product.id, ratePerHa: 80 }], version: reopened.version }).expect(200)).body
    await u.post(`${base}/operations/${op.id}/complete`, { version: edited.version, performedAt }).expect(200)
    stock = (await u.get(`${base}/products`).expect(200)).body[0].stock
    expect(stock).toBeCloseTo(3000 - 80 * area, 2)
    const movements = (await u.get(`${base}/stock/movements?operationId=${op.id}`).expect(200)).body
    expect(movements.map((m: { kind: string }) => m.kind).sort()).toEqual(['consumption', 'consumption', 'reversal'])
  })

  it('blocks completion when recorded stock is insufficient unless overridden', async () => {
    const u = as((await signIn('stock')).token)
    const org = (await u.post('/orgs', { name: `Stock ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'F', geometry: polygon(9.9, 52.3) }).expect(201)).body
    const product = (await u.post(`${base}/products`, { category: 'seed', name: 'Seed', baseUnit: 'kg' }).expect(201)).body
    const op = (
      await u
        .post(`${base}/operations`, { farmId: farm.id, type: 'sowing', title: 'Sow', fields: [{ fieldId: field.id }], inputs: [{ productId: product.id, ratePerHa: 150 }] })
        .expect(201)
    ).body
    const blocked = await u.post(`${base}/operations/${op.id}/complete`, { version: op.version }).expect(409)
    expect(blocked.body.code).toBe('insufficient_stock')
    expect(blocked.body.details[0].productId).toBe(product.id)
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, allowNegativeStock: true }).expect(200)
  })
})

describe('satellite monitoring', () => {
  it('reports imagery progress and queues productivity analyses for editors only', async () => {
    const owner = await signIn('pz-owner')
    const viewer = await signIn('pz-viewer')
    const o = as(owner.token)
    const org = (await o.post('/orgs', { name: `Zones ${run}` }).expect(201)).body
    await o.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    const farm = (await o.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await o.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'Z1', geometry: polygon(9.9, 52.3) }).expect(201)).body

    const status = (await o.get(`/orgs/${org.id}/monitoring/imagery/status?fieldId=${field.id}`).expect(200)).body
    expect(['none', 'queued', 'running', 'finished', 'failed']).toContain(status.state)
    expect(Array.isArray((await o.get(`/orgs/${org.id}/monitoring/imagery/dates?fieldId=${field.id}`).expect(200)).body)).toBe(true)
    await o.get(`/orgs/${org.id}/monitoring/imagery/2025-1-01/ndvi/1/1/1.png`).expect(400)
    await o.get(`/orgs/${org.id}/monitoring/imagery/2025-01-01/savi/1/1/1.png`).expect(400)

    const v = as(viewer.token)
    await v.post(`/orgs/${org.id}/fields/${field.id}/productivity`, {}).expect(403)
    const first = (await o.post(`/orgs/${org.id}/fields/${field.id}/productivity`, {}).expect(201)).body
    // Queued for the worker; asking again while it waits does not queue a second analysis.
    const second = (await o.post(`/orgs/${org.id}/fields/${field.id}/productivity`, { excludedSceneIds: [] }).expect(201)).body
    if (first.pending?.status === 'queued' && second.pending?.status === 'queued') expect(second.pending.id).toBe(first.pending.id)
    const state = (await v.get(`/orgs/${org.id}/fields/${field.id}/productivity`).expect(200)).body
    expect(state.pending ?? state.analysis).not.toBeNull()
    await o.post(`/orgs/${org.id}/fields/${field.id}/productivity`, { excludedSceneIds: ['nope'] }).expect(400)
  })
})

describe('variable-rate maps', () => {
  /** Zonings are written by the geospatial worker; the test writes one as the database owner. */
  async function seedZoning(fieldId: string) {
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    try {
      const { rows } = await sql<{ id: string }>`
        WITH g AS (SELECT * FROM field_current_geometry WHERE field_id = ${fieldId}::uuid),
        a AS (
          INSERT INTO productivity_analyses (organization_id, field_id, geometry_version_id, status, status_code)
          SELECT organization_id, field_id, id, 'finished', 'ok' FROM g RETURNING id
        ),
        z AS (
          INSERT INTO zonings (organization_id, field_id, geometry_version_id, analysis_id, source, zone_count)
          SELECT g.organization_id, g.field_id, g.id, a.id, 'productivity', 3 FROM g, a RETURNING id
        ),
        parts AS (
          SELECT n, ST_Multi(ST_Intersection(g.geometry, ST_MakeEnvelope(
            ST_XMin(g.geometry) + (n - 1) * (ST_XMax(g.geometry) - ST_XMin(g.geometry)) / 3, ST_YMin(g.geometry),
            ST_XMin(g.geometry) + n * (ST_XMax(g.geometry) - ST_XMin(g.geometry)) / 3, ST_YMax(g.geometry), 4326))) AS geometry,
            g.organization_id
          FROM g, generate_series(1, 3) n
        )
        INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity)
        SELECT p.organization_id, z.id, p.n, p.geometry, ST_Area(p.geometry::geography) / 10000, 90 + 10 * (p.n - 1)
        FROM parts p, z
        RETURNING zoning_id AS id`.execute(owner)
      return rows[0].id
    } finally {
      await owner.destroy()
    }
  }

  it('creates, exports and versions VRA maps; viewers can read but not write', async () => {
    const owner = await signIn('vra-owner')
    const viewer = await signIn('vra-viewer')
    const o = as(owner.token)
    const org = (await o.post('/orgs', { name: `VRA ${run}` }).expect(201)).body
    await o.post(`/orgs/${org.id}/members`, { email: viewer.email, displayName: 'Viewer', role: 'viewer' }).expect(201)
    const farm = (await o.post(`/orgs/${org.id}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await o.post(`/orgs/${org.id}/fields`, { farmId: farm.id, name: 'Große Breite', geometry: polygon(9.9, 52.3) }).expect(201)).body
    const zoningId = await seedZoning(field.id)
    const base = `/orgs/${org.id}/fields/${field.id}/vra-maps`
    const body = {
      zoningId,
      type: 'fertilizing',
      title: 'N1 Weizen',
      inputs: [{ inputType: 'fertilizing', name: 'KAS', unit: 'kg/ha', standardRate: 200, rates: { '1': 180, '2': 200, '3': 220 } }],
    }

    const v = as(viewer.token)
    await v.post(base, body).expect(403)
    // Rates must cover every zone of the zoning.
    const missing = await o.post(base, { ...body, inputs: [{ ...body.inputs[0], rates: { '1': 1, '2': 2 } }] }).expect(400)
    expect(missing.body.code).toBe('invalid_rates')
    await o.post(base, { ...body, type: 'sowing', inputs: [{ ...body.inputs[0], inputType: 'sowing', unit: 'seeds/ha' }] }).expect(400)

    const map = (await o.post(base, body).expect(201)).body
    expect(map.zoneCount).toBe(3)
    expect(map.inputs[0].columnName).toBe('RATE')
    expect(map.zones).toHaveLength(3)
    expect((await v.get(base).expect(200)).body.map((m: { id: string }) => m.id)).toEqual([map.id])

    const shp = await v.get(`${base}/${map.id}/export?format=shp`).responseType('blob').expect(200)
    expect(shp.headers['content-type']).toBe('application/zip')
    expect(shp.headers['content-disposition']).toMatch(/filename="Grosse_Breite_VRA_fertilizing_\d{4}-\d{2}-\d{2}\.zip"/)
    const zipBody = shp.body as Buffer
    expect(zipBody.readUInt32LE(0)).toBe(0x04034b50)
    for (const ext of ['shp', 'shx', 'dbf', 'prj']) expect(zipBody.includes(Buffer.from(`.${ext}`))).toBe(true)
    const iso = await o.get(`${base}/${map.id}/export?format=isoxml`).responseType('blob').expect(200)
    expect((iso.body as Buffer).includes(Buffer.from('TASKDATA/TASKDATA.XML'))).toBe(true)
    const geojson = JSON.parse((await o.get(`${base}/${map.id}/export?format=geojson`).responseType('blob').expect(200)).body.toString())
    expect(geojson.features.map((f: { properties: { RATE: number } }) => f.properties.RATE)).toEqual([180, 200, 220])

    // Updates need the current version.
    await v.put(`${base}/${map.id}`, { ...body, version: map.version }).expect(403)
    const updated = (await o.put(`${base}/${map.id}`, { ...body, status: 'final', version: map.version }).expect(200)).body
    expect(updated.status).toBe('final')
    await o.put(`${base}/${map.id}`, { ...body, version: map.version }).expect(409)

    await v.del(`${base}/${map.id}`).expect(403)
    await o.del(`${base}/${map.id}`).expect(204)
    await o.get(`${base}/${map.id}`).expect(404)
  })
})

function editable(op: { farmId: string; type: string; title: string; fields: { fieldId: string }[]; inputs: { productId: string; ratePerHa: number | null }[] }) {
  return {
    farmId: op.farmId,
    type: op.type,
    title: op.title,
    fields: op.fields.map((f) => ({ fieldId: f.fieldId })),
    inputs: op.inputs.map((i) => ({ productId: i.productId, ratePerHa: i.ratePerHa })),
  }
}

describe('Bundessortenamt varieties', () => {
  /** The catalogue is written by the BSA sync job; the test writes a made-up species as the database owner. */
  it('offers sowable registered varieties and links picks to them', async () => {
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const species = `Z${run.slice(0, 4).toUpperCase()}`
    try {
      const o = as((await signIn('bsa-owner')).token)
      const org = (await o.post('/orgs', { name: `BSA ${run}` }).expect(201)).body
      await sql`INSERT INTO bsa_species (code, name_de, botanical_name) VALUES (${species}, 'Testweizen', 'Triticum testum')`.execute(owner)
      await sql`INSERT INTO bsa_varieties (species_code, registration_number, name, approval_granted_on, approval_ended_on, marketable_until) VALUES
        (${species}, 1, 'Alpha', '2020-03-01', NULL, NULL),
        (${species}, 2, 'Beta', '2015-03-01', '2024-12-31', '2099-06-30'),
        (${species}, 3, 'Gamma', '2010-03-01', '2018-12-31', '2020-06-30'),
        (${species}, 4, 'Alpha', '1990-03-01', '2000-12-31', NULL),
        (${species}, 5, 'Delta', NULL, NULL, NULL)`.execute(owner)
      const { id: cropId } = await sql<{ id: string }>`INSERT INTO crops (organization_id, code, name, category, bsa_species_code)
        VALUES (${org.id}, 'custom_bsa_test', 'Test wheat', 'cereal', ${species}) RETURNING id`
        .execute(owner)
        .then((r) => r.rows[0])

      const registered = (await o.get(`/orgs/${org.id}/crops/${cropId}/registered-varieties`).expect(200)).body
      expect(registered.map((v: { name: string; registrationNumber: number; marketableUntil: string | null }) => [v.name, v.registrationNumber, v.marketableUntil])).toEqual([
        ['Alpha', 1, null],
        ['Beta', 2, '2099-06-30'],
      ])

      // A typed name that matches the register is stored under its registered spelling and linked.
      const picked = (await o.post(`/orgs/${org.id}/varieties`, { cropId, name: 'alpha' }).expect(201)).body
      expect(picked).toMatchObject({ name: 'Alpha', registeredVarietyId: registered[0].id })
      const again = (await o.post(`/orgs/${org.id}/varieties`, { cropId, name: 'ALPHA' }).expect(201)).body
      expect(again.id).toBe(picked.id)
      const custom = (await o.post(`/orgs/${org.id}/varieties`, { cropId, name: 'Hofsorte' }).expect(201)).body
      expect(custom.registeredVarietyId).toBeNull()
    } finally {
      // The crop would otherwise send every later BSA sync looking for the made-up species.
      await sql`DELETE FROM crops WHERE bsa_species_code = ${species}`.execute(owner)
      await sql`DELETE FROM bsa_species WHERE code = ${species}`.execute(owner)
      await owner.destroy()
    }
  })

  /** The EU catalogue is written by the same sync job; again a made-up species written as the owner. */
  it('adds EU catalogue varieties the BSA register lacks and links picks to them', async () => {
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const species = `Y${run.slice(0, 4).toUpperCase()}`
    const euSpecies = `ZZZZZ_${run.slice(0, 4).toUpperCase()}`
    try {
      const o = as((await signIn('eu-owner')).token)
      const org = (await o.post('/orgs', { name: `EU ${run}` }).expect(201)).body
      await sql`INSERT INTO bsa_species (code, name_de, botanical_name) VALUES (${species}, 'Testmais', 'Zea testis')`.execute(owner)
      await sql`INSERT INTO bsa_varieties (species_code, registration_number, name, approval_granted_on) VALUES
        (${species}, 1, 'DKC 2972', '2017-02-16'),
        (${species}, 2, 'Zeta', '2020-02-01')`.execute(owner)
      await sql`INSERT INTO eu_species (code, botanical_name) VALUES (${euSpecies}, 'Zea testis')`.execute(owner)
      await sql`INSERT INTO eu_varieties (species_code, name, countries, registered_on, marketable_until) VALUES
        (${euSpecies}, 'DKC2972', '{DE,FR}', '2017-01-01', NULL),
        (${euSpecies}, 'Bacardi', '{FR,IT}', '2016-12-21', NULL),
        (${euSpecies}, 'Ouvea', '{}', NULL, '2099-06-30'),
        (${euSpecies}, 'Gone', '{}', NULL, '2020-06-30')`.execute(owner)
      const { id: cropId } = await sql<{ id: string }>`INSERT INTO crops (organization_id, code, name, category, bsa_species_code, eu_species_code)
        VALUES (${org.id}, 'custom_eu_test', 'Test maize', 'maize', ${species}, ${euSpecies}) RETURNING id`
        .execute(owner)
        .then((r) => r.rows[0])

      // EU-only varieties join the BSA list; a BSA name spelt differently in the EU is listed once, as BSA.
      const registered = (await o.get(`/orgs/${org.id}/crops/${cropId}/registered-varieties`).expect(200)).body
      expect(registered.map((v: { name: string; source: string; countries: string[]; marketableUntil: string | null }) => [v.name, v.source, v.countries, v.marketableUntil])).toEqual([
        ['Bacardi', 'eu', ['FR', 'IT'], null],
        ['DKC 2972', 'bsa', [], null],
        ['Ouvea', 'eu', [], '2099-06-30'],
        ['Zeta', 'bsa', [], null],
      ])
      const bacardi = registered.find((v: { name: string }) => v.name === 'Bacardi')
      expect(bacardi).toMatchObject({ registrationNumber: null, approvedOn: '2016-12-21', speciesCode: euSpecies })

      // A typed EU-only name is stored under its catalogue spelling and linked; a BSA name wins over its EU twin.
      const picked = (await o.post(`/orgs/${org.id}/varieties`, { cropId, name: 'bacardi' }).expect(201)).body
      expect(picked).toMatchObject({ name: 'Bacardi', registeredVarietyId: bacardi.id })
      const dkc = (await o.post(`/orgs/${org.id}/varieties`, { cropId, name: 'dkc2972' }).expect(201)).body
      expect(dkc).toMatchObject({ name: 'DKC 2972', registeredVarietyId: registered.find((v: { name: string }) => v.name === 'DKC 2972').id })
      const listed = (await o.get(`/orgs/${org.id}/varieties?cropId=${cropId}`).expect(200)).body
      expect(listed.map((v: { name: string; registeredVarietyId: string | null }) => [v.name, v.registeredVarietyId])).toEqual([
        ['Bacardi', bacardi.id],
        ['DKC 2972', dkc.registeredVarietyId],
      ])
    } finally {
      await sql`DELETE FROM crops WHERE bsa_species_code = ${species}`.execute(owner)
      await sql`DELETE FROM bsa_species WHERE code = ${species}`.execute(owner)
      await sql`DELETE FROM eu_species WHERE code = ${euSpecies}`.execute(owner)
      await owner.destroy()
    }
  })

  /** One EU species, two BSA species and crops for its winter and spring forms. */
  it('splits EU catalogue varieties into winter and spring forms', async () => {
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const winter = `W${run.slice(0, 4).toUpperCase()}`
    const spring = `S${run.slice(0, 4).toUpperCase()}`
    const euSpecies = `ZZZZZ_S${run.slice(0, 4).toUpperCase()}`
    try {
      const o = as((await signIn('eu-season-owner')).token)
      const org = (await o.post('/orgs', { name: `EU seasons ${run}` }).expect(201)).body
      await sql`INSERT INTO bsa_species (code, name_de, botanical_name) VALUES
        (${winter}, 'Testwinterweizen', 'Triticum testum'), (${spring}, 'Testsommerweizen', 'Triticum testum')`.execute(owner)
      await sql`INSERT INTO bsa_varieties (species_code, registration_number, name, approval_granted_on) VALUES
        (${winter}, 1, 'Winterkönig', '2020-02-01'),
        (${spring}, 1, 'Lenz', '2020-02-01')`.execute(owner)
      await sql`INSERT INTO eu_species (code, botanical_name) VALUES (${euSpecies}, 'Triticum testum')`.execute(owner)
      await sql`INSERT INTO eu_varieties (species_code, name, countries, season) VALUES
        (${euSpecies}, 'Hiver', '{FR}', 'winter'),
        (${euSpecies}, 'Printemps', '{FR}', 'spring'),
        (${euSpecies}, 'Wechsel', '{AT}', 'alternative'),
        (${euSpecies}, 'Senza', '{IT}', NULL),
        (${euSpecies}, 'Lenz', '{IT}', NULL),
        (${euSpecies}, 'Winterkönig', '{PL}', 'winter')`.execute(owner)
      const crops = await sql<{ id: string; code: string }>`INSERT INTO crops (organization_id, code, name, category, bsa_species_code, eu_species_code, eu_season) VALUES
        (${org.id}, 'custom_winter_test', 'Test winter wheat', 'cereal', ${winter}, ${euSpecies}, 'winter'),
        (${org.id}, 'custom_spring_test', 'Test spring wheat', 'cereal', ${spring}, ${euSpecies}, 'spring')
        RETURNING id, code`
        .execute(owner)
        .then((r) => Object.fromEntries(r.rows.map((c) => [c.code, c.id])))
      const list = async (cropId: string) =>
        (await o.get(`/orgs/${org.id}/crops/${cropId}/registered-varieties`).expect(200)).body.map((v: { name: string; source: string; season: string | null }) => [v.name, v.source, v.season])

      // Each form lists its own, the alternative and the unstated EU varieties; a name the BSA
      // registers for the other form ("Lenz") is left out.
      expect(await list(crops.custom_winter_test)).toEqual([
        ['Hiver', 'eu', 'winter'],
        ['Senza', 'eu', null],
        ['Wechsel', 'eu', 'alternative'],
        ['Winterkönig', 'bsa', null],
      ])
      expect(await list(crops.custom_spring_test)).toEqual([
        ['Lenz', 'bsa', null],
        ['Printemps', 'eu', 'spring'],
        ['Senza', 'eu', null],
        ['Wechsel', 'eu', 'alternative'],
      ])
      const cropList = (await o.get(`/orgs/${org.id}/crops`).expect(200)).body
      expect(cropList.find((c: { id: string }) => c.id === crops.custom_winter_test)).toMatchObject({ euSpeciesCode: euSpecies, euSeason: 'winter' })

      // A spring variety typed for the winter crop is kept as typed, not linked to the catalogue.
      const hiver = (await o.post(`/orgs/${org.id}/varieties`, { cropId: crops.custom_winter_test, name: 'hiver' }).expect(201)).body
      expect(hiver).toMatchObject({ name: 'Hiver' })
      expect(hiver.registeredVarietyId).not.toBeNull()
      const printemps = (await o.post(`/orgs/${org.id}/varieties`, { cropId: crops.custom_winter_test, name: 'printemps' }).expect(201)).body
      expect(printemps).toMatchObject({ name: 'printemps', registeredVarietyId: null })
    } finally {
      await sql`DELETE FROM crops WHERE bsa_species_code IN (${winter}, ${spring})`.execute(owner)
      await sql`DELETE FROM bsa_species WHERE code IN (${winter}, ${spring})`.execute(owner)
      await sql`DELETE FROM eu_species WHERE code = ${euSpecies}`.execute(owner)
      await owner.destroy()
    }
  })
})
