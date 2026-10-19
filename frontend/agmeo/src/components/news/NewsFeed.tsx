import type { NewsCategory, NewsItem } from '@agmeo/contracts'
import { CalendarDays, ClipboardList, CloudSun, FileWarning, Newspaper, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { operationTypeLabel } from '#/i18n/labels'
import { LOCALE, t } from '#/i18n'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { cx } from '#/ui/utils'

const ICON: Record<NewsCategory, LucideIcon> = { weather: CloudSun, tasks: ClipboardList, events: CalendarDays, advisory: FileWarning }
const TONE: Record<NewsCategory, BadgeTone> = { weather: 'info', tasks: 'accent', events: 'neutral', advisory: 'warning' }

/** Parameters in the viewer's units and language (the server sends canonical °C, mm and ha). */
function display(key: string, p: Record<string, string | number>): Record<string, string | number> {
  const rain = (v: unknown) => fmt.measure(Number(v), 'precipDepth', { digits: 0 })
  const temp = (v: unknown, digits = 1) => fmt.measure(Number(v), 'temperature', { digits })
  const date = (v: unknown) => (v ? fmt.date(String(v), { day: '2-digit', month: '2-digit' }) : '')
  const out: Record<string, string | number> = { ...p }
  if ('rain' in p) out.rain = rain(p.rain)
  if ('temp' in p) out.temp = temp(p.temp)
  if ('min' in p) out.min = fmt.measure(Number(p.min), 'temperature', { digits: 0, withUnit: key === 'weather.bodyForecast7' })
  if ('max' in p) out.max = temp(p.max, 0)
  if ('area' in p) out.area = fmt.ha(Number(p.area), 0)
  if ('type' in p) out.type = operationTypeLabel(String(p.type) as never)
  if (key.startsWith('advisory.') && p.date) out.date = fmt.date(String(p.date))
  if (key === 'events.line') {
    out.dates = p.start === p.end ? date(p.start) : `${date(p.start)}–${date(p.end)}`
    out.location = LOCALE.startsWith('de') ? p.location : p.locationEn
  }
  return out
}

export function newsHeadline(item: NewsItem): string {
  const h = item.headline
  if (h.key === 'tasks.headline') {
    const parts = [
      h.params.overdue ? t('news.tasks.overdue', { count: Number(h.params.overdue) }) : null,
      h.params.dueToday ? t('news.tasks.dueToday', { count: Number(h.params.dueToday) }) : null,
      h.params.next7 ? t('news.tasks.next7', { count: Number(h.params.next7) }) : null,
    ].filter(Boolean)
    return t('news.tasks.headline', { parts: parts.join(', ') })
  }
  return t(`news.${h.key}`, display(h.key, h.params))
}

function NewsCard({ item, compact }: { item: NewsItem; compact?: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const Icon = ICON[item.category]
  const lines = item.body.map((b) => ({ key: b.key, text: b.key === 'tasks.line' && !b.params.field ? t('news.tasks.lineNoField', display(b.key, b.params)) : t(`news.${b.key}`, display(b.key, b.params)), url: b.params.url ? String(b.params.url) : null }))
  return (
    <article className={cx('rounded-xl border border-line bg-surface p-4', item.priority >= 8 && 'border-warning/50')}>
      <header className="flex items-start gap-3">
        <span className="size-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0" aria-hidden>
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[item.category]}>{t(`news.category.${item.category}`)}</Badge>
            <span className="text-xs text-muted">{fmt.date(item.validFrom)}</span>
          </div>
          <h3 className="font-semibold mt-1">{newsHeadline(item)}</h3>
        </div>
      </header>
      {!compact && (
        <div className="mt-3 space-y-2 text-sm text-fg-2">
          {lines.map((l, i) =>
            l.key.endsWith('.line') ? (
              <p key={i} className="pl-3">
                • {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{l.text}</a> : l.text}
              </p>
            ) : (
              <p key={i}>{l.text}</p>
            ),
          )}
        </div>
      )}
      {item.cta && (
        <div className="mt-3">
          {item.cta.to === 'tasks' ? (
            <Link to="/o/$orgId/tasks" params={{ orgId }} size="sm" variant="secondary">{t(`news.${item.cta.labelKey}`)}</Link>
          ) : (
            <Link to="/o/$orgId/compliance" params={{ orgId }} search={{ tab: 'reports', format: item.cta.params?.format } as never} size="sm" variant="secondary">
              {t(`news.${item.cta.labelKey}`)}
            </Link>
          )}
        </div>
      )}
    </article>
  )
}

/** The organization's news: weather, tasks, events and fertilizer-report reminders. */
export function NewsFeed({ limit, compact }: { limit?: number; compact?: boolean }) {
  const { t } = useTranslation()
  const news = useOrgQuery<NewsItem[]>('/news', undefined, { staleTime: 10 * 60_000 })
  if (news.isLoading) return <Loading />
  if (news.error) return <ErrorNotice error={news.error} />
  const items = (news.data ?? []).slice(0, limit)
  if (!items.length) return <Card><EmptyState icon={Newspaper} title={t('news.empty')} /></Card>
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <NewsCard key={i.id} item={i} compact={compact} />
      ))}
    </div>
  )
}
