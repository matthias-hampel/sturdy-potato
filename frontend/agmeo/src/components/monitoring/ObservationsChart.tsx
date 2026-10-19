import type { FieldObservation } from '@agmeo/contracts'
import { CircleDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Option, Select } from '#/ui/Field'
import { Badge, ErrorNotice, Loading } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { LineChart, type LinePoint } from '../charts'
import { INDEX_INFO, type ShownIndex } from './indices'

const idx = (v: number | null | undefined) => fmt.fixed(v, 2)

const ALL = 'all'

/**
 * Field mean of an index per acquisition, with unavailable observations shown hollow. With
 * years of history, one year is shown at a time (default: the selected date's year).
 */
export function ObservationsChart({
  fieldId,
  fieldName,
  index,
  selectedDate,
  onSelect,
}: {
  fieldId: string
  fieldName: string
  index: ShownIndex
  selectedDate?: string | null
  onSelect?: (date: string) => void
}) {
  const { t } = useTranslation()
  const obs = useOrgQuery<FieldObservation[]>(`/monitoring/fields/${fieldId}/observations`, { index })
  const all = useMemo(() => [...(obs.data ?? [])].sort((a, b) => a.observedOn.localeCompare(b.observedOn)), [obs.data])
  const years = useMemo(() => [...new Set(all.map((o) => o.observedOn.slice(0, 4)))].reverse(), [all])
  const [chosenYear, setYear] = useState<string | null>(null)
  const year = chosenYear ?? selectedDate?.slice(0, 4) ?? years[0] ?? ALL
  const list = useMemo(() => (year === ALL ? all : all.filter((o) => o.observedOn.startsWith(year))), [all, year])
  const label = INDEX_INFO[index].label

  if (obs.isLoading) return <Loading />
  if (obs.error) return <ErrorNotice error={obs.error} />
  const values = list.map((o) => o.mean).filter((v): v is number => v != null)
  const validCount = list.filter((o) => o.status === 'valid').length
  if (all.every((o) => o.mean == null)) {
    return (
      <p className="text-sm text-muted">
        {t('monitoring.observations.none', { index: label })}
      </p>
    )
  }

  // In the multi-year view, unavailable acquisitions would crowd the chart.
  const shown = year === ALL ? list.filter((o) => o.status === 'valid') : list
  const points: LinePoint[] = shown.map((o) => ({
    date: o.observedOn,
    value: o.mean,
    muted: o.status !== 'valid',
    tooltip: (
      <div className="space-y-0.5">
        <div className="text-muted">{fmt.date(o.observedOn)}</div>
        {o.status !== 'valid' && (
          <div className="text-fg-2 flex items-center gap-1">
            <CircleDashed className="size-3" aria-hidden /> {t('monitoring.observations.unavailableCoverage')}
          </div>
        )}
        <div className="flex justify-between gap-3 text-fg-2">{t('monitoring.observations.mean')} <span className="font-medium text-fg tabular">{idx(o.mean)}</span></div>
        <div className="flex justify-between gap-3 text-fg-2">P10–P90 <span className="text-fg tabular">{idx(o.p10)}–{idx(o.p90)}</span></div>
      </div>
    ),
  }))
  const [d0, d1] = INDEX_INFO[index].domain
  const domain: [number, number] = [Math.min(d0, ...values), Math.max(d1, ...values)]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          aria-label={t('monitoring.observations.year')}
          className="w-36"
          items={[...years.map((y) => ({ id: y, name: y })), { id: ALL, name: t('monitoring.observations.allYears') }]}
          value={year}
          onChange={(v) => v && setYear(String(v))}
        >
          {(item) => <Option id={item.id}>{item.name}</Option>}
        </Select>
        <span className="text-xs text-muted tabular">
          {onSelect
            ? t('monitoring.observations.summaryClickable', { valid: validCount, count: list.length })
            : t('monitoring.observations.summary', { valid: validCount, count: list.length })}
        </span>
      </div>
      {values.length > 0 ? (
        <LineChart
          points={points}
          format={(v) => fmt.fixed(v, 1)}
          domain={domain}
          ariaLabel={t('monitoring.observations.chartLabel', { index: label, field: fieldName })}
          color="var(--color-primary)"
          selectedDate={selectedDate}
          onSelect={onSelect}
        />
      ) : (
        <p className="text-sm text-muted">{t('monitoring.observations.noneInYear', { index: label, year })}</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} aria-hidden />
          {t('monitoring.observations.legendValid')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2" style={{ borderColor: 'var(--color-muted)' }} aria-hidden />
          {t('monitoring.observations.legendUnavailable')}
        </span>
      </div>
      <div className="max-h-96 overflow-y-auto">
      <Table aria-label={t('monitoring.observations.tableLabel', { index: label, field: fieldName })}>
        <TableHeader>
          <Column isRowHeader>{t('monitoring.observations.acquired')}</Column>
          <Column align="end">{t('monitoring.observations.mean')}</Column>
          <Column align="end">P10–P90</Column>
          <Column>{t('common.status')}</Column>
        </TableHeader>
        <TableBody items={[...list].reverse()}>
          {(o) => (
            <Row id={o.id} onAction={onSelect && o.status === 'valid' ? () => onSelect(o.observedOn) : undefined}>
              <Cell className="tabular">{fmt.date(o.observedOn)}</Cell>
              <Cell align="end">{idx(o.mean)}</Cell>
              <Cell align="end">{idx(o.p10)}–{idx(o.p90)}</Cell>
              <Cell>{o.status === 'valid' ? <Badge tone="success">{t('monitoring.observations.valid')}</Badge> : <Badge>{t('monitoring.observations.unavailable')}</Badge>}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  )
}
