/**
 * Yield maps end to end: upload an ISO-XML TaskData export, match it to the field, build the
 * merged raster in the worker, read raster statistics, tiles and zone yields, fill the
 * documented harvest from the map, and save yield zones.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'kysely'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { config } from '../src/config.js'
import { createKysely } from '../src/db/database.js'
import { createStorageDriver } from '../src/storage/object-storage.js'
import { buildZip } from '../src/modules/yield/lib/zip.js'
import { YIELD_BUILD, yieldJobHandlers } from '../src/modules/yield/yield-builder.js'
import type { Job } from '../src/jobs/runner.js'

const run = Math.random().toString(36).slice(2, 8)
// A field of its own, ~280 m × 280 m.
const lng = 9 + Math.floor(Math.random() * 300) / 100
const lat = 51 + Math.floor(Math.random() * 100) / 100
const W = 0.004
const H = 0.0025
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

const M_LAT = 1 / 111_200
const M_LON = 1 / (111_320 * Math.cos((lat * Math.PI) / 180))

/**
 * An ISO 11783 TaskData export of a combine: serpentine passes 6 m apart at 1.5 m/s, 1 Hz,
 * yield (DDI 84, mg/m²) rising from 7 t/ha in the west to 10 t/ha in the east, moisture 15 %
 * (DDI 99, ppm) and a 6 m working width (DDI 67, mm).
 */
