import type { DmcCycleRow, DmcForecast, DmcMeasurement } from '@agmeo/contracts'
import { Satellite, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiRequestError, errorMessage } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, TextField, num } from '#/ui/Field'
import { Badge, Card, Notice } from '#/ui/Layout'
import { ConfirmButton } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { dmPct, offsetPts } from './format'

/** Forecast days as a strip of chips (median, p10–p90, bar scaled within the window); a chip pins the map raster. */
export function ForecastStrip({ forecast, selectedDate, onPickDate }: { forecast: DmcForecast; selectedDate: string | null; onPickDate: (date: string) => void }) {
  const { t } = useTranslation()
  const days = forecast.dailyPredictions
  if (!days.length) return null
  const medians = days.map((d) => d.median)
  const min = Math.min(...medians)
  const span = Math.max(...medians) - min || 1
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" role="list" aria-label={t('dmc.forecast.days')}>
      {days.map((d) => {
        const active = d.date === selectedDate
        return (
          <button
            key={d.date}
            type="button"
            role="listitem"
            onClick={() => onPickDate(d.date)}
            title={`${fmt.date(d.date)}: ${dmPct(d.median)} (${dmPct(d.q5)}–${dmPct(d.q95)})`}
            className={cx(
              'flex min-w-[3.5rem] flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              active ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-surface-2',
            )}
          >
            <span className="text-sm font-semibold tabular text-fg">{fmt.fixed(d.median * 100, 1)}</span>
            <span className="text-[0.65rem] tabular text-muted">
              {fmt.fixed(d.q5 * 100, 0)}–{fmt.fixed(d.q95 * 100, 0)}
            </span>
            <div className="flex h-10 w-full items-end justify-center">
              <div className={cx('w-2.5 rounded-t', active ? 'bg-primary' : 'bg-line-strong')} style={{ height: `${25 + (75 * (d.median - min)) / span}%` }} />
            </div>
            <span className="text-[0.7rem] text-muted">{fmt.weekday(d.date)}</span>
            <span className="text-[0.7rem] tabular text-fg-2">{fmt.date(d.date, { day: '2-digit', month: '2-digit' })}</span>
          </button>
        )
      })}
    </div>
  )
}

export function CycleDetail({
  row,
  configured,
  forecast,
  forecastError,
  forecastLoading,
  selectedDate,
  onPickDate,
}: {
  row: DmcCycleRow
  configured: boolean
  forecast: DmcForecast | undefined
  forecastError: unknown
  forecastLoading: boolean
  selectedDate: string | null
  onPickDate: (date: string) => void
}) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const title = row.fieldPartName ? `${row.fieldName} · ${row.fieldPartName}` : row.fieldName
  const missing = forecastError instanceof ApiRequestError && forecastError.code === 'dmc_missing_input'
  return (
    <Card
      title={title}
      description={[row.cropName, row.varietyName, row.sowingDate && t('dmc.detail.sown', { date: fmt.date(row.sowingDate) })].filter(Boolean).join(' · ')}
    >
      <div className="space-y-5">
        {configured && row.missing.length === 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-fg">{t('dmc.forecast.title')}</span>
              {forecast?.calibration && (
                <Badge tone="primary">{forecast.calibration.kind === 'measurement' ? t('dmc.forecast.calibratedMeasurement') : t('dmc.forecast.calibratedOffset', { offset: offsetPts(forecast.calibration.offset) })}</Badge>
              )}
              {forecast?.harvestDetected?.status === 'confirmed' && (
                <Badge tone={forecast.harvestDetected.trust === 'high' ? 'success' : 'info'}>
                  <Satellite className="size-3" aria-hidden />
                  {t('dmc.harvest.satellite', { from: fmt.shortDate(forecast.harvestDetected.windowStart), to: fmt.shortDate(forecast.harvestDetected.windowEnd) })}
                </Badge>
              )}
              {forecast?.harvest && (
                <span className="ml-auto text-muted tabular">{t('dmc.harvest.probability', { value: fmt.pct(forecast.harvest.probability * 100) })}</span>
              )}
            </div>
            {forecastLoading ? (
              <p className="text-sm text-muted">{t('dmc.forecast.loading')}</p>
            ) : forecastError && !missing ? (
              <Notice tone="danger">{errorMessage(forecastError)}</Notice>
            ) : forecast ? (
              <>
                <ForecastStrip forecast={forecast} selectedDate={selectedDate} onPickDate={onPickDate} />
                <p className="text-xs text-muted">
                  {forecast.harvestWindow && forecast.kind === 'silage' && (
                    <>
                      {t(forecast.harvestWindow.estimated ? 'dmc.window.estimated' : 'dmc.window.forecast', {
                        start: forecast.harvestWindow.start ? fmt.date(forecast.harvestWindow.start) : '—',
                        end: forecast.harvestWindow.end ? fmt.date(forecast.harvestWindow.end) : '—',
                      })}{' '}
                    </>
                  )}
                  {t('dmc.forecast.footer', { model: forecast.modelVersion ?? '—', gdd: fmt.num(forecast.dailyPredictions[0]?.accumulatedGdd), fao: forecast.faoMaturity })}
                  {forecast.weather && ` · ${t('dmc.forecast.weather', { supplied: forecast.weather.daysSupplied, total: forecast.weather.daysTotal })}`}
                </p>
              </>
            ) : null}
          </section>
        )}
        {row.missing.length > 0 && (
          <Notice tone="warning">
            {t('dmc.missing.intro')} {row.missing.map((m) => t(`dmc.missing.${m}`)).join(', ')}.
          </Notice>
        )}
        <MaturityForm row={row} canEdit={can('crop.write')} />
        <Measurements row={row} configured={configured} canEdit={can('crop.write')} />
      </div>
    </Card>
  )
}

