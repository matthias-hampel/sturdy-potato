import { ALL_RESULT_PARAMS, CLASS_KEYS, type FieldSoilHistory, type SoilCampaign, type SoilParameter } from '@agmeo/contracts'
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart } from '#/components/charts'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'
import { type MapZone, SoilZoneMap } from './SoilZoneMap'
import { methodLabel, NO_DATA_COLOR, paramLabel, paramUnit, paramValue, STAGE_COLORS } from './soilLabels'

const campaignDate = (c: SoilCampaign) => c.sampledOn ?? c.createdAt.slice(0, 10)

/**
 * Sampling history of a field (reference: HistoryDrawer + compare): every zone map with its lab
 * values, the trend of a parameter across campaigns, two campaigns side by side, restore.
 */
export function HistoryPanel({ fieldId, writable, onClose }: { fieldId: string; writable: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const history = useOrgQuery<FieldSoilHistory>(`/fields/${fieldId}/soil/history`)
  const [selected, setSelected] = useState<string | null>(null)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [param, setParam] = useState<SoilParameter>('ph')
  const restore = useOrgMutation((base, zonationId: string) => api.post(`${base}/fields/${fieldId}/soil/zonations/${zonationId}/restore`, {}), { success: t('soil.history.restored') })

  const data = history.data
  const campaigns = data?.campaigns ?? []
  const current = campaigns.find((c) => c.zonationId === selected) ?? campaigns[0] ?? null
  const other = campaigns.find((c) => c.zonationId === compareWith) ?? null
  const params = useMemo(() => ALL_RESULT_PARAMS.filter((p) => campaigns.some((c) => c.means[p] != null)), [campaigns])
  const shownParam = params.includes(param) ? param : (params[0] ?? 'ph')
  const classKey = (CLASS_KEYS as Record<string, 'ph' | 'p' | 'k' | 'mg'>)[shownParam]
  const mapZones = useMemo<MapZone[]>(
    () =>
      (current?.zones ?? []).map((z) => ({
        key: z.id,
        geometry: z.geometry,
        color: classKey ? (z.classes[classKey] ? STAGE_COLORS[z.classes[classKey]!] : NO_DATA_COLOR) : z.color,
        label: z.values[shownParam] != null ? paramValue(shownParam, z.values[shownParam]) : (z.probeNr?.toString() ?? z.label),
        point: z.samplePoint,
      })),
    [current, classKey, shownParam],
  )
  const trend = useMemo(
    () =>
      campaigns
        .filter((c) => c.sampledOn && c.means[shownParam] != null)
        .map((c) => ({ date: c.sampledOn!, value: c.means[shownParam]!, tooltip: `${fmt.date(c.sampledOn)} · ${paramValue(shownParam, c.means[shownParam])} ${paramUnit(shownParam)}` }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [campaigns, shownParam],
  )

  if (history.isLoading) return <Loading />
  if (history.error) return <ErrorNotice error={history.error} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-fg mr-auto">{t('soil.history.title')}</h2>
        {params.length > 0 && (
          <Select aria-label={t('soil.history.parameter')} className="w-48" items={params.map((p) => ({ id: p }))} value={shownParam} onChange={(v) => v && setParam(v as SoilParameter)}>
            {(item) => <Option id={item.id}>{paramLabel(item.id)}</Option>}
          </Select>
        )}
        <Button onPress={onClose}>{t('soil.history.back')}</Button>
      </div>
      {!campaigns.length ? (
        <Card>
          <EmptyState title={t('soil.history.empty')} />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] gap-4 items-start">
          <div className="space-y-4">
            {data && <SoilZoneMap boundary={data.field.geometry} zones={mapZones} className="h-[440px]" />}
            <Card title={t('soil.history.trend')}>
              {trend.length > 1 ? (
                <LineChart points={trend} format={(v) => paramValue(shownParam, v)} ariaLabel={t('soil.history.trend')} height={200} selectedDate={current?.sampledOn} />
              ) : (
                <p className="text-sm text-muted">{t('soil.history.trendEmpty')}</p>
              )}
            </Card>
          </div>
          <div className="space-y-4 min-w-0">
            <Card title={t('soil.history.zonationArchive')} padded={false}>
              <ul className="divide-y divide-line">
                {campaigns.map((c) => (
                  <li key={c.zonationId} className={cx('flex items-center gap-2 px-4 py-2.5', c.zonationId === current?.zonationId && 'bg-primary-soft')}>
                    <button type="button" className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => setSelected(c.zonationId)}>
                      <span className="block text-sm font-medium text-fg">
                        {fmt.date(campaignDate(c))} · {methodLabel(c.method)}
                      </span>
                      <span className="block text-xs text-muted">
                        {t('soil.batch.successZones', { count: c.zones.length })}
                        {c.sampledOn ? ` · ${t('soil.history.sampled')}` : ` · ${t('soil.history.notSampled')}`}
                      </span>
                    </button>
                    {c.active ? (
                      <Badge tone="success">{t('soil.history.active')}</Badge>
                    ) : (
                      <>
                        <Badge>{t('soil.history.archived')}</Badge>
                        {writable && (
                          <Button size="icon-sm" variant="ghost" aria-label={t('soil.history.restore')} onPress={() => restore.mutate(c.zonationId)}>
                            <RotateCcw />
                          </Button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            {current && (
              <Card title={t('soil.history.compare')}>
                <Select
                  label={t('soil.history.compareWith')}
                  items={campaigns.filter((c) => c.zonationId !== current.zonationId).map((c) => ({ id: c.zonationId, label: `${fmt.date(campaignDate(c))} · ${methodLabel(c.method)}` }))}
                  value={other?.zonationId ?? null}
                  onChange={(v) => setCompareWith(v ? String(v) : null)}
                >
                  {(item) => <Option id={item.id}>{item.label}</Option>}
                </Select>
                <CompareTable a={current} b={other} />
              </Card>
            )}
          </div>
        </div>
      )}
      {data && data.samples.length > 0 && (
        <Card title={t('soil.history.samples')} padded={false}>
          <Table aria-label={t('soil.history.samples')}>
            <TableHeader>
              <Column isRowHeader>{t('soil.editModal.date')}</Column>
              <Column>{t('soil.cell.source')}</Column>
              {(['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as const).map((p) => (
                <Column key={p} align="end">
                  {paramLabel(p)}
                </Column>
              ))}
              <Column align="end">{paramLabel('nmin')}</Column>
            </TableHeader>
            <TableBody items={data.samples}>
              {(s) => (
                <Row id={s.id}>
                  <Cell>{fmt.date(s.sampledOn)}</Cell>
                  <Cell>{s.labImportId ? t('soil.history.source.lab') : t('soil.history.source.manual')}</Cell>
                  <Cell align="end">{fmt.num(s.ph, 1)}</Cell>
                  <Cell align="end">{fmt.num(s.p2o5Mg100g, 0)}</Cell>
                  <Cell align="end">{fmt.num(s.k2oMg100g, 0)}</Cell>
                  <Cell align="end">{fmt.num(s.mgoMg100g, 0)}</Cell>
                  <Cell align="end">{fmt.num(s.humusPct, 1)}</Cell>
                  <Cell align="end">{fmt.num(s.nminTotal, 0)}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

/** Field means of two campaigns and their difference. */
function CompareTable({ a, b }: { a: SoilCampaign; b: SoilCampaign | null }) {
  const { t } = useTranslation()
  const params = ALL_RESULT_PARAMS.filter((p) => a.means[p] != null || b?.means[p] != null)
  if (!params.length) return <p className="text-sm text-muted mt-3">{t('soil.history.noValues')}</p>
  return (
    <Table aria-label={t('soil.history.compare')} className="mt-3">
      <TableHeader>
        <Column isRowHeader>{t('soil.history.parameter')}</Column>
        <Column align="end">{fmt.date(campaignDate(a))}</Column>
        {b && <Column align="end">{fmt.date(campaignDate(b))}</Column>}
        {b && <Column align="end">Δ</Column>}
      </TableHeader>
      <TableBody items={params.map((p) => ({ id: p }))}>
        {({ id: p }) => {
          const va = a.means[p]
          const vb = b?.means[p]
          const delta = va != null && vb != null ? va - vb : null
          return (
            <Row id={p}>
              <Cell>
                {paramLabel(p)} <span className="text-xs text-muted">{paramUnit(p)}</span>
              </Cell>
              <Cell align="end">{paramValue(p, va)}</Cell>
              {b && <Cell align="end">{paramValue(p, vb)}</Cell>}
              {b && <Cell align="end">{delta == null ? '—' : `${delta > 0 ? '+' : ''}${paramValue(p, delta)}`}</Cell>}
            </Row>
          )
        }}
      </TableBody>
    </Table>
  )
}