function taskData(): Buffer {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<TIM A="" D="4"><PTN A="" B=""/><DLV A="0054" B="" C="DET-1"/><DLV A="0063" B="" C="DET-1"/><DLV A="0043" B="" C="DET-1"/></TIM>`
  const records: Buffer[] = []
  let ms = 10 * 3_600_000
  const days = Math.round((Date.UTC(2026, 6, 28) - Date.UTC(1980, 0, 1)) / 86_400_000)
  const widthM = W / M_LON
  const lengthM = H / M_LAT
  const passes = Math.floor((widthM - 6) / 6)
  for (let p = 0; p < passes; p++) {
    const x = 3 + p * 6
    const steps = Math.floor((lengthM - 4) / 1.5)
    for (let s = 0; s < steps; s++) {
      const y = 2 + (p % 2 === 0 ? s : steps - 1 - s) * 1.5
      const yieldTHa = 7 + (3 * x) / widthM
      const first = p === 0 && s === 0
      const rec = Buffer.alloc(4 + 2 + 8 + 1 + (first ? 15 : 5))
      rec.writeUInt32LE(ms, 0)
      rec.writeUInt16LE(days, 4)
      rec.writeInt32LE(Math.round((lat + y * M_LAT) * 1e7), 6)
      rec.writeInt32LE(Math.round((lng + x * M_LON) * 1e7), 10)
      rec.writeUInt8(first ? 3 : 1, 14)
      rec.writeUInt8(0, 15)
      rec.writeInt32LE(Math.round(yieldTHa * 100_000), 16)
      if (first) {
        rec.writeUInt8(1, 20)
        rec.writeInt32LE(150_000, 21)
        rec.writeUInt8(2, 25)
        rec.writeInt32LE(6000, 26)
      }
      records.push(rec)
      ms += 1000
    }
    ms += 15_000
  }
  return buildZip({
    'TASKDATA/TASKDATA.XML': `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareManufacturer="test" ManagementSoftwareVersion="1" DataTransferOrigin="2">
<TSK A="TSK1" B="Ernte" G="4"><TLG A="TLG00001"/></TSK>
</ISO11783_TaskData>`,
    'TASKDATA/TLG00001.XML': header,
    'TASKDATA/TLG00001.BIN': Buffer.concat(records),
  })
}

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

describe('yield maps', () => {
  it('imports an ISO-XML export, builds the raster, reports zone yields and fills the harvest', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `yield-${run}@example.test`, displayName: 'Ertrag' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const u = {
      get: (url: string) => http().get(`/v1${url}`).set(auth),
      post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
      patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
      put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    }
    const org = (await u.post('/orgs', { name: `Ertrag ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await u.post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(lng, lat, lng + W, lat + H) }).expect(201)).body
    const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const wheatId = crops.find((c) => c.code === 'winter_wheat')!.id
    const cycle = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: wheatId }).expect(201)).body[0]

    // Upload: stored in the yield-map folder, read, and matched to the field.
    const upload = await http()
      .post(`/v1${base}/yield-maps/upload`)
      .set(auth)
      .field('names', JSON.stringify(['Ernte 2026.zip']))
      .field('seasonId', season.id)
      .attach('files', taskData(), 'upload.bin')
      .expect(201)
    const [inspection] = upload.body
    expect(inspection).toMatchObject({ fileName: 'Ernte 2026.zip', format: 'isoxml', plausible: true, error: null })
    expect(inspection.attribute).toContain('DDI 84')
    expect(inspection.harvestedFrom.slice(0, 10)).toBe('2026-07-28')
    expect(inspection.matches).toEqual([expect.objectContaining({ cropCycleId: cycle.id, fieldName: 'Breite' })])
    expect(inspection.matches[0].share).toBeGreaterThan(0.95)
    const folders = (await u.get(`${base}/files/folders`).expect(200)).body as { name: string }[]
    expect(folders.map((f) => f.name)).toContain('Ertragskarten')

    // A non-map is refused before anything is stored.
    await http().post(`/v1${base}/yield-maps/upload`).set(auth).field('names', JSON.stringify(['notes.txt'])).attach('files', Buffer.from('x'), 'upload.bin').expect(400)

    const [source] = (await u.post(`${base}/yield-maps/sources`, { fileId: inspection.fileId, cropCycleIds: [cycle.id] }).expect(201)).body
    expect(source).toMatchObject({ status: 'pending_parse', fileName: 'Ernte 2026.zip', includedInMerge: true })

    // The worker builds the crop cycle (as the jobs role).
    const jobsDb = createKysely(config.jobsDatabaseUrl, 2)
    const handlers = yieldJobHandlers(jobsDb, createStorageDriver())
    const build = () => handlers[YIELD_BUILD]({ payload: { cropCycleId: cycle.id } } as unknown as Job)
    await build()

    let view = (await u.get(`${base}/yield-maps/crop-cycles/${cycle.id}`).expect(200)).body
    expect(view.sources[0]).toMatchObject({ status: 'ok', format: 'isoxml', basis: 'wet' })
    expect(view.sources[0].quality.plausible).toBe(true)
    expect(view.sources[0].moisture.mean).toBeCloseTo(15, 1)
    expect(view.sources[0].cleaning.track.untimed).toBe(false)
    expect(view.rasters).toHaveLength(1)
    const raster = view.rasters[0]
    expect(raster.grid.epsg).toBe(32600 + Math.floor((lng + 180) / 6) + 1)
    expect(raster.grid.resolution).toBe(10)
    expect(raster.targetMoisture).toBe(14)
    // 7–10 t/ha at 15 % moisture, standardised to 14 %: × 85/86.
    expect(raster.stats.mean).toBeGreaterThan(7.5)
    expect(raster.stats.mean).toBeLessThan(9.5)
    expect(raster.stats.q80).toBeGreaterThan(raster.stats.q20)
    expect(raster.fieldCoverage).toBeGreaterThan(0.7)
    expect(raster.totalT).toBeGreaterThan(0)
    expect(raster.histogram).toHaveLength(20)
    expect(raster.contributions).toEqual([expect.objectContaining({ sourceId: source.id })])
    expect(raster.writeback).toMatchObject({ status: 'filled', reason: null })

    // Write-back: no harvest was documented, so one was created from the map.
    const harvests = (await u.get(`${base}/harvests?cropCycleId=${cycle.id}`).expect(200)).body
    expect(harvests).toHaveLength(1)
    expect(harvests[0]).toMatchObject({ harvestDate: '2026-07-28', notes: 'Ertragskarte' })
    expect(harvests[0].quantityT).toBeCloseTo(raster.stats.mean * harvests[0].harvestedAreaHa, 0)
    expect(view.documented.fromMap).toBe(true)

    // Building again with nothing changed keeps the raster.
    await build()
    view = (await u.get(`${base}/yield-maps/crop-cycles/${cycle.id}`).expect(200)).body
    expect(view.rasters.map((r: { id: string }) => r.id)).toEqual([raster.id])

    // Map tiles: the field's tile carries pixels; a tile elsewhere is empty but valid.
    const z = 16
    const tx = Math.floor(((lng + W / 2 + 180) / 360) * 2 ** z)
    const latRad = ((lat + H / 2) * Math.PI) / 180
    const ty = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z)
    const tile = await u.get(`${base}/yield-maps/rasters/${raster.id}/tiles/${z}/${tx}/${ty}.png`).expect(200)
    expect(tile.headers['content-type']).toBe('image/png')
    const empty = await u.get(`${base}/yield-maps/rasters/${raster.id}/tiles/${z}/${tx + 50}/${ty}.png`).expect(200)
    expect(tile.body.length).toBeGreaterThan(empty.body.length)

    // Zone yields: a productivity zoning of the field (normally from the satellite pipeline).
    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    const version = await owner.selectFrom('field_current_geometry').select('id').where('field_id', '=', field.id).executeTakeFirstOrThrow()
    const analysis = await owner
      .insertInto('productivity_analyses')
      .values({ organization_id: org.id, field_id: field.id, geometry_version_id: version.id!, status: 'finished' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const zoning = await owner
      .insertInto('zonings')
      .values({ organization_id: org.id, field_id: field.id, geometry_version_id: version.id!, analysis_id: analysis.id, source: 'productivity', zone_count: 2 })
      .returning('id')
      .executeTakeFirstOrThrow()
    for (const [zoneNo, x0, x1] of [[1, lng, lng + W / 2], [2, lng + W / 2, lng + W]] as const) {
      await owner
        .insertInto('zoning_zones')
        .values({
          organization_id: org.id,
          zoning_id: zoning.id,
          zone_no: zoneNo,
          geometry: sql<string>`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(rect(x0, lat, x1, lat + H))}), 4326))`,
          area_ha: 3.9,
          relative_productivity: zoneNo === 1 ? 95 : 105,
        })
        .execute()
    }
    view = (await u.get(`${base}/yield-maps/crop-cycles/${cycle.id}`).expect(200)).body
    const set = view.zoneYields.find((s: { zoningId: string }) => s.zoningId === zoning.id)
    expect(set.source).toBe('productivity')
    expect(set.zones[0].meanTHa).toBeLessThan(set.zones[1].meanTHa)
    expect(set.zones[0].relativeYield).toBeLessThan(1)
    expect(set.zones[1].relativeYield).toBeGreaterThan(1)
    expect(set.zones[0].pixels).toBeGreaterThan(30)

    // Rebuilding stores the zone yields with the raster as well.
    await u.post(`${base}/yield-maps/crop-cycles/${cycle.id}/rebuild`).expect(202)
    await owner.updateTable('yield_rasters').set({ superseded_at: new Date() }).where('crop_cycle_id', '=', cycle.id).execute()
    await build()
    const stored = await owner.selectFrom('yield_zone_yields').selectAll().where('zoning_id', '=', zoning.id).orderBy('zone_no').execute()
    expect(stored).toHaveLength(2)
    expect(stored[0].mean_t_ha!).toBeLessThan(stored[1].mean_t_ha!)

    // Yield zones from the measured map: three zones, means rising west to east.
    view = (await u.get(`${base}/yield-maps/crop-cycles/${cycle.id}`).expect(200)).body
    const current = view.rasters[0]
    const yz = (await u.post(`${base}/yield-maps/crop-cycles/${cycle.id}/zonings`, { source: 'yield_map', rasterId: current.id, zoneCount: 3 }).expect(201)).body
    expect(yz).toMatchObject({ source: 'yield_map', zoneCount: 3 })
    const means = yz.zones.map((z: { meanYieldTHa: number }) => z.meanYieldTHa)
    expect(means).toEqual([...means].sort((a: number, b: number) => a - b))
    expect(yz.zones.reduce((s: number, z: { areaHa: number }) => s + z.areaHa, 0)).toBeCloseTo(field.areaHa, 0)

    // Season overview and field history.
    const overview = (await u.get(`${base}/yield-maps/overview?seasonId=${season.id}`).expect(200)).body
    expect(overview.rows).toEqual([expect.objectContaining({ cropCycleId: cycle.id, bucket: 'map', documentedFromMap: true })])
    expect(overview.coverage).toMatchObject({ totalFields: 1, withMap: 1 })
    expect(overview.scales[0].cropCycleIds).toEqual([cycle.id])
    const history = (await u.get(`${base}/yield-maps/fields/${field.id}/history`).expect(200)).body
    expect(history[0]).toMatchObject({ harvestYear: 2026, cropCycleId: cycle.id })
    expect(history[0].mapMeanTHa).toBeCloseTo(current.stats.mean, 1)

    // Without satellite imagery of the field the estimate says so instead of failing.
    const estimate = (await u.post(`${base}/yield-maps/crop-cycles/${cycle.id}/estimate`, { meanYieldTHa: 8 }).expect(201)).body
    expect(estimate).toEqual({ ok: false, reason: 'no_scene', scenes: [] })

    // Excluding the only source retires the raster.
    await u.patch(`${base}/yield-maps/sources/${source.id}`, { includedInMerge: false }).expect(200)
    await build()
    view = (await u.get(`${base}/yield-maps/crop-cycles/${cycle.id}`).expect(200)).body
    expect(view.sources[0]).toMatchObject({ includedInMerge: false, excludedReason: 'user' })
    expect(view.rasters).toEqual([])

    // Another organization sees none of it.
    const other = (await http().post('/v1/auth/dev/sign-in').send({ email: `yield-other-${run}@example.test`, displayName: 'Andere' }).expect(201)).body
    const otherAuth = { authorization: `Bearer ${other.accessToken as string}` }
    const otherOrg = (await http().post('/v1/orgs').set(otherAuth).send({ name: `Andere ${run}` }).expect(201)).body
    await http().get(`/v1/orgs/${otherOrg.id}/yield-maps/rasters/${raster.id}/tiles/${z}/${tx}/${ty}.png`).set(otherAuth).expect(404)
    expect((await http().get(`/v1/orgs/${otherOrg.id}/yield-maps/sources`).set(otherAuth).expect(200)).body).toEqual([])

    await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
    await owner.destroy()
    await jobsDb.destroy()
  })

  it('leaves a documented harvest alone and records why', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `yield2-${run}@example.test`, displayName: 'Ertrag' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const org = (await post('/orgs', { name: `Ertrag2 ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'Breite', geometry: rect(lng, lat, lng + W, lat + H) }).expect(201)).body
    const season = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await http().get(`/v1${base}/crops`).set(auth).expect(200)).body as { id: string; code: string }[]
    const cycle = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)).body[0]
    await post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: '2026-07-28', quantityT: 60 }).expect(201)

    const upload = await http().post(`/v1${base}/yield-maps/upload`).set(auth).field('names', JSON.stringify(['Ernte.zip'])).attach('files', taskData(), 'upload.bin').expect(201)
    await post(`${base}/yield-maps/sources`, { fileId: upload.body[0].fileId, cropCycleIds: [cycle.id], machineLabel: 'Lexion 8800' }).expect(201)

    const jobsDb = createKysely(config.jobsDatabaseUrl, 2)
    await yieldJobHandlers(jobsDb, createStorageDriver())[YIELD_BUILD]({ payload: { cropCycleId: cycle.id } } as unknown as Job)
    await jobsDb.destroy()

    const view = (await http().get(`/v1${base}/yield-maps/crop-cycles/${cycle.id}`).set(auth).expect(200)).body
    expect(view.sources[0].machineLabel).toBe('Lexion 8800')
    expect(view.rasters[0].writeback).toMatchObject({ status: 'skipped', reason: 'already-documented' })
    // The weighbridge total calibrates the map when the factor is plausible (0.7–1.4).
    const harvests = (await http().get(`/v1${base}/harvests?cropCycleId=${cycle.id}`).set(auth).expect(200)).body
    expect(harvests).toEqual([expect.objectContaining({ quantityT: 60 })])
    expect(view.documented).toMatchObject({ quantityT: 60, fromMap: false })

    const owner = createKysely(process.env.DATABASE_URL_MIGRATE ?? 'postgres://agmeo_owner:agmeo_owner@localhost:5434/agmeo', 1)
    await owner.updateTable('fields').set({ status: 'archived' }).where('id', '=', field.id).execute()
    await owner.destroy()
  })
})
