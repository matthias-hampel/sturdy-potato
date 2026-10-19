import { BEK_SOURCES, type CarbonComparison, type CarbonEvaluation, type CarbonReportRow, OPERATION_TYPES, SCOPE2_KINDS, type Scope2Year } from '@agmeo/contracts'
import { t } from '#/i18n'
import { downloadXlsx, type Cell, type Sheet } from '#/lib/xlsx'
import { divisor, entityLabel, evaluationUnit, opTypeLabel, presentSources, sourceLabel } from './shared'

/*
 * Excel exports of the CO2 analysis (agmeo analysis/[year] downloadAnalysisExcel and
 * _components/exportProjectXlsx.ts).
 */

const r0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n))
const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100)
const safeDiv = (a: number, b: number) => (b ? a / b : null)
const today = () => new Date().toISOString().slice(0, 10)
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_')

/** The analysis table as shown: by operation type or by emission source, in the chosen evaluation. */
export function exportAnalysisTable(rows: CarbonReportRow[], evaluation: CarbonEvaluation, level: string, tableType: 'operations' | 'sources', year: number) {
  if (!rows.length) return
  const unit = evaluationUnit(evaluation)
  const val = (v: number, r: CarbonReportRow) => {
    const d = divisor(r, evaluation)
    return d ? r0(v / d) : null
  }
  const base = [t('carbon.table.entity'), t('carbon.table.areaHa'), t('carbon.table.yieldFmT'), t('carbon.table.yieldDmT'), `${t('carbon.total')} (${unit})`]
  let header: string[]
  let data: Cell[][]
  if (tableType === 'operations') {
    const types = OPERATION_TYPES.filter((type) => level === 'field' || rows.some((r) => r.byOperationType[type]))
    header = [...base, ...types.map((type) => `${opTypeLabel(type)} (${unit})`)]
    data = rows.map((r) => [entityLabel(r, level), r2(r.areaHa), r2(r.yieldT), r2(r.yieldTDm), val(r.total, r), ...types.map((type) => val(r.byOperationType[type] ?? 0, r))])
  } else {
    const sources = presentSources(rows)
    header = [...base, `${t('carbon.sumOf')} PF (${unit})`, `${t('carbon.sumOf')} PB (${unit})`, `${t('carbon.sumOf')} PN (${unit})`, ...sources.map((s) => `${sourceLabel(s)} (${s.toUpperCase()}) (${unit})`)]
    data = rows.map((r) => [entityLabel(r, level), r2(r.areaHa), r2(r.yieldT), r2(r.yieldTDm), val(r.total, r), val(r.pf, r), val(r.pb, r), val(r.pn, r), ...sources.map((s) => val(r.bySource[s] ?? 0, r))])
  }
  const formats: Record<number, 'int' | 'dec2'> = { 1: 'dec2', 2: 'dec2', 3: 'dec2' }
  for (let c = 4; c < header.length; c++) formats[c] = 'int'
  downloadXlsx(`${safeName(t('carbon.export.filename'))}_${year}_${tableType}`, [
    { name: tableType === 'operations' ? t('carbon.byOperations') : t('carbon.bySources'), header, rows: data, formats },
  ])
}

interface Agg {
  area: number
  yieldFm: number
  yieldDm: number
  co2: number
  fields: number
  years: Set<number>
}
const newAgg = (): Agg => ({ area: 0, yieldFm: 0, yieldDm: 0, co2: 0, fields: 0, years: new Set() })
function groupBy<R extends CarbonReportRow, K>(rows: R[], key: (r: R) => K) {
  const map = new Map<K, Agg>()
  for (const r of rows) {
    const k = key(r)
    const a = map.get(k) ?? newAgg()
    a.area += r.areaHa
    a.yieldFm += r.yieldT
    a.yieldDm += r.yieldTDm
    a.co2 += r.total
    a.fields += r.cyclesCount
    a.years.add(r.year)
    map.set(k, a)
  }
  return map
}
function total(map: Map<unknown, Agg>): Agg {
  const out = newAgg()
  for (const a of map.values()) {
    out.area += a.area
    out.yieldFm += a.yieldFm
    out.yieldDm += a.yieldDm
    out.co2 += a.co2
    out.fields += a.fields
    a.years.forEach((y) => out.years.add(y))
  }
  return out
}

