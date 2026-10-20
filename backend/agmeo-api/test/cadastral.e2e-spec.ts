/**
 * Cadastral parcels and leases: map lookup through the WFS proxy, a field made of parcels, the
 * parcel sync, leases, lease analytics and the lease figure economics uses. The cadastre services
 * answer with responses recorded from the state services (src/modules/cadastral/wfs/__fixtures__).
 */
import { readFileSync } from 'node:fs'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { WfsHttp } from '../src/modules/cadastral/wfs/client.js'
import { WfsError } from '../src/modules/cadastral/wfs/gml.js'

const run = Math.random().toString(36).slice(2, 8)
const fixture = (name: string) => readFileSync(new URL(`../src/modules/cadastral/wfs/__fixtures__/${name}.xml`, import.meta.url), 'utf8')

const requests: string[] = []
const fakeHttp = {
  async get(url: string) {
    requests.push(url)
    if (url.includes('niedersachsen')) return fixture('ni')
    throw new WfsError('unavailable', 'HTTP 503 Service Unavailable')
  },
}

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(WfsHttp).useValue(fakeHttp).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  await app?.close()
})

async function setup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `cad-${run}-${Math.random()}@example.test`, displayName: 'Cad' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    del: (url: string) => http().delete(`/v1${url}`).set(auth),
  }
  const org = (await u.post('/orgs', { name: `Cadastre ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Reinshof' }).expect(201)).body
  return { u, base, farm }
}

type Parcel = { id: string; officialId: string; label: string; areaM2: number; fieldShare: number; fieldAreaM2: number; rentPerYear: number | null; fieldRentPerYear: number | null; lease: { leaseType: string } | null }

describe('cadastral parcels', () => {
  it('looks up parcels, makes a field of them, syncs and keeps leases', async () => {
    const { u, base, farm } = await setup()

    // Outside Germany, in Bayern (no open service) and in a state whose service is down.
    expect((await u.get(`${base}/cadastral/lookup?west=2.34&south=48.85&east=2.35&north=48.855`).expect(200)).body.status).toBe('unsupported')
    const by = (await u.get(`${base}/cadastral/lookup?west=11.5&south=48.1&east=11.51&north=48.105`).expect(200)).body
    expect(by).toMatchObject({ status: 'no_access', state: { code: 'BY' } })
    const sn = (await u.get(`${base}/cadastral/lookup?west=13.7&south=51.05&east=13.705&north=51.053`).expect(200)).body
    expect(sn).toMatchObject({ status: 'unavailable', state: { code: 'SN', name: 'Sachsen' } })
    await u.get(`${base}/cadastral/lookup?west=9&south=51&east=10&north=52`).expect(400)

    const lookup = (await u.get(`${base}/cadastral/lookup?west=9.928&south=51.499&east=9.932&north=51.501`).expect(200)).body
    expect(lookup.status).toBe('ok')
    expect(lookup.state).toMatchObject({ code: 'NI', attribution: '© LGLN' })
    const candidates = lookup.parcels as { officialId: string; label: string; areaM2: number; geometry: object }[]
    expect(candidates.length).toBe(3)
    expect(new Set(candidates.map((p) => p.officialId)).size).toBe(3)
    const big = candidates.find((p) => p.officialId === '036520015000210001__')!
    expect(big).toMatchObject({ label: 'Gmk. 036520 Flur 15 21/1', areaM2: 75240 })
    // Repeated views come from the cache.
    const before = requests.length
    await u.get(`${base}/cadastral/lookup?west=9.928&south=51.499&east=9.932&north=51.501`).expect(200)
    expect(requests.length).toBe(before)

    // A field of one parcel: its boundary is the parcel, the parcel is stored with it.
    const field = (await u.post(`${base}/cadastral/fields`, { farmId: farm.id, name: 'Am Reinshof', state: 'NI', parcels: [big] }).expect(201)).body
    expect(field.areaHa).toBeGreaterThan(7.4)
    expect(field.areaHa).toBeLessThan(7.6)
    let parcels = (await u.get(`${base}/cadastral/parcels?fieldId=${field.id}`).expect(200)).body as Parcel[]
    expect(parcels).toHaveLength(1)
    expect(parcels[0]).toMatchObject({ officialId: big.officialId, areaM2: 75240, lease: null })
    expect(parcels[0].fieldShare).toBeGreaterThan(0.99)

    // Lease it: 300 per ha → 2257.20 per year for the whole parcel.
    const leased = (await u.put(`${base}/cadastral/parcels/${parcels[0].id}/lease`, { leaseType: 'lease_fixed_term', ownerName: 'Erbengemeinschaft Meyer', rentAmount: 300, rentBasis: 'per_ha', startsOn: '2020-10-01', endsOn: '2027-03-31' }).expect(200)).body as Parcel
    expect(leased.lease).toMatchObject({ leaseType: 'lease_fixed_term', ownerName: 'Erbengemeinschaft Meyer' })
    expect(leased.rentPerYear).toBeCloseTo(2257.2, 1)
    await u.put(`${base}/cadastral/parcels/${parcels[0].id}/lease`, { leaseType: 'ownership', startsOn: '2026-01-01', endsOn: '2025-01-01' }).expect(400)

    // Sync: the stored parcel is kept (lease intact), parcels mostly outside the field are not added.
    const sync = (await u.post(`${base}/cadastral/sync`, { fieldIds: [field.id] }).expect(200)).body
    expect(sync.fields[0]).toMatchObject({ fieldId: field.id, state: 'NI', skipped: 1 })
    expect(['ok', 'ok_slow']).toContain(sync.fields[0].status)
    parcels = (await u.get(`${base}/cadastral/parcels?fieldId=${field.id}`).expect(200)).body
    expect(parcels.find((p) => p.officialId === big.officialId)!.lease).toMatchObject({ leaseType: 'lease_fixed_term' })

    // A manual parcel, and the analytics.
    const ring = (big.geometry as { coordinates: number[][][][] }).coordinates[0][0]
    const manual = (await u.post(`${base}/cadastral/parcels`, { fieldId: field.id, label: 'Wegeparzelle', geometry: { type: 'Polygon', coordinates: [ring] } }).expect(201)).body
    expect(manual).toMatchObject({ source: 'manual', label: 'Wegeparzelle' })
    await u.del(`${base}/cadastral/parcels/${manual.id}`).expect(204)

    const analytics = (await u.get(`${base}/cadastral/leases/analytics?months=12`).expect(200)).body
    expect(analytics.leasedParcels).toBe(1)
    expect(analytics.leasedParcelsWithRent).toBe(1)
    expect(analytics.leasedHa).toBeGreaterThan(7.4)
    expect(analytics.rentPerLeasedHa).toBeGreaterThan(295)
    expect(analytics.rentPerLeasedHa).toBeLessThan(305)
    expect(analytics.expiring).toHaveLength(1)
    expect(analytics.expiring[0]).toMatchObject({ endsOn: '2027-03-31', ownerName: 'Erbengemeinschaft Meyer' })
    const summary = analytics.fields.find((f: { fieldId: string }) => f.fieldId === field.id)
    expect(summary.derivedLeasePerHa).toBeGreaterThan(290)
    expect(summary.effectiveLeasePerHa).toBe(summary.derivedLeasePerHa)

    // The field's own lease wins in economics.
    const patched = (await u.patch(`${base}/fields/${field.id}`, { leasePerHa: 450 }).expect(200)).body
    expect(patched.leasePerHa).toBe(450)
    const after = (await u.get(`${base}/cadastral/leases/analytics`).expect(200)).body
    expect(after.fields.find((f: { fieldId: string }) => f.fieldId === field.id)).toMatchObject({ leasePerHa: 450, effectiveLeasePerHa: 450 })

    await u.del(`${base}/cadastral/parcels/${parcels[0].id}/lease`).expect(204)
    await u.del(`${base}/cadastral/parcels/${parcels[0].id}`).expect(204)
    expect((await u.get(`${base}/cadastral/parcels`).expect(200)).body).toHaveLength(parcels.length - 1)
  })

  it('keeps parcels of other organizations apart', async () => {
    const a = await setup()
    const b = await setup()
    const lookup = (await a.u.get(`${a.base}/cadastral/lookup?west=9.928&south=51.499&east=9.932&north=51.501`).expect(200)).body
    await a.u.post(`${a.base}/cadastral/fields`, { farmId: a.farm.id, name: 'A', parcels: lookup.parcels.slice(0, 1) }).expect(201)
    const [p] = (await a.u.get(`${a.base}/cadastral/parcels`).expect(200)).body as Parcel[]
    expect((await b.u.get(`${b.base}/cadastral/parcels`).expect(200)).body).toEqual([])
    await b.u.put(`${b.base}/cadastral/parcels/${p.id}/lease`, { leaseType: 'ownership' }).expect(404)
    await b.u.del(`${b.base}/cadastral/parcels/${p.id}`).expect(404)
  })
})
