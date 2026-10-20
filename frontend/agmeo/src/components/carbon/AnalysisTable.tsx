import { type CarbonEvaluation, type CarbonLevel, type CarbonReportRow, OPERATION_TYPES } from '@agmeo/contracts'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { Button, SegmentedControl } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Card, EmptyState } from '#/ui/Layout'
import { Tooltip } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { exportAnalysisTable } from './exports'
import { entityLabel, evaluationUnit, opTypeLabel, per, presentSources, sourceLabel } from './shared'

interface Col {
  id: string
  label: string
  title?: string
  value: (r: CarbonReportRow) => number | null
  divider?: boolean
}

/** The analysis as a table of the chosen year, by operation type or by emission source, with Excel export. */
export function AnalysisTable({ rows, level, evaluation, years }: { rows: CarbonReportRow[]; level: CarbonLevel; evaluation: CarbonEvaluation; years: number[] }) {
  const { t } = useTranslation()
  const [tableType, setTableType] = useState<'operations' | 'sources'>('operations')
  const [yearChoice, setYear] = useState<number | null>(null)
  const year = yearChoice ?? years[years.length - 1]
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null)
  const data = rows.filter((r) => r.year === year)
  const unit = evaluationUnit(evaluation)

  const v = (x: number, r: CarbonReportRow) => per(x, r, evaluation)
  const total: Col = { id: 'total', label: t('carbon.total'), value: (r) => v(r.total, r), divider: true }
  const cols: Col[] =
    tableType === 'operations'
      ? [total, ...OPERATION_TYPES.filter((type) => level === 'field' || data.some((r) => r.byOperationType[type])).map((type) => ({ id: type, label: opTypeLabel(type), value: (r: CarbonReportRow) => v(r.byOperationType[type] ?? 0, r) }))]
      : [
          total,
          { id: 'pf', label: `Σ PF`, title: t('carbon.group.pf'), value: (r) => v(r.pf, r) },
          { id: 'pb', label: `Σ PB`, title: t('carbon.group.pb'), value: (r) => v(r.pb, r) },
          { id: 'pn', label: `Σ PN`, title: t('carbon.group.pn'), value: (r) => v(r.pn, r), divider: true },
          ...presentSources(data).map((s) => ({ id: s, label: s.toUpperCase(), title: sourceLabel(s), value: (r: CarbonReportRow) => v(r.bySource[s] ?? 0, r) })),
        ]

  const sorted = [...data].sort((a, b) => {
    if (!sort) return a.cropName.localeCompare(b.cropName) || a.entityName.localeCompare(b.entityName)
    const col = cols.find((c) => c.id === sort.id)
    return ((col?.value(a) ?? -Infinity) - (col?.value(b) ?? -Infinity)) * sort.dir
  })
  // Footer: the sum of the totals divided by the sum of the bases.
  const sumRow: CarbonReportRow | null = data.length
    ? data.reduce(
        (acc, r) => ({
          ...acc,
          areaHa: acc.areaHa + r.areaHa,
          yieldT: acc.yieldT + r.yieldT,
          yieldTDm: acc.yieldTDm + r.yieldTDm,
          total: acc.total + r.total,
          pf: acc.pf + r.pf,
          pb: acc.pb + r.pb,
          pn: acc.pn + r.pn,
          bySource: Object.fromEntries([...new Set([...Object.keys(acc.bySource), ...Object.keys(r.bySource)])].map((k) => [k, (acc.bySource[k as keyof typeof acc.bySource] ?? 0) + (r.bySource[k as keyof typeof r.bySource] ?? 0)])),
          byOperationType: Object.fromEntries([...new Set([...Object.keys(acc.byOperationType), ...Object.keys(r.byOperationType)])].map((k) => [k, (acc.byOperationType[k] ?? 0) + (r.byOperationType[k] ?? 0)])),
        }),
        { ...data[0], areaHa: 0, yieldT: 0, yieldTDm: 0, total: 0, pf: 0, pb: 0, pn: 0, bySource: {}, byOperationType: {} },
      )
    : null
  const show = (x: number | null) => (x == null ? '—' : fmt.num(x, Math.abs(x) < 10 && x !== 0 ? 1 : 0))

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-line">
        <SegmentedControl
          aria-label={t('carbon.table.type')}
          items={[
            { id: 'operations', label: t('carbon.byOperations') },
            { id: 'sources', label: t('carbon.bySources') },
          ]}
          value={tableType}
          onChange={setTableType}
        />
        <Select aria-label={t('carbon.year')} className="w-24" items={years.map((y) => ({ id: y, name: String(y) }))} value={year} onChange={(y) => y != null && setYear(Number(y))}>
          {(y) => <Option id={y.id}>{y.name}</Option>}
        </Select>
        <span className="text-sm text-muted">{unit}</span>
        <Button className="ml-auto" isDisabled={!data.length} onPress={() => exportAnalysisTable(sorted, evaluation, level, tableType, year)}>
          <Download /> {t('carbon.exportExcel')}
        </Button>
      </div>
      {!data.length ? (
        <EmptyState title={t('carbon.empty.title')}>{t('carbon.empty.body')}</EmptyState>
      ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted border-b border-line min-w-64">{t('carbon.table.entity')}</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted border-b border-line">{t('carbon.table.areaHa')}</th>
                {cols.map((c) => (
                  <th key={c.id} className={cx('px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted border-b border-line whitespace-nowrap', c.divider && 'border-r')}>
                    <Tooltip content={c.title ?? c.label}>
                      <Button
                        variant="quiet"
                        size="sm"
                        className="uppercase text-xs"
                        onPress={() => setSort((s) => (s?.id === c.id ? (s.dir === -1 ? { id: c.id, dir: 1 } : null) : { id: c.id, dir: -1 }))}
                      >
                        {c.label}
                        {sort?.id === c.id && (sort.dir === -1 ? <ArrowDown /> : <ArrowUp />)}
                      </Button>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.key} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2 border-b border-line/60">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2.5 rounded-sm shrink-0" style={{ background: r.cropColor }} aria-hidden />
                      {entityLabel(r, level)}
                      {!r.hasModelData && <span className="text-xs text-muted">({t('carbon.noModelData')})</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-line/60 text-right tabular">{fmt.num(r.areaHa, 2)}</td>
                  {cols.map((c) => (
                    <td key={c.id} className={cx('px-3 py-2 border-b border-line/60 text-right tabular', c.divider && 'border-r', c.id === 'total' && 'font-medium')}>
                      {show(c.value(r))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {sumRow && (
              <tfoot className="sticky bottom-0 bg-surface">
                <tr className="font-semibold">
                  <td className="px-3 py-2 border-t-4 border-double border-line-strong">{t('carbon.total')}</td>
                  <td className="px-3 py-2 border-t-4 border-double border-line-strong text-right tabular">{fmt.num(sumRow.areaHa, 2)}</td>
                  {cols.map((c) => (
                    <td key={c.id} className={cx('px-3 py-2 border-t-4 border-double border-line-strong text-right tabular', c.divider && 'border-r')}>
                      {show(c.value(sumRow))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  )
}
