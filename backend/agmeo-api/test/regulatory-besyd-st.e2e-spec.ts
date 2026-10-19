/**
 * webBESyD (BB/SN/ST/TH) and Sachsen-Anhalt Mitteilungspflicht end to end: farm data, region and
 * formats, preflight, ZIP downloads, and the export history in Files.
 */
import type { INestApplication } from '@nestjs/common'
import { inflateRawSync } from 'node:zlib'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

/** Entries of a ZIP archive written by our deflating ZIP writer. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let at = 0
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8)
    const size = buf.readUInt32LE(at + 18)
    const nameLength = buf.readUInt16LE(at + 26)
    const extra = buf.readUInt16LE(at + 28)
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength)
    const data = buf.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size)
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    at += 30 + nameLength + extra + size
  }
  return out
}

const binary = (r: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  // supertest hands the raw response stream to a custom parser.
  const stream = r as unknown as NodeJS.ReadableStream
  const chunks: Buffer[] = []
  stream.on('data', (c: Buffer) => chunks.push(c))
  stream.on('end', () => cb(null, Buffer.concat(chunks)))
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

/** A farm with one field (FLIK of `state`), a wheat crop after rapeseed, two fertilizations and a soil sample. */
async function setup(state: 'BB' | 'ST', flik: string) {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `besyd-${run}-${Math.random()}@example.test`, displayName: 'Besyd' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Besyd ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Gut Havelland' }).expect(201)).body
  // About 4 ha near Nauen (BB) / Oschersleben (ST).
  const [x, y] = state === 'BB' ? [12.88, 52.6] : [11.22, 52.03]
  const field = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Großer Schlag', identifier: flik, geometry: rect(x, y, x + 0.0295, y + 0.0018) }).expect(201)).body
  const s2026 = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
  const s2025 = (await u.post(`${base}/seasons`, { harvestYear: 2025, startDate: '2024-08-01', endDate: '2025-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2025)
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  await u.post(`${base}/crop-cycles`, { seasonId: s2025.id, fieldIds: [field.id], cropId: crop('winter_rapeseed') }).expect(201)
  const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: s2026.id, fieldIds: [field.id], cropId: crop('winter_wheat'), expectedYieldTHa: 8 }).expect(201)).body[0]
  const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS 27', baseUnit: 'kg', nPct: 27, fertilizerType: 'can' }).expect(201)).body
  const slurry = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Rindergülle', baseUnit: 'm3', nPct: 0.4, nh4NPct: 0.2, p2o5Pct: 0.15, densityTM3: 1, fertilizerType: 'cattle_slurry' }).expect(201)).body
  for (const p of [kas, slurry]) await u.post(`${base}/stock/movements`, { productId: p.id, kind: 'receipt', quantityDelta: 100_000 }).expect(201)
  const apply = async (productId: string, rate: number, date: string) => {
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'Düngung', plannedOn: date.slice(0, 10), fields: [{ fieldId: field.id }], inputs: [{ productId, ratePerHa: rate }], details: { applicationTechnique: 'trailing_shoe' } }).expect(201)).body
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: date }).expect(200)
  }
  await apply(kas.id, 200, '2026-03-10T09:00:00+01:00')
  await apply(slurry.id, 25, '2026-03-20T09:00:00+01:00')
  await u.post(`${base}/soil-samples`, { fieldId: field.id, kind: 'basic', sampledOn: '2024-09-12', ph: 6.4, p2o5Mg100g: 12, k2oMg100g: 15, mgoMg100g: 8, humusPct: 2.2, soilTexture: 'uL' }).expect(201)
  return { u, base, farm, field, wheat }
}

const blocking = (pre: { issues: { severity: string; code: string }[] }) => pre.issues.filter((i) => i.severity === 'blocking').map((i) => i.code)

