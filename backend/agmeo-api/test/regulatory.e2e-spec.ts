/**
 * Regulatory reporting end to end: farm master data, annual nutrient totals (DüV Anlage 5),
 * the 170 kg N balance, land-use codes and the subsidy application Shapefile.
 */
import type { INestApplication } from '@nestjs/common'
import { inflateRawSync } from 'node:zlib'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { validateEndoXsd, validateEnniXsd } from '../src/modules/regulatory/harmonie/__fixtures__/validateXsd.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

/** Entries of a ZIP archive written by our deflating ZIP writer. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {}
  let at = 0
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8)
    const size = buf.readUInt32LE(at + 18)
    const nameLength = buf.readUInt16LE(at + 26)
    const extra = buf.readUInt16LE(at + 28)
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength)
    const data = buf.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size)
    out[name] = method === 8 ? inflateRawSync(data) : data
    at += 30 + nameLength + extra + size
  }
  return out
}

let app: INestApplication<App>
const http = () => request(app.getHttpServer())

export async function regulatorySetup() {
  const res = await http().post('/v1/auth/dev/sign-in').send({ email: `reg-${run}-${Math.random()}@example.test`, displayName: 'Reg' }).expect(201)
  const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
  const u = {
    get: (url: string) => http().get(`/v1${url}`).set(auth),
    post: (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => http().patch(`/v1${url}`).set(auth).send(body),
  }
  const org = (await u.post('/orgs', { name: `Reg ${run}` }).expect(201)).body
  const base = `/orgs/${org.id}`
  const farm = (await u.post(`${base}/farms`, { name: 'Hof Sonnenfeld' }).expect(201)).body
  // Two fields of 4 ha and 2 ha (approx.) near Sehnde.
  const kamp = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', identifier: 'DENILI0123456789', geometry: rect(9.96, 52.31, 9.9895, 52.3118) }).expect(201)).body
  const wiese = (await u.post(`${base}/fields`, { farmId: farm.id, name: 'Wiese', identifier: 'DENILI0123456790', geometry: rect(9.99, 52.31, 10.0047, 52.3118) }).expect(201)).body
  const season = (await u.post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
  const crops = (await u.get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
  const crop = (code: string) => crops.find((c) => c.code === code)!.id
  const wheat = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [kamp.id], cropId: crop('winter_wheat'), expectedYieldTHa: 8 }).expect(201)).body[0]
  const grass = (await u.post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [wiese.id], cropId: crop('grassland'), expectedYieldTHa: 40 }).expect(201)).body[0]
  const kas = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'KAS 27', baseUnit: 'kg', nPct: 27, fertilizerType: 'can' }).expect(201)).body
  const slurry = (await u.post(`${base}/products`, { category: 'fertilizer', name: 'Rindergülle', baseUnit: 'm3', nPct: 0.4, nh4NPct: 0.2, p2o5Pct: 0.15, densityTM3: 1, fertilizerType: 'cattle_slurry' }).expect(201)).body
  for (const p of [kas, slurry]) await u.post(`${base}/stock/movements`, { productId: p.id, kind: 'receipt', quantityDelta: 100_000 }).expect(201)
  const apply = async (fieldId: string, productId: string, rate: number, date: string) => {
    const op = (await u.post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'Düngung', plannedOn: date.slice(0, 10), fields: [{ fieldId }], inputs: [{ productId, ratePerHa: rate }], details: { applicationTechnique: 'trailing_shoe' } }).expect(201)).body
    await u.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt: date }).expect(200)
  }
  await apply(kamp.id, kas.id, 200, '2026-03-10T09:00:00+01:00')
  await apply(kamp.id, slurry.id, 25, '2026-03-20T09:00:00+01:00')
  await apply(wiese.id, slurry.id, 30, '2026-04-02T09:00:00+02:00')
  return { u, base, farm, kamp, wiese, season, wheat, grass, crop }
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

describe('regulatory reporting', () => {
  it('keeps farm master data and computes annual totals and the 170 kg N balance', async () => {
    const { u, base, farm, kamp, wiese } = await regulatorySetup()
    const saved = (await u.put(`${base}/farms/${farm.id}/regulatory`, {
      holdingNumber: '276031234567890', federalState: 'NI', fertilizerYearStart: 'JANUAR',
      enni: { soilClimateArea: 'BKR_45' }, contact: { firma: 'Hof Sonnenfeld', strasse: 'Feldweg 1', plz: '31319', ort: 'Sehnde' },
    }).expect(200)).body
    expect(saved).toMatchObject({ holdingNumber: '276031234567890', federalState: 'NI', enni: { soilClimateArea: 'BKR_45', nitrateZoneFlag: false } })
    await u.put(`${base}/farms/${farm.id}/regulatory`, { holdingNumber: '27603-1234' }).expect(400)

    const totals = (await u.get(`${base}/regulatory/annual-totals?farmId=${farm.id}&year=2026`).expect(200)).body
    expect(totals.window).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    const k = totals.fields.find((f: { fieldId: string }) => f.fieldId === kamp.id)
    expect(k.perHa.mineral).toMatchObject({ n: 54, availableN: 54 })
    // 25 m³ × 0.4 % = 100 kg N, 60 % available; 37.5 kg P2O5.
    expect(k.perHa.manure).toMatchObject({ n: 100, availableN: 60, p2o5: 37.5 })
    expect(k.total.n).toBe(154)
    const w = totals.fields.find((f: { fieldId: string }) => f.fieldId === wiese.id)
    expect(w.grassland).toBe(true)
    expect(w.perHa.manure.n).toBe(120)

    let n170 = (await u.get(`${base}/regulatory/n170?farmId=${farm.id}&year=2026`).expect(200)).body
    const organic = 100 * k.areaHa + 120 * w.areaHa
    expect(n170.appliedOrganicN).toBeCloseTo(organic, 0)
    expect(n170.perHa).toBeCloseTo(organic / (k.areaHa + w.areaHa), 0)
    expect(n170.exceeded).toBe(false)
    // Livestock excretion above what was applied decides the balance.
    n170 = (await u.put(`${base}/regulatory/n170`, { farmId: farm.id, year: 2026, livestock: [{ name: 'Milchkühe', animals: 100, nPerAnimalYear: 120 }], delivery: [{ name: 'Gülle an Biogas', date: '2026-05-01', quantity: 50, nPerUnit: 4 }] }).expect(200)).body
    expect(n170).toMatchObject({ livestockN: 12000, deliveryN: 200 })
    expect(n170.perHa).toBeCloseTo(11800 / (k.areaHa + w.areaHa), 0)
    expect(n170.exceeded).toBe(true)
  })

  it('exports the subsidy application Shapefile with land-use codes', async () => {
    const { u, base, farm, season, grass } = await regulatorySetup()
    const codes = (await u.get(`${base}/land-use-codes`).expect(200)).body
    expect(codes.find((c: { code: string }) => c.code === '115')).toMatchObject({ name: 'Winterweichweizen', productive: true })
    await u.patch(`${base}/crop-cycles/${grass.id}/land-use-code`, { landUseCode: '451' }).expect(200)
    await u.patch(`${base}/crop-cycles/${grass.id}/land-use-code`, { landUseCode: '99999' }).expect(400)

    const res = await u.get(`${base}/exports/agrarantrag.zip?farmId=${farm.id}&seasonId=${season.id}&preset=NI`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    }).expect(200)
    expect(res.headers['content-type']).toBe('application/zip')
    const files = unzip(res.body as Buffer)
    expect(Object.keys(files).map((n) => n.slice(-4)).sort()).toEqual(['.cpg', '.dbf', '.prj', '.shp', '.shx'])
    const file = (ext: string) => Object.entries(files).find(([n]) => n.endsWith(ext))![1]
    expect(file('.prj').toString()).toContain('ETRS89_UTM_zone_32N')
    const dbf = file('.dbf').toString('latin1')
    for (const text of ['NUTZ_CODE', 'SCHLAG_NR', 'Kamp', 'DENILI0123456789', '115', '451', 'Grünland']) expect(dbf).toContain(text)
    // Coordinates are UTM metres: the bounding box starts east of the false easting.
    expect(file('.shp').readDoubleLE(36)).toBeGreaterThan(500_000)
    await u.get(`${base}/exports/agrarantrag.zip?farmId=${farm.id}&seasonId=${season.id}&preset=XX`).expect(400)
    const history = (await u.get(`${base}/regulatory/exports/history?year=2026`).expect(200)).body
    expect(history).toEqual([expect.objectContaining({ format: 'agrarantrag', name: expect.stringMatching(/^agrarantrag-NI-2026-/) })])
  })

  it('exports ENNI and ENDO XML that validates against the authorities\' schemas', async () => {
    const { u, base, farm, kamp, crop } = await regulatorySetup()
    // Without a Betriebsnummer the export is blocked.
    let pre = (await u.get(`${base}/regulatory/preflight?format=enni&farmId=${farm.id}&year=2026`).expect(200)).body
    expect(pre.ready).toBe(false)
    expect((await u.get(`${base}/exports/enni.xml?farmId=${farm.id}&year=2026`).expect(400)).body.code).toBe('export_blocked')

    await u.put(`${base}/farms/${farm.id}/regulatory`, {
      holdingNumber: '276031234567890', federalState: 'NI', enni: { soilClimateArea: 'BKR_45' }, endo: { naturalRegion: 'Geest' },
      contact: { firma: 'Hof Sonnenfeld', vorname: 'Anna', nachname: 'Bauer', strasse: 'Am Kanal 3', plz: '31319', ort: 'Sehnde' },
    }).expect(200)
    await u.post(`${base}/soil-samples`, { fieldId: kamp.id, kind: 'basic', sampledOn: '2024-09-12', ph: 6.4, p2o5Mg100g: 12, k2oMg100g: 15, mgoMg100g: 8, humusPct: 2.2, soilTexture: 'uL' }).expect(201)
    pre = (await u.get(`${base}/regulatory/preflight?format=enni&farmId=${farm.id}&year=2026`).expect(200)).body
    expect(pre.issues.filter((i: { severity: string }) => i.severity === 'blocking')).toEqual([])
    expect(pre.fileName).toMatch(/276031234567890/)

    const enni = await u.get(`${base}/exports/enni.xml?farmId=${farm.id}&year=2026`).expect(200)
    expect(enni.headers['content-disposition']).toContain(pre.fileName)
    const enniXml = enni.text
    expect(enniXml).toContain('Kamp')
    expect(enniXml).toContain('Rindergülle')
    const enniCheck = await validateEnniXsd(enniXml)
    expect(enniCheck.errors).toEqual([])

    const endoPre = (await u.get(`${base}/regulatory/preflight?format=endo&farmId=${farm.id}&year=2026`).expect(200)).body
    // ENDO is Schleswig-Holstein's format and asks for the previous crop of every main crop.
    expect(endoPre.issues.filter((i: { severity: string }) => i.severity === 'blocking').map((i: { code: string }) => i.code).sort()).toEqual(['bundesland_mismatch', 'vorfrucht_missing'])
    await u.put(`${base}/farms/${farm.id}/regulatory`, { holdingNumber: '276011234567890', federalState: 'SH', endo: { naturalRegion: 'Geest' }, contact: { firma: 'Hof Sonnenfeld', strasse: 'Am Kanal 3', plz: '24768', ort: 'Rendsburg' } }).expect(200)
    const s2025 = (await u.post(`${base}/seasons`, { harvestYear: 2025, startDate: '2024-08-01', endDate: '2025-07-31' }).expect(201)).body.find((s: { harvestYear: number }) => s.harvestYear === 2025)
    await u.post(`${base}/crop-cycles`, { seasonId: s2025.id, fieldIds: [kamp.id], cropId: crop('winter_rapeseed') }).expect(201)
    expect((await u.get(`${base}/regulatory/preflight?format=endo&farmId=${farm.id}&year=2026`).expect(200)).body.ready).toBe(true)
    const endo = await u.get(`${base}/exports/endo.xml?farmId=${farm.id}&year=2026`).expect(200)
    const endoCheck = await validateEndoXsd(endo.text)
    expect(endoCheck.errors).toEqual([])
    // Both downloads are archived in Files, newest first.
    const history = (await u.get(`${base}/regulatory/exports/history?year=2026`).expect(200)).body
    expect(history.map((h: { format: string }) => h.format)).toEqual(['endo', 'enni'])
  })
})
