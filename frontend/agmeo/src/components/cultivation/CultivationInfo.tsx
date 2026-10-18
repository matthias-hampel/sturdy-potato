import type { CropCycle, Field, Operation, WeatherForecast } from '@agmeo/contracts'
import { CloudRain, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { localDate, noticeKind, noticeMessage, weatherCode } from '#/components/insights/weather'
import { CropCycleStatusBadge, CropRoleBadge, CropTag } from '#/components/labels'
import { INDEX_INFO, type ShownIndex } from '#/components/monitoring/indices'
import { ObservationsChart } from '#/components/monitoring/ObservationsChart'
import { RecommendationsCard } from '#/components/recommendations/RecommendationsCard'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Badge, Card, DescriptionList, Loading, Notice } from '#/ui/Layout'

const CHART_INDICES: ShownIndex[] = ['ndvi', 'ndre', 'ndmi']

/** Feldinfo: the crop and the field, vegetation over the season, weather at the farm and notes. */
export function CultivationInfo({ cycle, field, operations, onEdit }: { cycle: CropCycle; field: Field; operations: Operation[]; onEdit?: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [index, setIndex] = useState<ShownIndex>('ndvi')
  const done = operations.filter((o) => o.status === 'completed').length
  const open = operations.filter((o) => o.status === 'planned' || o.status === 'in_progress').length
  const tenure = field.tenure === 'owned' ? t('fields.tenure.owned') : field.tenure === 'leased' ? t('fields.tenure.leased') : t('fields.tenure.other')

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      <RecommendationsCard cropCycleId={cycle.id} className="lg:col-span-2" />

      <Card
        title={t('cultivation.info.crop')}
        actions={onEdit && <Button size="sm" variant="quiet" onPress={onEdit}><Pencil /> {t('common.edit')}</Button>}
      >
        <DescriptionList
          items={[
            { label: t('crops.plan.crop'), value: <span className="inline-flex items-center gap-2"><CropTag name={cycle.cropName} color={cycle.cropColor} /><CropRoleBadge role={cycle.role} /></span> },
            { label: t('crops.form.variety'), value: cycle.varietyName },
            { label: t('common.status'), value: <CropCycleStatusBadge status={cycle.status} /> },
            { label: t('cultivation.info.season'), value: cycle.seasonName },
            { label: t('crops.form.sowingDate'), value: cycle.sowingDate ? fmt.date(cycle.sowingDate) : null },
            { label: t('crops.form.expectedHarvest'), value: cycle.expectedHarvestDate ? fmt.date(cycle.expectedHarvestDate) : null },
            { label: t('crops.form.expectedYield'), value: cycle.expectedYieldTHa != null ? `${fmt.fixed(cycle.expectedYieldTHa, 1)} t/ha` : null },
            { label: t('crops.form.expectedPrice'), value: cycle.expectedPricePerT != null ? `${fmt.money(cycle.expectedPricePerT)}/t` : null },
            { label: t('crops.plan.template'), value: cycle.templateName },
            { label: t('cultivation.info.landUseCode'), value: cycle.landUseCode ? <span className="tabular">{cycle.landUseCode}{cycle.landUseCodeIsDefault && <span className="text-muted"> · {t('cultivation.info.landUseDefault')}</span>}</span> : null },
            { label: t('cultivation.info.operations'), value: t('cultivation.info.operationCount', { done, open }) },
          ]}
        />
      </Card>

      <Card
        title={t('cultivation.info.field')}
        actions={<Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: field.id }} variant="quiet" size="sm">{t('cultivation.fieldRecord')}</Link>}
      >
        <DescriptionList
          items={[
            { label: t('fields.farm'), value: field.farmName },
            { label: t('fields.identifier'), value: field.identifier },
            { label: t('crops.part'), value: cycle.fieldPartName },
            { label: t('cultivation.info.cropArea'), value: fmt.ha(cycle.areaHa) },
            { label: t('fieldPage.area'), value: fmt.ha(field.areaHa) },
            { label: t('fields.soilType'), value: [field.soilType, field.soilTexture].filter(Boolean).join(' · ') || null },
            { label: t('fields.tenure.label'), value: tenure },
            {
              label: t('cultivation.info.zones'),
              value: field.nitrateSensitiveZone || field.phosphateSensitiveZone ? (
                <span className="inline-flex gap-1.5">
                  {field.nitrateSensitiveZone && <Badge tone="danger">{t('cultivation.info.nitrateZone')}</Badge>}
                  {field.phosphateSensitiveZone && <Badge tone="warning">{t('cultivation.info.phosphateZone')}</Badge>}
                </span>
              ) : null,
            },
            { label: t('fieldPage.centre'), value: <span className="tabular">{field.centroid.lat.toFixed(5)}, {field.centroid.lng.toFixed(5)}</span> },
          ]}
        />
      </Card>

      <Card
        className="lg:col-span-2"
        title={t('cultivation.info.vegetation', { index: INDEX_INFO[index].label })}
        description={INDEX_INFO[index].description}
        actions={<SegmentedControl aria-label={t('cultivation.info.index')} items={CHART_INDICES.map((i) => ({ id: i, label: INDEX_INFO[i].label }))} value={index} onChange={setIndex} />}
      >
        <ObservationsChart fieldId={field.id} fieldName={field.name} index={index} selectedDate={cycle.sowingDate ?? `${cycle.harvestYear}-06-01`} />
      </Card>

      <WeatherCard farmId={field.farmId} />

      <Card title={t('common.notes')}>
        {cycle.notes || field.notes ? (
          <div className="space-y-3 text-sm">
            {cycle.notes && (
              <div>
                <div className="text-xs text-muted mb-0.5">{t('cultivation.info.cropNotes')}</div>
                <p className="whitespace-pre-line">{cycle.notes}</p>
              </div>
            )}
            {field.notes && (
              <div>
                <div className="text-xs text-muted mb-0.5">{t('cultivation.info.fieldNotes')}</div>
                <p className="whitespace-pre-line">{field.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('cultivation.info.noNotes')}</p>
        )}
      </Card>
    </div>
  )
}

