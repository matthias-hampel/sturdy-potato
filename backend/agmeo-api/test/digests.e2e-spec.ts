/**
 * E-mail digests of the worker: the rain digest in the organization's local morning (once per
 * day, per member, limited to the member's farms) and the weekly storage notice.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'kysely'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import { sendRainDigest, storageDigestHandler } from '../src/modules/notifications/digest.jobs.js'

const run = Math.random().toString(36).slice(2, 8)
// A spot nobody else's tests use, so the weather rows written here are this test's own.
const x0 = -30 - Math.random() * 10
const y0 = -50 - Math.random() * 10
const rect = (dx: number) => ({
  type: 'Polygon',
  coordinates: [[[x0 + dx, y0], [x0 + dx + 0.002, y0], [x0 + dx + 0.002, y0 + 0.002], [x0 + dx, y0 + 0.002], [x0 + dx, y0]]],
})

let app: INestApplication<App>
const http = () => request(app.getHttpServer())
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 2)
const jobsDb = createKysely(config.jobsDatabaseUrl, 2)

async function signIn(name: string) {
  const email = `${name}-${run}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    email,
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
  await owner.destroy()
  await jobsDb.destroy()
})

describe('rain digest', () => {
  it('mails each member once in the local morning, limited to their farms', async () => {
    const u = await signIn('rain')
    const org = (await u.post('/orgs', { name: `Regen ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const north = (await u.post(`${base}/farms`, { name: 'Nord' }).expect(201)).body
    const south = (await u.post(`${base}/farms`, { name: 'Süd' }).expect(201)).body
    await u.post(`${base}/fields`, { farmId: north.id, name: 'Nass', geometry: rect(0) }).expect(201)
    await u.post(`${base}/fields`, { farmId: south.id, name: 'Trocken', geometry: rect(0.5) }).expect(201)
    const limitedEmail = `rain-limited-${run}@example.test`
    await u.post(`${base}/members`, { email: limitedEmail, role: 'worker', farmIds: [south.id] }).expect(201)
    await signIn('rain-limited')

    // 2026-10-19 07:00 in Berlin; the window is 18th 06:00 – 19th 06:00 local (04:00Z – 04:00Z).
    const now = new Date('2026-10-19T05:00:00Z')
    const date = '2026-10-19'
    const { rows: fields } = await sql<{ name: string; lat: number; lng: number }>`SELECT name, lat, lng FROM app.rain_digest_fields(${org.id}::uuid, ${date}::date)`.execute(owner)
    expect(fields).toHaveLength(2)
    for (const f of fields) {
      await owner.insertInto('weather_cells').values({ lat: f.lat, lng: f.lng, timezone: 'Europe/Berlin', refreshed_at: new Date('2026-10-19T02:40:00Z') }).onConflict((oc) => oc.columns(['lat', 'lng']).doNothing()).execute()
      const mmPerHour = f.name === 'Nass' ? 0.5 : 0
      for (let h = 0; h < 24; h++) {
        const time = new Date(Date.UTC(2026, 9, 18, 4 + h))
        await owner.insertInto('weather_hourly').values({ lat: f.lat, lng: f.lng, time, precipitation: mmPerHour }).onConflict((oc) => oc.columns(['lat', 'lng', 'time']).doNothing()).execute()
      }
    }
    try {
      const orgRow = { organization_id: org.id, name: org.name, country: 'DE', measurement_setting: 'auto', timezone: 'Europe/Berlin' }
      // Not before 06:30 local, and not while the digest is switched off (the job reads the switch through rain_digest_orgs).
      expect(await sendRainDigest(jobsDb, orgRow, new Date('2026-10-19T04:00:00Z'))).toBe(0)
      const { rows: before } = await sql<{ organization_id: string }>`SELECT organization_id FROM app.rain_digest_orgs()`.execute(owner)
      expect(before.map((r) => r.organization_id)).not.toContain(org.id)
      await u.patch(base, { rainDigestEnabled: true }).expect(200)

      expect(await sendRainDigest(jobsDb, orgRow, now)).toBe(2)
      const mails = await owner.selectFrom('jobs').select(['payload', 'dedupe_key']).where('organization_id', '=', org.id).where('kind', '=', 'email.send').execute()
      const byTo = new Map(mails.map((m) => [(m.payload as { to: string }).to, m.payload as { template: string; locale: string; params: { totalFields: number; rainedFields: number; most: { name: string; precipMm: number }[] }; headers: Record<string, string> }]))
      const full = byTo.get(u.email)!
      expect(full).toMatchObject({ template: 'rainDigest', locale: 'de', params: { totalFields: 2, rainedFields: 1 } })
      expect(full.params.most[0]).toMatchObject({ name: 'Nass', precipMm: 12 })
      expect(full.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
      expect(byTo.get(limitedEmail)!.params).toMatchObject({ totalFields: 1, rainedFields: 0, most: [{ name: 'Trocken' }] })

      // Once per day: a later tick finds the queued mails.
      expect(await sendRainDigest(jobsDb, orgRow, new Date('2026-10-19T06:00:00Z'))).toBe(0)
    } finally {
      for (const f of fields) await owner.deleteFrom('weather_cells').where('lat', '=', f.lat).where('lng', '=', f.lng).execute()
    }
  })
})

describe('storage digest', () => {
  it('notifies owners of organizations above 80 % of their allowance once a week', async () => {
    const u = await signIn('storage')
    const org = (await u.post('/orgs', { name: `Speicher ${run}` }).expect(201)).body
    await owner.updateTable('organizations').set({ storage_limit_bytes: 1000 }).where('id', '=', org.id).execute()
    await owner.insertInto('files').values({ organization_id: org.id, name: 'gross.pdf', size_bytes: 900, storage_key: `test/${run}/gross.pdf` }).execute()
    const handler = storageDigestHandler(jobsDb, () => new Date('2026-10-19T06:00:00Z'))
    await handler()
    await handler()
    const mails = await owner.selectFrom('jobs').select(['payload']).where('organization_id', '=', org.id).where('kind', '=', 'email.send').execute()
    expect(mails).toHaveLength(1)
    expect(mails[0].payload).toMatchObject({ to: u.email, template: 'storageDigest', params: { usedBytes: 900, limitBytes: 1000 } })
  })
})
