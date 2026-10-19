/**
 * The plant-protection record (EU 2023/564) end to end: readiness from the operations, the
 * farm's certificates, the CSV and JSON record archived in Files, and the record history.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'

const run = Math.random().toString(36).slice(2, 8)
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})

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

describe('plant-protection record', () => {
  it('checks readiness, keeps the certificates and generates the archived record', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `psm-${run}@example.test`, displayName: 'PSM' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object = {}) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)

    const org = (await post('/orgs', { name: `PSM ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const kamp = (await post(`${base}/fields`, { farmId: farm.id, name: 'Kamp', identifier: 'DENILI0123456789', geometry: rect(9.96, 52.31, 9.964, 52.312) }).expect(201)).body
    const wiese = (await post(`${base}/fields`, { farmId: farm.id, name: 'Wiese', geometry: rect(9.97, 52.31, 9.974, 52.312) }).expect(201)).body
    const season = (await post(`${base}/seasons`, { harvestYear: 2026, startDate: '2025-08-01', endDate: '2026-07-31' }).expect(201)).body[0]
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [kamp.id, wiese.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)
    const worker = (await post(`${base}/employees`, { name: 'Lena Berg' }).expect(201)).body
    const fungicide = (await post(`${base}/products`, { category: 'crop_protection', name: 'Prosaro', baseUnit: 'l', registrationNumber: '025662-00' }).expect(201)).body
    await post(`${base}/stock/movements`, { productId: fungicide.id, kind: 'receipt', quantityDelta: 100 }).expect(201)

    const operation = async (body: object, performedAt?: string) => {
      const op = (await post(`${base}/operations`, { farmId: farm.id, type: 'crop_protection', ...body }).expect(201)).body
      if (performedAt) await post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt }).expect(200)
      return op
    }
    // A complete pass over two fields: two applications of one operation.
    const spray = await operation(
      {
        title: 'Fungizid T1',
        plannedOn: '2026-05-10',
        responsibleEmployeeId: worker.id,
        bbchStage: '32',
        targetOrganism: 'Septoria tritici',
        details: { usageType: 'open_field' },
        fields: [{ fieldId: kamp.id }, { fieldId: wiese.id }],
        inputs: [{ productId: fungicide.id, ratePerHa: 0.8 }],
      },
      '2026-05-10T06:30:00Z',
    )
    // A pass without a product, stage, applicator or usage type.
    const bare = await operation({ title: 'Überfahrt', plannedOn: '2026-06-02', fields: [{ fieldId: kamp.id }] }, '2026-06-02T08:00:00Z')
    // A plan whose day passed more than 30 days ago: overdue for conversion into a record.
    const plan = await operation({ title: 'Herbizid', plannedOn: '2026-01-05', fields: [{ fieldId: kamp.id }], inputs: [{ productId: fungicide.id, ratePerHa: 1 }] })

    let readiness = (await get(`${base}/protection/record/readiness?year=2026`).expect(200)).body
    expect(readiness).toMatchObject({ year: 2026, applications: 3, incomplete: 1, planned: 1, ready: false })
    const codes = (r: { items: { code: string }[] }) => r.items.map((i) => i.code)
    expect(codes(readiness)).toEqual(expect.arrayContaining(['field_product', 'field_kennr', 'field_dose', 'field_applicator', 'field_usageType', 'field_growthStage', 'sachkunde_missing', 'sprayer_missing', 'conversion_overdue', 'planned', 'without_flik']))
    const gap = readiness.items.find((i: { code: string }) => i.code === 'field_product')
    expect(gap).toMatchObject({ severity: 'blocking', fix: 'protection', count: 1, affected: [{ operationId: bare.id, fieldName: 'Kamp', date: '2026-06-02' }] })
    expect(readiness.items.find((i: { code: string }) => i.code === 'conversion_overdue').affected[0].operationId).toBe(plan.id)
    // Wiese has no FLIK; the record carries its geometry instead.
    expect(readiness.items.find((i: { code: string }) => i.code === 'without_flik')).toMatchObject({ severity: 'info', fix: 'fieldsManager', count: 1, affected: [{ operationId: spray.id, fieldName: 'Wiese' }] })
    const targets = (await get(`${base}/protection/record/issues/field_product?year=2026`).expect(200)).body
    expect(targets.passes.map((p: { operationId: string }) => p.operationId)).toEqual([bare.id])
    expect((await get(`${base}/protection/record/issues/field_unknown?year=2026`).expect(200)).body).toEqual({ passes: [] })

    // The farm's certificates.
    expect((await get(`${base}/protection/attestations`).expect(200)).body).toMatchObject({ certificateNumber: null, updatedAt: null })
    await put(`${base}/protection/attestations`, { certificateValidUntil: '31.12.2029' }).expect(400)
    const saved = (await put(`${base}/protection/attestations`, {
      certificateNumber: 'NI-12345',
      certificateHolder: 'Lena Berg',
      certificateValidUntil: '2029-06-30',
      sprayerInspectionNumber: 'PR-9988',
      sprayerInspectedOn: '2025-04-15',
    }).expect(200)).body
    expect(saved).toMatchObject({ certificateNumber: 'NI-12345', sprayerInspectedOn: '2025-04-15', updatedAt: expect.any(String) })
    readiness = (await get(`${base}/protection/record/readiness?year=2026`).expect(200)).body
    expect(codes(readiness)).not.toContain('sachkunde_missing')
    expect(codes(readiness)).not.toContain('sprayer_missing')

    // Gaps block the file unless it is asked for as it stands; a year without applications has none.
    expect((await post(`${base}/protection/record`, { year: 2026, format: 'csv' }).expect(400)).body.code).toBe('record_incomplete')
    expect((await post(`${base}/protection/record`, { year: 2025, format: 'csv', includeIncomplete: true }).expect(400)).body.code).toBe('no_applications')

    const csv = (await post(`${base}/protection/record`, { year: 2026, format: 'csv', includeIncomplete: true }).expect(200)).body
    expect(csv).toMatchObject({ filename: 'Pflanzenschutz_2026.csv', mimeType: 'text/csv', archived: true })
    const lines = (csv.body as string).split('\r\n')
    expect(lines[0].charCodeAt(0)).toBe(0xfeff)
    expect(lines).toContain('# Sachkundenachweis: NI-12345 (Lena Berg), gültig bis 2029-06-30')
    expect(lines).toContain('# Spritzenprüfung: PR-9988, geprüft 2025-04-15')
    const rows = lines.filter((l) => l.startsWith(`${spray.id};`))
    expect(rows).toHaveLength(2)
    const kampRow = rows.find((r) => r.includes(';Kamp;'))!.split(';')
    expect(kampRow.slice(1, 6)).toEqual(['2026-05-10', '08:30', 'Freiland', 'Kamp', 'DENILI0123456789'])
    expect(kampRow.slice(9, 13)).toEqual(['32', 'Prosaro', '025662-00', 'Septoria tritici'])
    expect(kampRow.slice(14, 16)).toEqual(['0,8', 'l/ha'])
    expect(kampRow.at(-2)).toBe('Lena Berg')
    expect(kampRow.at(-1)).toBe('')
    const bareRow = lines.find((l) => l.startsWith(`${bare.id};`))!
    expect(bareRow).toContain('Mittelname, BVL-Zulassungsnummer, Aufwandmenge')
    expect(lines.some((l) => l.startsWith(`${plan.id};`))).toBe(false)

    const json = (await post(`${base}/protection/record`, { year: 2026, format: 'json', includeIncomplete: true }).expect(200)).body
    const document = JSON.parse(json.body as string)
    expect(document).toMatchObject({ schema: 'agmeo.protection.eu-2023-564', schemaVersion: 2, year: 2026, farm: { sachkunde: { number: 'NI-12345' } } })
    expect(document.applications).toHaveLength(3)
    const wieseApp = document.applications.find((a: { field: { name: string } }) => a.field.name === 'Wiese')
    expect(wieseApp).toMatchObject({ operationId: spray.id, usageType: 'FREILAND', field: { flik: null, hasGeometry: true }, crop: { eppoCode: 'TRZAW' }, missingFields: [] })
    expect(wieseApp.products[0]).toMatchObject({ articleId: 'Prosaro', kennr: '025662-00', dose: 0.8, doseUnit: 'l/ha', absoluteAmountUnit: 'l' })

    // Both files are archived in Files > Exports and listed newest first.
    const history = (await get(`${base}/protection/record/history?year=2026`).expect(200)).body
    expect(history.map((h: { name: string }) => h.name)).toEqual(['Pflanzenschutz_2026.json', 'Pflanzenschutz_2026.csv'])
    expect(history[1].id).toBe(csv.fileId)
    expect(history[1].sizeBytes).toBe(Buffer.byteLength(csv.body as string, 'utf8'))
    expect((await get(`${base}/protection/record/history?year=2025`).expect(200)).body).toEqual([])
    const stored = await get(`${base}/files/${json.fileId}/content`).buffer(true).parse(binary).expect(200)
    expect(JSON.parse((stored.body as Buffer).toString('utf8'))).toEqual(document)
  })
})