/** Current conditions, the next days and weather notices at the field's farm. */
function WeatherCard({ farmId }: { farmId: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const weather = useOrgQuery<WeatherForecast>(`/farms/${farmId}/weather`, undefined, { staleTime: 10 * 60_000 })
  const w = weather.data
  const current = w?.current
  const code = weatherCode(current?.weatherCode ?? w?.daily[0]?.weatherCode)
  const CurrentIcon = code.icon
  return (
    <Card title={t('cultivation.info.weather')} actions={<Link to="/o/$orgId/weather" params={{ orgId }} variant="quiet" size="sm">{t('cultivation.info.weatherMore')}</Link>}>
      {weather.isLoading ? (
        <Loading />
      ) : !w ? (
        <Notice>{t('cultivation.info.noWeather')}</Notice>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <CurrentIcon className="size-9 text-primary shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="text-2xl font-semibold tabular">{current?.tempC != null ? `${fmt.num(current.tempC)}°` : '—'}</div>
              <div className="text-sm text-fg-2">{code.label}</div>
            </div>
            <div className="ml-auto text-right text-sm text-fg-2">
              <div className="inline-flex items-center gap-1"><CloudRain className="size-4 text-muted" aria-hidden /> {t('cultivation.info.rain7d', { mm: fmt.num(w.precipitationLast7dMm, 1) })}</div>
              {current?.windKmh != null && <div className="text-xs text-muted">{t('cultivation.info.wind', { kmh: fmt.num(current.windKmh) })}</div>}
            </div>
          </div>
          <ol className="grid grid-cols-7 gap-1 text-center text-xs">
            {w.daily.slice(0, 7).map((d) => {
              const c = weatherCode(d.weatherCode)
              const Icon = c.icon
              return (
                <li key={d.date} className="rounded-md bg-surface-2 py-2 px-0.5" title={c.label}>
                  <div className="text-muted">{fmt.weekday(localDate(d.date))}</div>
                  <Icon className="size-5 mx-auto my-1 text-fg-2" aria-hidden />
                  <div className="tabular font-medium">{fmt.num(d.tempMaxC)}°</div>
                  <div className="tabular text-muted">{fmt.num(d.tempMinC)}°</div>
                  <div className="tabular text-info mt-0.5">{d.precipitationMm ? `${fmt.num(d.precipitationMm, 1)}` : '·'}</div>
                </li>
              )
            })}
          </ol>
          {w.notices.length > 0 && (
            <ul className="space-y-1.5">
              {w.notices.slice(0, 3).map((n) => {
                const kind = noticeKind(n.kind)
                const Icon = kind.icon
                return (
                  <li key={`${n.kind}:${n.date}`} className="flex items-start gap-2 text-sm">
                    <Icon className={n.severity === 'warning' ? 'size-4 mt-0.5 text-warning shrink-0' : 'size-4 mt-0.5 text-muted shrink-0'} aria-hidden />
                    <span>{noticeMessage(n, w)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