function aggSheet<K>(name: string, label: string, map: Map<K, Agg>, labelOf: (k: K) => string | number, cumulative: boolean, sort: (a: K, b: K) => number): Sheet {
  const unit = (u: string) => (cumulative ? ` (${t('carbon.export.cumAbbr')}, ${u})` : ` (${u})`)
  const header = [
    label,
    cumulative ? t('carbon.export.fieldYears') : t('carbon.export.fields'),
    ...(cumulative ? [t('carbon.export.years')] : []),
    `${t('carbon.table.area')}${unit('ha')}`,
    `${t('carbon.table.yieldFm')}${unit('t')}`,
    `${t('carbon.table.yieldDm')}${unit('t')}`,
    `CO₂e ${t('carbon.total')}${unit('kg')}`,
    'CO₂e / ha (kg)',
    t('carbon.export.co2PerTFm'),
    t('carbon.export.co2PerTDm'),
  ]
  const row = (k: string | number, a: Agg): Cell[] => [
    k,
    a.fields,
    ...(cumulative ? [a.years.size] : []),
    r2(a.area),
    r2(a.yieldFm),
    r2(a.yieldDm),
    r0(a.co2),
    r0(safeDiv(a.co2, a.area)),
    r0(safeDiv(a.co2, a.yieldFm)),
    r0(safeDiv(a.co2, a.yieldDm)),
  ]
  const keys = [...map.keys()].sort(sort)
  const rows = [...keys.map((k) => row(labelOf(k), map.get(k)!)), row(`Σ ${t('carbon.total')}`, total(map as Map<unknown, Agg>))]
  const off = cumulative ? 1 : 0
  const formats: Record<number, 'int' | 'dec2'> = { 1: 'int', [2 + off]: 'dec2', [3 + off]: 'dec2', [4 + off]: 'dec2', [5 + off]: 'int', [6 + off]: 'int', [7 + off]: 'int', [8 + off]: 'int' }
  if (cumulative) formats[2] = 'int'
  return { name, header, rows, formats }
}

