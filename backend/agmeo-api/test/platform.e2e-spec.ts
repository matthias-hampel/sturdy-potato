/**
 * Platform foundations: account language, organization units, invitation e-mails.
 * Runs against the local database like the other e2e tests (AUTH_MODE=dev).
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'

const run = Math.random().toString(36).slice(2, 8)
let app: INestApplication<App>
const http = () => request(app.getHttpServer())
// The owner connection reads the job queue, which the API role may only append to.
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 2)

async function signIn(name: string) {
  const email = `${name}-${run}@example.test`
  const res = await http().post('/v1/auth/dev/sign-in').send({ email, displayName: name }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  return {
    email,
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
  await owner.destroy()
})

describe('auth configuration', () => {
  it('tells the web app which sign-in to use', async () => {
    const res = await http().get('/v1/auth/config').expect(200)
    expect(res.body).toEqual(config.auth.mode === 'oidc' ? { mode: 'oidc', issuer: config.auth.issuer, clientId: config.auth.webClientId } : { mode: 'dev' })
  })
})

describe('account language', () => {
  it('accepts only German (the app is German-only)', async () => {
    const u = await signIn('lang')
    expect((await u.get('/me').expect(200)).body.locale).toBeNull()
    expect((await u.patch('/me', { locale: 'de' }).expect(200)).body.locale).toBe('de')
    await u.patch('/me', { locale: 'en' }).expect(400)
    await u.patch('/me', { locale: 'pl' }).expect(400)
    await u.patch('/me', { locale: 'it' }).expect(400)
    expect((await u.get('/me').expect(200)).body.locale).toBe('de')
  })
})

describe('organization units', () => {
  it('derives the system from the country until one is chosen', async () => {
    const u = await signIn('units')
    const org = (await u.post('/orgs', { name: `Units ${run}`, country: 'US', currency: 'EUR' }).expect(201)).body
    expect(org).toMatchObject({ measurementSetting: 'auto', measurementSystem: 'imperial' })
    const updated = (await u.patch(`/orgs/${org.id}`, { measurementSetting: 'metric' }).expect(200)).body
    expect(updated).toMatchObject({ measurementSetting: 'metric', measurementSystem: 'metric' })
  })
})

describe('invitations', () => {
  it('queues a German invitation e-mail with the commit', async () => {
    const inviter = await signIn('inviter')
    const org = (await inviter.post('/orgs', { name: `Invite ${run}` }).expect(201)).body
    const invitee = `invitee-${run}@example.test`
    await inviter.post(`/orgs/${org.id}/members`, { email: invitee, displayName: 'Invitee', role: 'agronomist' }).expect(201)

    const jobs = await owner.selectFrom('jobs').select(['kind', 'payload']).where('organization_id', '=', org.id).execute()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].kind).toBe('email.send')
    expect(jobs[0].payload).toMatchObject({ to: invitee, template: 'invitation', params: { orgName: `Invite ${run}`, role: 'agronomist' } })

    // A rejected invitation (already a member) queues nothing.
    await inviter.post(`/orgs/${org.id}/members`, { email: invitee, displayName: 'Invitee', role: 'agronomist' }).expect(409)
    expect(await owner.selectFrom('jobs').select('id').where('organization_id', '=', org.id).execute()).toHaveLength(1)
  })
})
