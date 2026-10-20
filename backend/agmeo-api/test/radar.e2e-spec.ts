/**
 * DWD radar end to end: the refresh job (as the worker's database role, with a fake DWD source)
 * stores frames, the API serves the manifest and the PNGs to signed-in users only.
 *
 * Radar data is a global cache, not tenant data, so this test clears it on the shared database;
 * the next real refresh fills it again.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import type { RadarSource } from '../src/modules/radar/dwd.js'
import { encodePngRgba } from '../src/modules/radar/png.js'
import { NOWCAST_STEPS, RADAR_REFRESH, radarRefreshHandler } from '../src/modules/radar/radar-store.js'
import { dateToTimestamp } from '../src/modules/radar/radolan.js'
import { createStorageDriver } from '../src/storage/object-storage.js'
import type { Job } from '../src/jobs/runner.js'

const run = Math.random().toString(36).slice(2, 8)
const storage = createStorageDriver()
const jobsDb = createKysely(config.jobsDatabaseUrl, 1)
const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)

const FIVE_MIN = 5 * 60_000
const slot = Math.floor(Date.now() / FIVE_MIN) * FIVE_MIN
const ts = (minutesAgo: number) => dateToTimestamp(new Date(slot - minutesAgo * 60_000))
const analyses = [ts(10), ts(5), ts(0)]
const nowcastRun = ts(5)
const png = encodePngRgba(new Uint8Array([0, 0, 255, 200]), 1, 1)

const calls: string[] = []
const fake: RadarSource = {
  listAnalyses: async () => (calls.push('list'), analyses),
  renderAnalysis: async () => png,
  latestNowcastRun: async () => nowcastRun,
  renderNowcast: async (_run, steps) => steps.map((step) => ({ step, png })),
}
const refresh = radarRefreshHandler(jobsDb, storage, fake)
const job = { id: 0, kind: RADAR_REFRESH, payload: {} } as unknown as Job

async function clearRadar() {
  for (const f of await owner.selectFrom('radar_frames').select('storage_key').execute()) await storage.delete(f.storage_key)
  await owner.deleteFrom('radar_frames').execute()
  await owner.updateTable('radar_state').set({ last_viewed_at: null, nowcast_run_at: null, refreshed_at: null, last_error: null }).execute()
  await owner.deleteFrom('jobs').where('kind', '=', RADAR_REFRESH).where('dedupe_key', 'like', 'view:%').where('finished_at', 'is', null).execute()
}

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
  await clearRadar()
})

afterAll(async () => {
  await clearRadar()
  await app?.close()
  await Promise.all([jobsDb.destroy(), owner.destroy()])
})

describe('radar', () => {
  it('refreshes only while someone looks, and serves frames to signed-in users', async () => {
    await http().get('/v1/radar/manifest').expect(401)
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `radar-${run}@example.test`, displayName: 'Radar' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }

    // Nobody has looked yet: the job does nothing.
    await refresh(job)
    expect(calls).toEqual([])

    // The first view stamps the demand and, the radar being empty, queues a refresh at once.
    let m = (await http().get('/v1/radar/manifest').set(auth).expect(200)).body
    expect(m).toMatchObject({ frames: [], nowIndex: -1, refreshedAt: null, width: expect.any(Number), height: expect.any(Number) })
    expect(m.bounds).toHaveLength(4)
    const kicks = await owner.selectFrom('jobs').select('dedupe_key').where('kind', '=', RADAR_REFRESH).where('dedupe_key', 'like', 'view:%').where('finished_at', 'is', null).execute()
    expect(kicks).toHaveLength(1)
    // A second view in the same slot queues nothing more.
    await http().get('/v1/radar/manifest').set(auth).expect(200)
    expect(await owner.selectFrom('jobs').select('id').where('kind', '=', RADAR_REFRESH).where('dedupe_key', 'like', 'view:%').where('finished_at', 'is', null).execute()).toHaveLength(1)

    await refresh(job)
    expect(calls).toEqual(['list'])
    m = (await http().get('/v1/radar/manifest').set(auth).expect(200)).body
    const nowcast = m.frames.filter((f: { kind: string }) => f.kind === 'nowcast')
    expect(m.frames.slice(0, 3)).toEqual(analyses.map((key) => expect.objectContaining({ key, kind: 'analysis', leadMinutes: 0 })))
    expect(m.nowIndex).toBe(2)
    // The run is 5 minutes old: its +5 min frame is covered by the newest analysis.
    expect(nowcast.map((f: { leadMinutes: number }) => f.leadMinutes)).toEqual(NOWCAST_STEPS.slice(1))
    expect(nowcast[0]).toMatchObject({ key: `${nowcastRun}-010`, time: new Date(slot + 5 * 60_000).toISOString() })
    expect(m.refreshedAt).not.toBeNull()

    const frame = await http().get(`/v1/radar/frames/${analyses[2]}.png`).set(auth).expect(200)
    expect(frame.headers['content-type']).toBe('image/png')
    expect(frame.headers['cache-control']).toContain('immutable')
    expect(Buffer.from(frame.body as Buffer).equals(png)).toBe(true)
    await http().get(`/v1/radar/frames/${nowcastRun}-120.png`).set(auth).expect(200)
    await http().get(`/v1/radar/frames/${analyses[2]}.png`).expect(401)
    await http().get('/v1/radar/frames/1901010000.png').set(auth).expect(404)
    await http().get('/v1/radar/frames/..%2F..%2Fsecret.png').set(auth).expect(404)

    // Idempotent: a second run renders nothing new.
    await refresh(job)
    const { n } = await owner.selectFrom('radar_frames').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()
    expect(Number(n)).toBe(3 + NOWCAST_STEPS.length)
  })

  it('prunes analyses past the window and superseded nowcast runs', async () => {
    const old = dateToTimestamp(new Date(slot - 8 * 3_600_000))
    const at = new Date(slot - 8 * 3_600_000)
    await owner.insertInto('radar_frames').values([
      { key: old, kind: 'analysis', valid_at: at, run_at: at, storage_key: `radar/analysis/${old}.png` },
      { key: `${old}-005`, kind: 'nowcast', valid_at: at, run_at: at, lead_minutes: 5, storage_key: `radar/nowcast/${old}/005.png` },
    ]).execute()
    await storage.put(`radar/analysis/${old}.png`, png, 'image/png')
    await refresh(job)
    const keys = (await owner.selectFrom('radar_frames').select('key').execute()).map((r) => r.key)
    expect(keys).not.toContain(old)
    expect(keys).not.toContain(`${old}-005`)
    expect(keys).toContain(analyses[0])
    expect(await storage.size(`radar/analysis/${old}.png`)).toBeNull()
  })
})
