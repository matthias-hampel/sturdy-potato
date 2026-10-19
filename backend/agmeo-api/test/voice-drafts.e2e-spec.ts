/**
 * Voice drafts end to end: typed dictations parsed against the organization's names, transcript
 * corrections, confirm/reject transitions, and a recording transcribed by the job through a stub
 * speech-to-text service.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import { voiceTranscribeHandler } from '../src/modules/voice/voice.service.js'
import { createStorageDriver } from '../src/storage/object-storage.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

let app: INestApplication<App>
let stt: Server
let sttRequests: { auth: string | undefined; body: string }[] = []
const http = () => request(app.getHttpServer())
const savedVoice = { ...config.voice }

beforeAll(async () => {
  stt = createServer((req, res) => {
    let body = ''
    req.setEncoding('latin1')
    req.on('data', (c: string) => (body += c))
    req.on('end', () => {
      sttRequests.push({ auth: req.headers.authorization, body })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ text: 'Heute auf dem Kamp Harnstoff gestreut, zweihundert Kilo pro Hektar.' }))
    })
  })
  await new Promise<void>((r) => stt.listen(0, '127.0.0.1', r))
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1')
  await app.init()
})

afterAll(async () => {
  Object.assign(config.voice, savedVoice)
  await app?.close()
  await new Promise((r) => stt?.close(r))
})

describe('voice drafts', () => {
  it('turns dictations into reviewed draft operations', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `voice-${run}@example.test`, displayName: 'Voice' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `Voice ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const urea = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Harnstoff 46', baseUnit: 't', nPct: 46, fertilizerType: 'urea' }).expect(201)).body

    // Without a speech-to-text service recordings are refused; typed dictations work.
    config.voice.sttUrl = ''
    expect((await u.get(`${base}/voice-drafts/config`).expect(200)).body).toMatchObject({ transcription: false })
    const refused = await http().post(`/v1${base}/voice-drafts/audio`).set(auth).attach('file', Buffer.from('OggS fake'), { filename: 'a.ogg', contentType: 'audio/ogg' }).expect(503)
    expect(refused.body.code).toBe('service_not_configured')

    let d = (await u.post(`${base}/voice-drafts/text`, { transcript: 'Gestern auf dem Kamp Harnstoff gestreut, 200 Kilo pro Hektar.' }).expect(201)).body
    expect(d).toMatchObject({ source: 'text', status: 'draft', confidence: 'high', missing: [], hasAudio: false })
    expect(d.draft).toMatchObject({ kind: 'operation', fieldName: 'Kamp', articleName: 'Harnstoff 46', category: 'fertilization', quantity: 200, unit: 'kg/ha', date: 'gestern' })
    expect(d.resolved).toMatchObject({ fieldId: field.id, productId: urea.id, operationType: 'fertilization', ratePerHa: 0.2 })
    await u.post(`${base}/voice-drafts/text`, { transcript: '  ' }).expect(400)

    // Correcting the transcript parses again.
    d = (await u.patch(`${base}/voice-drafts/${d.id}`, { transcript: 'Auf dem Kamp gespritzt, wieviel weiß ich nicht mehr.' }).expect(200)).body
    expect(d.draft).toMatchObject({ category: 'plantProtection', quantity: null })
    expect(d.missing).toEqual(['articleName', 'quantity', 'unit'])
    expect(d.confidence).toBe('low')

    // Confirm with the operation created from it; replays are fine, other transitions conflict.
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'crop_protection', title: 'Aus Sprachnotiz', plannedOn: '2026-04-20', fields: [{ fieldId: field.id }] }).expect(201)).body
    await u.post(`${base}/voice-drafts/${d.id}/confirm`, { operationId: '00000000-0000-4000-8000-000000000000' }).expect(404)
    d = (await u.post(`${base}/voice-drafts/${d.id}/confirm`, { operationId: op.id }).expect(200)).body
    expect(d).toMatchObject({ status: 'confirmed', operationId: op.id })
    await u.post(`${base}/voice-drafts/${d.id}/confirm`, { operationId: op.id }).expect(200)
    expect((await u.post(`${base}/voice-drafts/${d.id}/reject`).expect(409)).body.code).toBe('voice_draft_not_open')
    await u.patch(`${base}/voice-drafts/${d.id}`, { transcript: 'x' }).expect(409)

    const note = (await u.post(`${base}/voice-drafts/text`, { transcript: 'Beobachtung: Gelbrost am Kamp.' }).expect(201)).body
    expect(note.draft).toMatchObject({ kind: 'observation' })
    expect((await u.post(`${base}/voice-drafts/${note.id}/reject`).expect(200)).body.status).toBe('rejected')

    // A recording: stored, queued, transcribed by the job through the configured service.
    config.voice.sttUrl = `http://127.0.0.1:${(stt.address() as AddressInfo).port}/v1`
    config.voice.sttApiKey = 'test-key'
    expect((await u.get(`${base}/voice-drafts/config`).expect(200)).body.transcription).toBe(true)
    await http().post(`/v1${base}/voice-drafts/audio`).set(auth).attach('file', Buffer.from('not audio'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400)
    let rec = (await http().post(`/v1${base}/voice-drafts/audio`).set(auth).field('durationSec', '7.5').attach('file', Buffer.from('OggS fake audio'), { filename: 'memo.ogg', contentType: 'audio/ogg' }).expect(201)).body
    expect(rec).toMatchObject({ source: 'audio', status: 'pending', hasAudio: true, durationSec: 7.5 })
    const audio = await u.get(`${base}/voice-drafts/${rec.id}/audio`).expect(200)
    expect(audio.headers['content-type']).toBe('audio/ogg')

    const jobs = createKysely(config.jobsDatabaseUrl, 1)
    try {
      await voiceTranscribeHandler(jobs, createStorageDriver())({ payload: { draftId: rec.id } } as never)
    } finally {
      await jobs.destroy()
    }
    expect(sttRequests).toHaveLength(1)
    expect(sttRequests[0].auth).toBe('Bearer test-key')
    expect(sttRequests[0].body).toContain('OggS fake audio')
    expect(sttRequests[0].body).toContain('whisper-1')
    rec = (await u.get(`${base}/voice-drafts/${rec.id}`).expect(200)).body
    expect(rec).toMatchObject({ status: 'draft', transcript: 'Heute auf dem Kamp Harnstoff gestreut, zweihundert Kilo pro Hektar.' })
    expect(rec.resolved).toMatchObject({ fieldId: field.id, productId: urea.id, ratePerHa: 0.2 })
    await u.post(`${base}/voice-drafts/${rec.id}/retry`).expect(409)

    const list = (await u.get(`${base}/voice-drafts`).expect(200)).body
    expect(list.map((x: { id: string }) => x.id)).toContain(rec.id)
    expect((await u.get(`${base}/voice-drafts?status=rejected`).expect(200)).body).toHaveLength(1)
    await u.get(`${base}/voice-drafts?status=nope`).expect(400)
    sttRequests = []
  })
})
