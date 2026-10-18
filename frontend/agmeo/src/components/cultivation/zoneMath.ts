import {
  availableN,
  isOrganicFertilizer,
  roundRate,
  zoneRates,
  type BaseUnit,
  type Operation,
  type OperationInputLine,
  type OperationType,
  type Product,
  type ProductCategory,
  type ProductivityZone,
  type VraInputType,
  type VraMapSummary,
  type VraRateUnit,
} from '@agmeo/contracts'

/** Sub-tabs of the zone-specific optimization, in the order of the original agmeo category bar. */
export const OPT_CATEGORIES = ['total', 'tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'other'] as const
export type OptCategory = (typeof OPT_CATEGORIES)[number]

export const categoryOf = (type: OperationType): Exclude<OptCategory, 'total'> => (type === 'inspection' ? 'other' : type)

/** How the last column sums up a line: per hectare or for the field, as quantity or money. */
export const EVALUATIONS = ['avgQtyPerHa', 'totalQty', 'avgCostPerHa', 'totalCost'] as const
export type Evaluation = (typeof EVALUATIONS)[number]

/** Input type of a product line on a variable-rate map; null when the line cannot go on one. */
export function vraInputType(opType: OperationType, category: ProductCategory): VraInputType | null {
  if (category === 'seed' || (opType === 'sowing' && category !== 'fertilizer')) return 'sowing'
  if (category === 'fertilizer' || opType === 'fertilization') return 'fertilizing'
  if (category === 'crop_protection' || opType === 'crop_protection') return 'spraying'
  return null
}

/** Map unit for a product's base unit, and the factor from base unit per ha to it. */
export function vraUnit(baseUnit: BaseUnit, inputType: VraInputType): { unit: VraRateUnit; factor: number } | null {
  switch (baseUnit) {
    case 'kg':
      return { unit: 'kg/ha', factor: 1 }
    case 't':
      return { unit: 'kg/ha', factor: 1000 }
    case 'l':
      return inputType === 'sowing' ? null : { unit: 'l/ha', factor: 1 }
    case 'm3':
      return inputType === 'sowing' ? null : { unit: 'l/ha', factor: 1000 }
    case 'unit':
      return inputType === 'sowing' ? { unit: 'seeds/ha', factor: 1 } : null
  }
}

export type ZoneRates = Record<string, number>

/** One product line of an operation on this crop, with its zone rates in the product's base unit per ha. */
export interface ZoneLine {
  key: string
  op: Operation
  line: OperationInputLine
  /** The operation's uniform rate. */
  flatRate: number
  /** Saved zone rates; null when the line is applied uniformly. */
  savedRates: ZoneRates | null
  unitCost: number | null
  inputType: VraInputType | null
  vra: { unit: VraRateUnit; factor: number } | null
  /** Rates can be changed: the operation is not done and the line fits a map. */
  editable: boolean
}

export const lineKey = (opId: string, lineId: string) => `${opId}:${lineId}`

/**
 * The product lines of the crop's operations with the zone rates of their maps. A map input is
 * matched to a line by product and position; maps on another zoning are not read.
 */
export function zoneLines(ops: Operation[], maps: VraMapSummary[], products: Product[], zoningId: string | null): ZoneLine[] {
  const productById = new Map(products.map((p) => [p.id, p]))
  const mapByOp = new Map(maps.filter((m) => m.operationId).map((m) => [m.operationId!, m]))
  return ops.flatMap((op) =>
    op.inputs.map((line): ZoneLine => {
      const inputType = vraInputType(op.type, line.category)
      const vra = inputType ? vraUnit(line.baseUnit, inputType) : null
      const map = mapByOp.get(op.id)
      const input = map && map.zoningId === zoningId ? map.inputs.find((i) => i.productId === line.productId) : undefined
      const savedRates = input && vra ? Object.fromEntries(Object.entries(input.rates).map(([z, r]) => [z, r / vra.factor])) : null
      return {
        key: lineKey(op.id, line.id),
        op,
        line,
        flatRate: line.ratePerHa ?? 0,
        savedRates,
        unitCost: line.unitCost ?? productById.get(line.productId)?.unitCost ?? null,
        inputType,
        vra,
        editable: (op.status === 'planned' || op.status === 'in_progress') && !!vra && !!zoningId,
      }
    }),
  )
}

/** Rate of a line in a zone: the edited or saved zone rate, else the uniform rate. */
export const rateIn = (rates: ZoneRates | null, flatRate: number, zoneNo: number) => rates?.[String(zoneNo)] ?? flatRate

/** Area-weighted mean of zone rates. */
export function meanRate(rates: ZoneRates | null, flatRate: number, zones: ProductivityZone[]) {
  const area = zones.reduce((s, z) => s + z.areaHa, 0)
  return area > 0 ? zones.reduce((s, z) => s + rateIn(rates, flatRate, z.zoneNo) * z.areaHa, 0) / area : flatRate
}

/** Zone rates that follow productivity and give the field the same amount as the uniform rate. */
export function distribute(flatRate: number, zones: ProductivityZone[], unit: VraRateUnit | null): ZoneRates {
  const round = (v: number) => (unit ? roundRate(v, unit) : Math.round(v * 100) / 100)
  return zoneRates(zones, flatRate, { direction: 1, round }).rates
}

/** Value of a line in a zone (or for the field, with `areaHa` the field area) for an evaluation. */
export function evaluate(evaluation: Evaluation, ratePerHa: number, unitCost: number | null, areaHa: number): number | null {
  switch (evaluation) {
    case 'avgQtyPerHa':
      return ratePerHa
    case 'totalQty':
      return ratePerHa * areaHa
    case 'avgCostPerHa':
      return unitCost == null ? null : ratePerHa * unitCost
    case 'totalCost':
      return unitCost == null ? null : ratePerHa * unitCost * areaHa
  }
}

/** Expected yield of a zone: the crop's expected yield scaled by the zone's relative productivity. */
export const zoneYield = (expectedYieldTHa: number, zone: ProductivityZone) => (expectedYieldTHa * (zone.relativeProductivity ?? 100)) / 100

/** Plant-available N per unit of a fertilizer line's rate (kg N per base unit), or null without N data. */
export function availableNPerUnit(line: OperationInputLine, product: Product | undefined): number | null {
  if (!line.nutrients || line.nutrients.n == null || !line.ratePerHa) return null
  const organic = isOrganicFertilizer(product?.fertilizerType)
  const n = availableN(product?.fertilizerType, line.nutrients.n, line.nutrients.nh4N, organic)
  return n == null ? null : n / line.ratePerHa
}
