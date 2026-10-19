/**
 * Lab result upload: parsing, matching by probe number (field name breaks ties) and by location,
 * writing the zones, the per-import bookkeeping and the soil samples nutrient planning reads.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { formatNumeric, SAMPLE_CARD_FIELDS, sampleCardRows, tgisShapefile } from '../src/modules/soil/export/tgis.js'
import { zip } from '../src/modules/vra/export/zip.js'

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

type Zone = { id: string; probeNr: number; areaHa: number; values: Record<string, number>; dates: Record<string, string>; lab: { supplyClass?: Record<string, string>; labNr?: string } | null; samplePoint: [number, number] }

describe('soil lab results', () => {
  it('matches lab files to the sampling zones and writes zones and soil samples', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `soillab-${run}@example.test`, displayName: 'Labor' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const upload = (url: string, files: { name: string; data: Buffer }[], extra: Record<string, string> = {}) => {
      let req = http().post(`/v1${url}`).set(auth)
      for (const f of files) req = req.attach('files', f.data, f.name)
      req = req.field('names', JSON.stringify(files.map((f) => f.name)))
      for (const [k, v] of Object.entries(extra)) req = req.field(k, v)
      return req
    }

    const org = (await post('/orgs', { name: `Labor ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const a = (await post(`${base}/fields`, { farmId: farm.id, name: 'Am Bach', geometry: rect(9.96, 52.31, 9.963, 52.312) }).expect(201)).body
    const b = (await post(`${base}/fields`, { farmId: farm.id, name: 'Kirchweg', geometry: rect(9.97, 52.31, 9.973, 52.312) }).expect(201)).body
    await post(`${base}/fields/${a.id}/soil/plan`, { mode: 'voronoi', points: [[9.961, 52.311], [9.962, 52.311]] }).expect(201)
    await post(`${base}/fields/${b.id}/soil/plan`, { mode: 'voronoi', points: [[9.971, 52.311], [9.972, 52.311]] }).expect(201)
    // Both fields carry probe numbers 1 and 2: the file's field name decides.
    await post(`${base}/soil/probe-numbers`, { fieldIds: [a.id], start: 1 }).expect(200)
    await post(`${base}/soil/probe-numbers`, { fieldIds: [b.id], start: 1 }).expect(200)

    const csv = [
      'Gpsnr;Schlag;PNDatum;pH;P;K;Mg;Orgs;PStufe;Labornr',
      '1;Am Bach;06.03.2026;6,4;5,2;10;5;2,1;C;L-1',
      '2;Am Bach;06.03.2026;5,8;3;8;4;1,9;B;L-2',
      '2;;06.03.2026;6,0;4;9;5;2;C;L-9',
      '99;Am Bach;06.03.2026;6,0;4;9;5;2;C;L-99',
    ].join('\r\n')
    const files = [{ name: 'LUFA Ergebnisse.csv', data: Buffer.from(csv, 'latin1') }, { name: 'falsch.csv', data: Buffer.from('Name;Wert\nA;1') }]

    const preview = (await upload(`${base}/soil/lab-results/preview`, files).expect(200)).body
    expect(preview).toMatchObject({ fileNames: ['LUFA Ergebnisse.csv'], rejectedFiles: [{ fileName: 'falsch.csv', reason: 'unsupported-format' }], rowCount: 4 })
    expect(preview.fields).toHaveLength(1)
    expect(preview.fields[0]).toMatchObject({ fieldId: a.id, alreadyImported: false })
    expect(preview.fields[0].probes.map((p: { probeNr: number }) => p.probeNr)).toEqual([1, 2])
    // Probe 2 without a field name is ambiguous, 99 does not exist.
    expect(preview.unmatched.map((r: { probeNr: number }) => r.probeNr).sort()).toEqual([2, 99])

    const applied = (await upload(`${base}/soil/lab-results`, files).expect(201)).body
    expect(applied.results).toEqual([expect.objectContaining({ fieldId: a.id, status: 'success', probeCount: 2 })])
    expect(applied.fileIds).toHaveLength(1)

    const zones = (await get(`${base}/fields/${a.id}/soil`).expect(200)).body.zonation.zones as Zone[]
    expect(zones[0]).toMatchObject({ probeNr: 1, values: { ph: 6.4, p2o5: 11.91, k2o: 12.05, humus: 2.1 }, dates: { ph: '2026-03-06' }, lab: { supplyClass: { p2o5: 'C' }, labNr: 'L-1' } })

    // The field gets a soil sample: area-weighted means of its zones, for nutrient planning.
    const samples = (await get(`${base}/soil-samples?fieldId=${a.id}`).expect(200)).body
    expect(samples).toHaveLength(1)
    const expectedPh = (6.4 * zones[0].areaHa + 5.8 * zones[1].areaHa) / (zones[0].areaHa + zones[1].areaHa)
    expect(samples[0]).toMatchObject({ kind: 'basic', sampledOn: '2026-03-06', labImportId: applied.importId, sampleNumber: '1–2', phMethod: 'cacl2', pMethod: 'cal' })
    expect(samples[0].ph).toBeCloseTo(expectedPh, 1)
    expect(samples[0].classes.p).toBeTruthy()
    const overview = (await get(`${base}/soil`).expect(200)).body
    expect(overview.find((f: { fieldId: string }) => f.fieldId === a.id).latestBasic.id).toBe(samples[0].id)

    // The same file again is recognised as imported.
    const again = (await upload(`${base}/soil/lab-results/preview`, files.slice(0, 1)).expect(200)).body
    expect(again.fields[0].alreadyImported).toBe(true)

    // A later pH for probe 1 replaces the earlier import's pH; the earlier import keeps its other values.
    const later = Buffer.from('Gpsnr;Schlag;PNDatum;pH\n1;Am Bach;01.04.2026;6,9', 'utf8')
    const second = (await upload(`${base}/soil/lab-results`, [{ name: 'Nachmessung.csv', data: later }]).expect(201)).body
    const zone1 = ((await get(`${base}/fields/${a.id}/soil`).expect(200)).body.zonation.zones as Zone[])[0]
    expect(zone1.values).toMatchObject({ ph: 6.9, p2o5: 11.91 })
    expect(zone1.dates).toMatchObject({ ph: '2026-04-01', p2o5: '2026-03-06' })
    const imports = (await get(`${base}/soil/lab-imports`).expect(200)).body
    expect(imports.map((i: { id: string }) => i.id)).toEqual([second.importId, applied.importId])
    expect(imports[1]).toMatchObject({ fileNames: ['LUFA Ergebnisse.csv'], zoneCount: 2, fields: [{ id: a.id, name: 'Am Bach' }] })
    expect(imports[1].files[0].name).toBe('LUFA Ergebnisse.csv')

    // The lab's Probenkarte without probe numbers is matched by location.
    const zonesB = (await get(`${base}/fields/${b.id}/soil`).expect(200)).body.zonation.zones as Zone[]
    const [x, y] = zonesB[1].samplePoint
    const d = 0.0002
    const geometry = { type: 'MultiPolygon' as const, coordinates: [[[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]]] }
    const rows = sampleCardRows([{ fieldId: 'x', fieldName: 'Kirchweg', parcel: null, areaHa: 1, bodenart: null, geometry, zones: [{ zoneId: 'z', areaHa: 1, probeNr: 0, geometry }] }], '', '10.03.2026')
    Object.assign(rows[0].record, { PROBENUMME: '', K_WERT: formatNumeric(12, 10, 8) })
    const card = zip(tgisShapefile(rows, SAMPLE_CARD_FIELDS, 'X_PROBEKARTE'))
    const byLocation = (await upload(`${base}/soil/lab-results/preview`, [{ name: 'Lieferung.zip', data: card }]).expect(200)).body
    expect(byLocation.fields[0]).toMatchObject({ fieldId: b.id, probes: [{ zoneId: zonesB[1].id, match: 'location' }] })

    await upload(`${base}/soil/lab-results`, []).expect(400)
    await upload(`${base}/soil/lab-results`, [{ name: 'leer.csv', data: Buffer.from('Gpsnr;pH\n500;6') }]).expect(400)
  })
})
