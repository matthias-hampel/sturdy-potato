import type { SprayRating, WeatherForecast, WeatherHour } from '@agmeo/contracts'
import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { localClock, localDate } from '#/components/insights/weather'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Card, ErrorNotice, Loading } from '#/ui/Layout'

const HOURS = 24
const BLOCK = 4
// Rain bars reach full height at this intensity; heavier hours are capped.
const RAIN_SCALE_MM = 4

const RATING_BG: Record<SprayRating, string> = { good: 'bg-success', marginal: 'bg-warning', poor: 'bg-danger' }

const ms = (kmh: number | null) => (kmh == null ? null : kmh / 3.6)

/** OneSoil-style 24 h strip at the field centre: wind, rain and spraying suitability per hour. */
export function SprayWindowCard({ fieldId, className }: { fieldId: string; className?: string }) {
  const { t } = useTranslation()
  const weather = useOrgQuery<WeatherForecast>(`/fields/${fieldId}/forecast`, undefined, { staleTime: 10 * 60_000 })
  const hours = weather.data?.hourly.slice(0, HOURS) ?? []

  return (
    <Card
      className={className}
      title={t('sprayWindow.title')}
      description={t('sprayWindow.description')}
      actions={weather.data && <NextWindow w={weather.data} />}
    >
      {weather.isLoading ? (
        <Loading />
      ) : weather.error ? (
        <ErrorNotice error={weather.error} />
      ) : hours.length === 0 ? (
        <p className="text-sm text-muted">{t('sprayWindow.noData')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Strip hours={hours} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {(['good', 'marginal', 'poor'] as const).map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-4 rounded-full ${RATING_BG[r]}`} aria-hidden />
                {t(`sprayWindow.rating.${r}`)}
              </span>
            ))}
            <span className="sm:ml-auto">{t('sprayWindow.source', { provider: weather.data!.provider })}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

function Strip({ hours }: { hours: WeatherHour[] }) {
  const { t } = useTranslation()
  const blocks = Array.from({ length: Math.ceil(hours.length / BLOCK) }, (_, i) => hours.slice(i * BLOCK, (i + 1) * BLOCK))
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="min-w-[30rem]">
        <div className="rounded-lg border border-line overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))` }}>
            {blocks.map((block, b) => (
              <Block key={block[0].time} block={block} first={b === 0} />
            ))}
          </div>
          <div className="flex h-1.5" aria-hidden>
            {hours.map((h) => (
              <div key={h.time} className={`flex-1 ${h.spray ? RATING_BG[h.spray] : 'bg-line'}`} />
            ))}
          </div>
        </div>
        <div className="grid mt-1.5 text-xs text-muted tabular" style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))` }} aria-hidden>
          {blocks.map((block, b) => (
            <span key={block[0].time} className="px-2">{b === 0 ? t('sprayWindow.now') : localClock(block[0].time)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Block({ block, first }: { block: WeatherHour[]; first: boolean }) {
  const { t } = useTranslation()
  const head = block[0]
  const wind = ms(head.windKmh)
  const rain = block.reduce((s, h) => s + (h.precipitationMm ?? 0), 0)
  return (
    <div className={`relative h-24 ${first ? '' : 'border-l border-line/70'}`}>
      {/* Suitable hours tinted green so spray windows stand out */}
      <div className="absolute inset-0 flex" aria-hidden>
        {block.map((h) => (
          <div key={h.time} className={`flex-1 ${h.spray === 'good' ? 'bg-success/15' : ''}`} />
        ))}
      </div>
      {/* Hourly rain bars, behind the labels */}
      <div className="absolute inset-x-0 bottom-0 flex items-end h-14" aria-hidden>
        {block.map((h) => (
          <div
            key={h.time}
            className="flex-1 bg-info/15"
            style={{ height: `${Math.min(1, (h.precipitationMm ?? 0) / RAIN_SCALE_MM) * 100}%` }}
          />
        ))}
      </div>
      {/* Per-hour hover targets with the full values */}
      <div className="absolute inset-0 flex">
        {block.map((h) => (
          <div key={h.time} className="flex-1 hover:bg-fg/[0.03]" title={hourTitle(h, t)} />
        ))}
      </div>
      <div className="relative pointer-events-none p-2 flex flex-col h-full">
        {head.windDirectionDeg != null && (
          <ArrowDown className="size-4 text-fg-2" style={{ transform: `rotate(${head.windDirectionDeg}deg)` }} aria-hidden />
        )}
        <span className="text-sm text-fg tabular mt-0.5">{wind == null ? '–' : `${fmt.num(wind)} m/s`}</span>
        {rain > 0 && <span className="mt-auto text-sm text-info tabular">{fmt.num(rain, rain < 1 ? 1 : 0)} mm</span>}
      </div>
    </div>
  )
}

function hourTitle(h: WeatherHour, t: ReturnType<typeof useTranslation>['t']) {
  const wind = ms(h.windKmh)
  const gust = ms(h.gustKmh)
  return [
    `${fmt.weekday(localDate(h.time))} ${localClock(h.time)}`,
    h.spray && t(`sprayWindow.rating.${h.spray}`),
    wind != null && t('sprayWindow.hint.wind', { wind: fmt.num(wind, 1), gust: gust == null ? '–' : fmt.num(gust, 1) }),
    h.tempC != null && `${fmt.num(h.tempC, 1)} °C`,
    t('sprayWindow.hint.rain', { mm: fmt.num(h.precipitationMm ?? 0, 1), pct: fmt.num(h.precipitationProbabilityPct ?? 0) }),
  ]
    .filter(Boolean)
    .join('\n')
}

/** "Suitable now" or when the next window (within the 72 h forecast) opens. */
function NextWindow({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  const now = w.hourly[0]
  const next = w.sprayWindows[0]
  if (now?.spray === 'good' && next && next.start === now.time) {
    return <span className="text-xs font-medium text-success">{t('sprayWindow.goodNow', { until: localClock(next.end) })}</span>
  }
  if (!next) return <span className="text-xs text-muted">{t('sprayWindow.noneIn72h')}</span>
  const sameDay = localDate(next.start) === localDate(now?.time ?? next.start)
  const when = sameDay ? localClock(next.start) : `${fmt.weekday(localDate(next.start))} ${localClock(next.start)}`
  return <span className="text-xs text-fg-2">{t('sprayWindow.next', { when, hours: next.hours })}</span>
}