describe('webBESyD and Sachsen-Anhalt exports', () => {
  it('exports the eleven BESyD tables for a Brandenburg farm and archives the ZIP', async () => {
    const { u, base, farm } = await setup('BB', 'DEBBLI0512345678')

    // The FLIKs place the farm in Brandenburg, which files webBESyD only.
    const region = (await u.get(`${base}/regulatory/region?farmId=${farm.id}&year=2026`).expect(200)).body
    expect(region).toMatchObject({ federalState: 'BB', source: 'flik', flikCoverage: 1 })
    expect(region.formats).toEqual([{ format: 'besyd', deadline: null, upload: { fileType: 'zip', portalUrl: 'https://www.landwirtschaft.sachsen.de/webbesyd/bb' } }])

    // Without the 12-digit Betriebsnummer the export is blocked.
    let pre = (await u.get(`${base}/regulatory/preflight?format=besyd&farmId=${farm.id}&year=2026`).expect(200)).body
    expect(blocking(pre)).toContain('missing.betriebsnummer')
    expect((await u.get(`${base}/exports/besyd.zip?farmId=${farm.id}&year=2026`).expect(400)).body.code).toBe('export_blocked')

    // A Boden-Klima-Raum of another Land is refused.
    await u.put(`${base}/farms/${farm.id}/regulatory`, { euHoldingNumber: '120000000042', besyd: { bodenklimaraum: '999' } }).expect(400)
    const saved = (await u.put(`${base}/farms/${farm.id}/regulatory`, {
      euHoldingNumber: '120000000042', federalState: 'BB',
      besyd: { berechnungsgrundlage: 'DV', bodenklimaraum: '101' },
      contact: { firma: 'Gut Havelland', strasse: 'Dorfstraße 1', plz: '14641', ort: 'Nauen', email: 'hof@example.test' },
    }).expect(200)).body
    expect(saved).toMatchObject({ euHoldingNumber: '120000000042', besyd: { berechnungsgrundlage: 'DV', bodenklimaraum: '101' } })
    // The ENNI/ENDO form leaves BESyD data alone.
    const kept = (await u.put(`${base}/farms/${farm.id}/regulatory`, { federalState: 'BB', contact: saved.contact }).expect(200)).body
    expect(kept).toMatchObject({ euHoldingNumber: '120000000042', besyd: { bodenklimaraum: '101' } })

    pre = (await u.get(`${base}/regulatory/preflight?format=besyd&farmId=${farm.id}&year=2026`).expect(200)).body
    expect(blocking(pre)).toEqual([])
    expect(pre).toMatchObject({ format: 'besyd', ready: true, fileName: 'BESyD_120000000042_2026.zip' })

    const res = await u.get(`${base}/exports/besyd.zip?farmId=${farm.id}&year=2026`).buffer(true).parse(binary).expect(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toContain('BESyD_120000000042_2026.zip')
    const files = unzip(res.body as Buffer)
    expect(Object.keys(files).sort()).toEqual([
      'IMPANBAU.TXT', 'IMPBETR.TXT', 'IMPERNTE.TXT', 'IMPMAKRO.TXT', 'IMPMIND.TXT', 'IMPNLEGUM.TXT',
      'IMPNLEGUMBETRIEB.TXT', 'IMPNMIN.TXT', 'IMPORG.TXT', 'IMPWEIDE.TXT', 'IMPWEIDEBETRIEB.TXT',
    ])
    expect(files['IMPBETR.TXT']).toBe('„120000000042„;„Gut Havelland„;„14641„;„Nauen„;„Dorfstraße 1„;„99„;„DV„;„101„;„hof@example.test„')
    const anbau = files['IMPANBAU.TXT'].split(';')
    expect(anbau.slice(0, 7)).toEqual(['„120000000042„', '„001„', '„001„', '2026', '„Großer Schlag„', expect.stringMatching(/^\d+\.\d{2}$/), '„DEBBLI0512345678„'])
    // Vorfrucht Winterraps, Frucht Winterweizen A/B.
    expect(anbau[17]).toBe('„0501„')
    expect(anbau[22]).toBe('„0102„')
    expect(files['IMPMIND.TXT']).toContain('„KAS 27„')
    expect(files['IMPORG.TXT']).toContain('„Rindergülle„')
    expect(files['IMPMAKRO.TXT']).toContain('6.4')

    // Archived in Files and listed in the export history.
    const history = (await u.get(`${base}/regulatory/exports/history?year=2026`).expect(200)).body
    expect(history).toEqual([expect.objectContaining({ name: 'BESyD_120000000042_2026.zip', format: 'besyd', sizeBytes: (res.body as Buffer).length })])
    const folders = (await u.get(`${base}/files/folders`).expect(200)).body as { id: string; systemKey: string | null }[]
    const exportsFolder = folders.find((f) => f.systemKey === 'exports')!
    const listing = (await u.get(`${base}/files?folderId=${exportsFolder.id}`).expect(200)).body
    expect(listing.files.map((f: { name: string }) => f.name)).toContain('BESyD_120000000042_2026.zip')
    const stored = await u.get(`${base}/files/${history[0].id}/content`).buffer(true).parse(binary).expect(200)
    expect(Buffer.compare(stored.body as Buffer, res.body as Buffer)).toBe(0)
    expect((await u.get(`${base}/regulatory/exports/history?year=2025`).expect(200)).body).toEqual([])

    const lists = (await u.get(`${base}/regulatory/code-lists?format=besyd&state=BB`).expect(200)).body
    expect(lists.bodenklimaraum.every((b: { states: string[] }) => b.states.includes('BB'))).toBe(true)
    expect(lists.crops.find((c: { code: string }) => c.code === '0102')).toBeTruthy()
    // ENNI and ENDO-SH: their own Fruchtart catalogues for the crop code overrides.
    const enni = (await u.get(`${base}/regulatory/code-lists?format=enni`).expect(200)).body
    expect(enni.crops.find((c: { code: string }) => c.code === 'WGetreide001')).toBeTruthy()
    const endo = (await u.get(`${base}/regulatory/code-lists?format=endo`).expect(200)).body
    expect(endo.crops.length).toBeGreaterThan(0)
    expect(endo.bodenklimaraum).toEqual([])
    await u.get(`${base}/regulatory/code-lists?format=agrarantrag`).expect(400)
  })

  it('exports the Sachsen-Anhalt Mitteilung with DBE from the saved fertilizer need', async () => {
    const { u, base, farm, field, wheat } = await setup('ST', 'DESTLI0512345678')
    const region = (await u.get(`${base}/regulatory/region?farmId=${farm.id}&year=2026`).expect(200)).body
    expect(region.federalState).toBe('ST')
    expect(region.formats.map((f: { format: string }) => f.format)).toEqual(['st', 'besyd'])
    expect(region.formats[0].deadline).toBe('2027-04-30T21:59:59.000Z')

    await u.patch(`${base}/fields/${field.id}`, { parcelNumber: '12' }).expect(200)
    await u.post(`${base}/crop-cycles/${wheat.id}/fertilizer-need`, {}).expect(201)
    await u.put(`${base}/farms/${farm.id}/regulatory`, {
      euHoldingNumber: '151111111111', federalState: 'ST', st: { kreisNr: 83, sitzOrtsteil: 'Hornhausen' },
      contact: { firma: 'Agrar GmbH Börde', plz: '39387', ort: 'Oschersleben' },
    }).expect(200)
    const pre = (await u.get(`${base}/regulatory/preflight?format=st&farmId=${farm.id}&year=2026`).expect(200)).body
    expect(blocking(pre)).toEqual([])
    expect(pre.issues.map((i: { code: string }) => i.code)).not.toContain('st_dbe_missing')

    const res = await u.get(`${base}/exports/st.zip?farmId=${farm.id}&year=2026`).buffer(true).parse(binary).expect(200)
    const files = unzip(res.body as Buffer)
    expect(Object.keys(files).sort()).toEqual(['Anl5_083_151111111111_2026.TXT', 'DBE_083_151111111111_2026.TXT', 'Duengungen_083_151111111111_2026.TXT', 'Ertraege_083_151111111111_2026.TXT'])
    const dbe = files['DBE_083_151111111111_2026.TXT']
    expect(dbe).toContain('Agrar GmbH Börde\t151111111111\t39387\tOschersleben\tHornhausen\t83\tBörde')
    expect(dbe).toContain('DESTLI0512345678\t12')
    expect(files['Duengungen_083_151111111111_2026.TXT'].split('\r\n')).toHaveLength(2)

    const history = (await u.get(`${base}/regulatory/exports/history?year=2026`).expect(200)).body
    expect(history.map((h: { name: string }) => h.name)).toEqual(['ST_151111111111_2026.zip'])
  })
})