/** The farm comparison workbook: data, per farm, per crop, per year, a CO2e/t DM matrix and scope 2. */
export function exportComparison(cmp: CarbonComparison, rows: CarbonComparison['rows'], scope2: CarbonComparison['scope2']) {
  if (!rows.length) return
  const orgName = new Map(cmp.organizations.map((o) => [o.id, o.name]))
  const opTypes = OPERATION_TYPES
  const dataHeader = [
    t('carbon.export.organization'),
    t('carbon.year'),
    t('carbon.crop'),
    `${t('carbon.table.area')} (ha)`,
    `${t('carbon.table.yieldFm')} (t)`,
    `${t('carbon.table.yieldDm')} (t)`,
    `CO₂e ${t('carbon.total')} (kg)`,
    'CO₂e / ha (kg)',
    t('carbon.export.co2PerTFm'),
    t('carbon.export.co2PerTDm'),
    ...opTypes.map((o) => `${opTypeLabel(o)} (kg CO₂e)`),
    `${t('carbon.sumOf')} PF (kg CO₂e)`,
    `${t('carbon.sumOf')} PB (kg CO₂e)`,
    `${t('carbon.sumOf')} PN (kg CO₂e)`,
    ...BEK_SOURCES.map((s) => `${s.toUpperCase()} (kg CO₂e)`),
  ]
  const dataRows: Cell[][] = rows.map((r) => [
    r.orgName,
    r.year,
    r.cropName,
    r2(r.areaHa),
    r2(r.yieldT),
    r2(r.yieldTDm),
    r0(r.total),
    r0(safeDiv(r.total, r.areaHa)),
    r0(safeDiv(r.total, r.yieldT)),
    r0(safeDiv(r.total, r.yieldTDm)),
    ...opTypes.map((o) => r0(r.byOperationType[o] ?? 0)),
    r0(r.pf),
    r0(r.pb),
    r0(r.pn),
    ...BEK_SOURCES.map((s) => r0(r.bySource[s] ?? 0)),
  ])
  const dataFormats: Record<number, 'int' | 'dec2'> = { 3: 'dec2', 4: 'dec2', 5: 'dec2' }
  for (let c = 6; c < dataHeader.length; c++) dataFormats[c] = 'int'

  // CO2e per t DM, farm × crop.
  const crops = [...new Set(rows.map((r) => r.cropName))].sort((a, b) => a.localeCompare(b))
  const cell = new Map<string, { co2: number; dm: number }>()
  for (const r of rows) {
    const k = `${r.orgId}|${r.cropName}`
    const c = cell.get(k) ?? { co2: 0, dm: 0 }
    c.co2 += r.total
    c.dm += r.yieldTDm
    cell.set(k, c)
  }
  const orgIds = [...new Set(rows.map((r) => r.orgId))].sort((a, b) => (orgName.get(a) ?? a).localeCompare(orgName.get(b) ?? b))
  const sum = (filter: (k: string) => boolean) => {
    let co2 = 0
    let dm = 0
    for (const [k, c] of cell) if (filter(k)) ((co2 += c.co2), (dm += c.dm))
    return r0(safeDiv(co2, dm))
  }
  const matrixRows: Cell[][] = [
    ...orgIds.map((o) => [orgName.get(o) ?? o, ...crops.map((c) => sum((k) => k === `${o}|${c}`)), sum((k) => k.startsWith(`${o}|`))]),
    [`Σ ${t('carbon.crop')}`, ...crops.map((c) => sum((k) => k.endsWith(`|${c}`))), sum(() => true)],
  ]
  const matrixFormats: Record<number, 'int'> = {}
  for (let c = 1; c <= crops.length + 1; c++) matrixFormats[c] = 'int'

  const sheets: Sheet[] = [
    { name: t('carbon.export.sheetData'), header: dataHeader, rows: dataRows, formats: dataFormats },
    aggSheet(t('carbon.export.sheetPerFarm'), t('carbon.export.organization'), groupBy(rows, (r) => r.orgId), (k) => orgName.get(k) ?? k, true, (a, b) => (orgName.get(a) ?? a).localeCompare(orgName.get(b) ?? b)),
    aggSheet(t('carbon.export.sheetPerCrop'), t('carbon.crop'), groupBy(rows, (r) => r.cropName), (k) => k, true, (a, b) => a.localeCompare(b)),
    aggSheet(t('carbon.export.sheetPerYear'), t('carbon.year'), groupBy(rows, (r) => r.year), (k) => k, false, (a, b) => a - b),
    { name: t('carbon.export.sheetMatrix'), header: [`${t('carbon.export.organization')} \\ ${t('carbon.crop')}`, ...crops, `Σ ${t('carbon.export.organization')}`], rows: matrixRows, formats: matrixFormats },
  ]
  const s2 = scope2Sheet(scope2)
  if (s2) sheets.push(s2)
  downloadXlsx(`${safeName(t('carbon.export.comparisonFilename'))}_${today()}`, sheets)
}

function scope2Sheet(years: (Scope2Year & { orgName?: string })[]): Sheet | null {
  const rows = years
    .filter((y) => y.entries.length)
    .map((y): Cell[] => [y.orgName ?? '', y.harvestYear, ...SCOPE2_KINDS.map((k) => r0(y.entries.find((e) => e.kind === k)?.kgCo2e)), r0(y.totalKg)])
  if (!rows.length) return null
  const header = [t('carbon.export.organization'), t('carbon.year'), ...SCOPE2_KINDS.map((k) => `${t(`carbon.scope2.kind.${k}`)} (kg CO₂e)`), `${t('carbon.sumOf')} Scope 2 (kg CO₂e)`]
  const formats: Record<number, 'int'> = {}
  for (let c = 2; c < header.length; c++) formats[c] = 'int'
  return { name: 'Scope 2', header, rows, formats }
}