function MaturityForm({ row, canEdit }: { row: DmcCycleRow; canEdit: boolean }) {
  const { t } = useTranslation()
  const [fao, setFao] = useState<number>(row.faoMaturity ?? NaN)
  const [toVariety, setToVariety] = useState(row.faoSource !== 'cycle' && row.varietyId != null)
  useEffect(() => {
    setFao(row.faoMaturity ?? NaN)
    setToVariety(row.faoSource !== 'cycle' && row.varietyId != null)
  }, [row.cropCycleId, row.faoMaturity, row.faoSource, row.varietyId])
  const save = useOrgMutation((org, v: { faoMaturity: number | null; applyToVariety: boolean }) => api.put(`${org}/maize-dmc/cycles/${row.cropCycleId}/settings`, v), {
    success: t('dmc.maturity.saved'),
  })
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-fg">{t('dmc.maturity.title')}</h3>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({ faoMaturity: num(fao), applyToVariety: toVariety })
        }}
      >
        <NumberField
          label={row.kind === 'grain' ? t('dmc.maturity.grain') : t('dmc.maturity.silage')}
          className="w-44"
          minValue={150}
          maxValue={800}
          step={10}
          value={fao}
          onChange={setFao}
          isDisabled={!canEdit}
          description={row.faoSource ? t(`dmc.maturity.source.${row.faoSource}`) : undefined}
        />
        {row.varietyId && (
          <Checkbox isSelected={toVariety} onChange={setToVariety} isDisabled={!canEdit} className="mb-2.5">
            {t('dmc.maturity.applyToVariety', { variety: row.varietyName })}
          </Checkbox>
        )}
        {canEdit && (
          <Button type="submit" isPending={save.isPending} className="mb-px">
            {t('common.save')}
          </Button>
        )}
      </form>
    </section>
  )
}

function Measurements({ row, configured, canEdit }: { row: DmcCycleRow; configured: boolean; canEdit: boolean }) {
  const { t } = useTranslation()
  const list = useOrgQuery<DmcMeasurement[]>(`/maize-dmc/cycles/${row.cropCycleId}/measurements`)
  const [date, setDate] = useState<string | null>(today())
  const [dm, setDm] = useState<number>(NaN)
  const [notes, setNotes] = useState('')
  const add = useOrgMutation(
    (org, v: { measurementDate: string; measuredDm: number; notes: string | null }) => api.post<DmcMeasurement>(`${org}/maize-dmc/cycles/${row.cropCycleId}/measurements`, v),
    {
      success: t('dmc.measurement.saved'),
      onSuccess: () => {
        setDm(NaN)
        setNotes('')
      },
    },
  )
  const remove = useOrgMutation((org, id: string) => api.delete(`${org}/maize-dmc/measurements/${id}`), { success: t('dmc.measurement.deleted') })
  const value = num(dm)
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-fg">{t('dmc.measurement.title')}</h3>
        <p className="text-xs text-muted">{t('dmc.measurement.description')}</p>
      </div>
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (date && value != null) add.mutate({ measurementDate: date, measuredDm: value / 100, notes: notes.trim() || null })
          }}
        >
          <DatePicker label={t('dmc.measurement.date')} value={date} onChange={setDate} minValue={row.sowingDate ?? undefined} maxValue={today()} className="w-44" />
          <NumberField label={t('dmc.measurement.dm')} unit="%" minValue={6} maxValue={94} step={0.1} value={dm} onChange={setDm} className="w-32" />
          <TextField label={t('dmc.measurement.notes')} value={notes} onChange={setNotes} className="flex-1 min-w-40" />
          <Button type="submit" variant="primary" isPending={add.isPending} isDisabled={!date || value == null} className="mb-px">
            {t('dmc.measurement.add')}
          </Button>
        </form>
      )}
      {!configured && <p className="text-xs text-muted">{t('dmc.measurement.noModel')}</p>}
      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {list.data.map((m) => (
            <li key={m.id} className={cx('flex items-center gap-3 px-3 py-2', m.supersededAt && 'text-muted')}>
              <span className="w-28 tabular">{fmt.date(m.measurementDate)}</span>
              <span className="w-16 tabular font-medium">{dmPct(m.measuredDm)}</span>
              <span className="w-40 tabular text-xs text-muted">
                {m.modelDmAtMeasurement != null ? t('dmc.measurement.vsModel', { model: dmPct(m.modelDmAtMeasurement), offset: offsetPts(m.offset) }) : t('dmc.measurement.noModelValue')}
              </span>
              <span className="flex-1 truncate text-xs text-muted">{m.notes}</span>
              {m.supersededAt ? <Badge>{t('dmc.measurement.superseded')}</Badge> : <Badge tone="primary">{t('dmc.measurement.active')}</Badge>}
              {canEdit && (
                <ConfirmButton
                  title={t('dmc.measurement.deleteTitle')}
                  message={t('dmc.measurement.deleteMessage', { date: fmt.date(m.measurementDate) })}
                  confirmLabel={t('common.delete')}
                  onConfirm={() => remove.mutateAsync(m.id)}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')}>
                      <Trash2 />
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

