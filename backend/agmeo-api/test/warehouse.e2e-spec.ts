/**
 * Warehouse details, voids, stocktake, prices per year and harvests booked into stock.
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

describe('warehouse', () => {
  it('books receipts with details, voids, stocktakes, prices per year and harvests', async () => {
    const res = await http().post('/v1/auth/dev/sign-in').send({ email: `wh-${run}@example.test`, displayName: 'Lager' }).expect(201)
    const auth = { authorization: `Bearer ${res.body.accessToken as string}` }
    const get = (url: string) => http().get(`/v1${url}`).set(auth)
    const post = (url: string, body: object) => http().post(`/v1${url}`).set(auth).send(body)
    const put = (url: string, body: object) => http().put(`/v1${url}`).set(auth).send(body)
    const del = (url: string) => http().delete(`/v1${url}`).set(auth)

    const org = (await post('/orgs', { name: `Lager ${run}` }).expect(201)).body
    const base = `/orgs/${org.id}`
    const store = (await post(`${base}/storage-locations`, { name: 'Halle 1' }).expect(201)).body
    const kas = (await post(`${base}/products`, { category: 'fertilizer', name: 'KAS', baseUnit: 'kg', unitCost: 0.3, nPct: 27, nEffectivenessPct: 100, website: 'https://example.com/kas' }).expect(201)).body
    expect(kas).toMatchObject({ nEffectivenessPct: 100, website: 'https://example.com/kas', currentPrice: { price: 0.3, source: 'default' } })

    // Two priced receipts this year: the year's warehouse price is their weighted average.
    const year = new Date().getFullYear()
    await post(`${base}/stock/movements`, { productId: kas.id, storageLocationId: store.id, kind: 'receipt', quantityDelta: 1000, totalPrice: 400, vatRate: 19, lotNumber: 'L1', expiryDate: '2030-01-31', counterparty: 'Landhandel', invoiceNumber: 'R-1' }).expect(201)
    let p = (await post(`${base}/stock/movements`, { productId: kas.id, storageLocationId: store.id, kind: 'receipt', quantityDelta: 1000, unitCost: 0.5, expiryDate: '2029-06-30' }).expect(201)).body
    expect(p).toMatchObject({ stock: 2000, currentPrice: { price: 0.45, year, source: 'warehouse' }, stockValue: 900, nextExpiry: '2029-06-30' })

    // An issue (sale) must be negative.
    await post(`${base}/stock/movements`, { productId: kas.id, kind: 'issue', quantityDelta: 100 }).expect(400)
    await post(`${base}/stock/movements`, { productId: kas.id, storageLocationId: store.id, kind: 'issue', quantityDelta: -100, counterparty: 'Nachbar' }).expect(201)

    let movements = (await get(`${base}/stock/movements?productId=${kas.id}`).expect(200)).body
    const second = movements.find((m: { unitCost: number | null; kind: string }) => m.kind === 'receipt' && m.unitCost === 0.5)
    const first = movements.find((m: { lotNumber: string | null }) => m.lotNumber === 'L1')
    expect(first).toMatchObject({ totalPrice: 400, vatRate: 19, unitCost: 0.4, counterparty: 'Landhandel', invoiceNumber: 'R-1' })

    // Voiding the second receipt takes its quantity back out and drops it from the average.
    p = (await post(`${base}/stock/movements/${second.id}/void`, { reason: 'Falsch gebucht' }).expect(201)).body
    expect(p).toMatchObject({ stock: 900, currentPrice: { price: 0.4, source: 'warehouse' }, nextExpiry: '2030-01-31' })
    await post(`${base}/stock/movements/${second.id}/void`, { reason: 'Nochmal' }).expect(400)
    movements = (await get(`${base}/stock/movements?productId=${kas.id}`).expect(200)).body
    expect(movements.find((m: { id: string }) => m.id === second.id).voidedBy).toBeTruthy()
    const voidRow = movements.find((m: { kind: string }) => m.kind === 'void')
    await post(`${base}/stock/movements/${voidRow.id}/void`, { reason: 'Storno vom Storno' }).expect(400)

    // Stocktake books only the difference.
    p = (await post(`${base}/stock/stocktake`, { productId: kas.id, storageLocationId: store.id, counted: 880 }).expect(201)).body
    expect(p.stock).toBe(880)
    p = (await post(`${base}/stock/stocktake`, { productId: kas.id, storageLocationId: store.id, counted: 880 }).expect(201)).body
    expect((await get(`${base}/stock/movements?productId=${kas.id}`).expect(200)).body.filter((m: { kind: string }) => m.kind === 'adjustment')).toHaveLength(1)

    // A manual price wins over the warehouse price and carries over to later years.
    let prices = (await put(`${base}/prices`, { year, prices: [{ productId: kas.id, price: 0.42 }] }).expect(200)).body
    expect(prices.find((r: { productId: string }) => r.productId === kas.id)).toMatchObject({ price: 0.42, source: 'manual', defaultPrice: 0.3 })
    prices = (await get(`${base}/prices?year=${year + 1}`).expect(200)).body
    expect(prices.find((r: { productId: string }) => r.productId === kas.id)).toMatchObject({ price: null, carriedOver: { price: 0.42, year } })
    prices = (await put(`${base}/prices`, { year, prices: [{ productId: kas.id, price: null }] }).expect(200)).body
    expect(prices.find((r: { productId: string }) => r.productId === kas.id)).toMatchObject({ price: 0.4, source: 'warehouse' })

    const params = (await get(`${base}/calculation-parameters`).expect(200)).body
    expect(params.factorSet).toBeTruthy()
    expect(params.parameters.find((x: { id: string }) => x.id === 'ef.diesel')).toMatchObject({ group: 'fuel', value: 3.013 })

    // CSV exports.
    const csv = await get(`${base}/stock/balances.csv`).expect(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain('KAS')
    expect((await get(`${base}/stock/movements.csv?from=2000-01-01`).expect(200)).text).toContain('Landhandel')
    await get(`${base}/stock/movements.csv?from=yesterday`).expect(400)

    // Applications are valued at the year's price.
    const farm = (await post(`${base}/farms`, { name: 'Hof' }).expect(201)).body
    const field = (await post(`${base}/fields`, { farmId: farm.id, name: 'A', geometry: rect(9.96, 52.31, 9.962, 52.312) }).expect(201)).body
    const op = (await post(`${base}/operations`, { farmId: farm.id, type: 'fertilization', title: 'KAS', fields: [{ fieldId: field.id }], inputs: [{ productId: kas.id, ratePerHa: 100 }] }).expect(201)).body
    expect(op.inputs[0].unitCost).toBe(0.4)

    // A harvest booked into stock, and taken out again when deleted.
    const wheatGoods = (await post(`${base}/products`, { category: 'harvest', name: 'Weizen', baseUnit: 't' }).expect(201)).body
    const seasons = (await post(`${base}/seasons`, { harvestYear: year, startDate: `${year - 1}-08-01`, endDate: `${year}-07-31` }).expect((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)) })).body
    const season = seasons.find((s: { harvestYear: number }) => s.harvestYear === year)
    const crops = (await get(`${base}/crops`).expect(200)).body as { id: string; code: string }[]
    const [cycle] = (await post(`${base}/crop-cycles`, { seasonId: season.id, fieldIds: [field.id], cropId: crops.find((c) => c.code === 'winter_wheat')!.id }).expect(201)).body
    await post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: `${year}-07-20`, quantityT: 30, productId: kas.id }).expect(400)
    const harvest = (await post(`${base}/harvests`, { cropCycleId: cycle.id, harvestDate: `${year}-07-20`, quantityT: 30, productId: wheatGoods.id, storageLocationId: store.id }).expect(201)).body
    expect(harvest.productId).toBe(wheatGoods.id)
    const goods = () => get(`${base}/products?category=harvest`).expect(200).then((r) => r.body.find((x: { id: string }) => x.id === wheatGoods.id))
    expect((await goods()).stock).toBe(30)
    const harvestReceipt = (await get(`${base}/stock/movements?productId=${wheatGoods.id}`).expect(200)).body[0]
    await post(`${base}/stock/movements/${harvestReceipt.id}/void`, { reason: 'Nicht erlaubt' }).expect(400)
    await del(`${base}/harvests/${harvest.id}`).expect((r) => expect([200, 204]).toContain(r.status))
    expect((await goods()).stock).toBe(0)
  })
})
