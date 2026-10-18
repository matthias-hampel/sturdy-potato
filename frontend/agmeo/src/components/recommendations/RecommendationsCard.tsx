import {
  DISMISS_REASONS,
  type AcceptRecommendationInput,
  type AcceptRecommendationResult,
  type DismissReason,
  type Recommendation,
  type RecommendationEvidence,
  type RecommendationList,
} from '@agmeo/contracts'
import { Button as AriaButton } from 'react-aria-components'
import { ChevronDown, Lightbulb, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CropTag, OperationTypeLabel, PriorityBadge } from '#/components/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { t as tt } from '#/i18n'
import { Button, Link } from '#/ui/Button'
import { Badge, Card, Loading, Notice } from '#/ui/Layout'
import { Menu, MenuItem, MenuTrigger, Tooltip } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

/** Recommendations older than this are recalculated when the card opens. */
const STALE_MS = 6 * 60 * 60_000

/**
 * "Heute empfohlen": the rule set's decisions for the organization, a field or a crop, with
 * their evidence, and buttons to take them over (reschedule or task) or dismiss them.
 */
export function RecommendationsCard({ fieldId, cropCycleId, limit = 5, className }: { fieldId?: string; cropCycleId?: string; limit?: number; className?: string }) {
  const { t } = useTranslation()
  const list = useOrgQuery<RecommendationList>('/recommendations', { fieldId, cropCycleId }, { staleTime: 60_000 })
  const refresh = useOrgMutation((p) => api.post<RecommendationList>(`${p}/recommendations/refresh`), { silentError: true })
  const [showAll, setShowAll] = useState(false)

  // Recalculate once when nothing was calculated yet or the last run is old (weather moves on).
  const triggered = useRef(false)
  const data = list.data
  useEffect(() => {
    if (!data || triggered.current) return
    if (data.generatedAt == null || Date.now() - Date.parse(data.generatedAt) > STALE_MS) {
      triggered.current = true
      refresh.mutate(undefined)
    }
  }, [data, refresh])

  const items = data?.items ?? []
  const shown = showAll ? items : items.slice(0, limit)
  const busy = refresh.isPending

  return (
    <Card
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <Lightbulb className="size-4 text-accent" aria-hidden />
          {t('recommendations.title')}
          {items.length > 0 && <Badge tone="accent">{items.length}</Badge>}
        </span>
      }
      description={t('recommendations.subtitle')}
      actions={
        <span className="flex items-center gap-2">
          {data?.generatedAt && <span className="text-xs text-muted hidden sm:inline">{t('recommendations.updated', { when: fmt.dateTime(data.generatedAt) })}</span>}
          <Tooltip content={t('recommendations.refresh')}>
            <Button size="icon-sm" variant="ghost" aria-label={t('recommendations.refresh')} isDisabled={busy} onPress={() => refresh.mutate(undefined)}>
              <RefreshCw className={cx('size-4', busy && 'animate-spin')} />
            </Button>
          </Tooltip>
        </span>
      }
    >
      {list.isLoading && <Loading />}
      {refresh.error && <Notice tone="warning" className="mb-3">{t('recommendations.refreshFailed', { reason: errorMessage(refresh.error) })}</Notice>}
      {data && (
        <div className="space-y-3">
          {data.briefing && (
            <div className="rounded-lg bg-accent-soft/60 border border-accent/15 px-3.5 py-2.5 text-sm text-fg flex gap-2.5">
              <Sparkles className="size-4 text-accent shrink-0 mt-0.5" aria-hidden />
              <p>{data.briefing}</p>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted">{busy ? t('recommendations.computing') : t('recommendations.empty')}</p>
          ) : (
            <ul className="divide-y divide-line -mx-1">
              {shown.map((r) => (
                <RecommendationItem key={r.id} r={r} ruleSet={data.ruleSet} showField={!fieldId && !cropCycleId} />
              ))}
            </ul>
          )}
          {items.length > limit && (
            <Button size="sm" variant="quiet" onPress={() => setShowAll((s) => !s)}>
              {showAll ? t('recommendations.showLess') : t('recommendations.showAll', { count: items.length })}
            </Button>
          )}
          {items.length > 0 && <p className="text-[11px] text-muted">{t('recommendations.disclaimer')}</p>}
        </div>
      )}
    </Card>
  )
}

function RecommendationItem({ r, ruleSet, showField }: { r: Recommendation; ruleSet: string; showField: boolean }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [open, setOpen] = useState(!r.explanation)
  const reschedules = (r.action === 'postpone' || r.action === 'catch_up') && r.windowFrom != null && r.operation?.status === 'planned'
  const title = headline(r)

  const accept = useOrgMutation(
    (p, input: AcceptRecommendationInput) => api.post<AcceptRecommendationResult>(`${p}/recommendations/${r.id}/accept`, input),
    { success: (res) => (res.rescheduledTo ? t('recommendations.accepted.reschedule', { date: fmt.date(res.rescheduledTo) }) : t('recommendations.accepted.task')) },
  )
  const dismiss = useOrgMutation((p, reason: DismissReason) => api.post(`${p}/recommendations/${r.id}/dismiss`, { reason }), { success: t('recommendations.dismissed') })

  return (
    <li className="px-1 py-3 flex gap-3">
      <OperationTypeLabel type={r.operationType ?? 'inspection'} iconOnly className="self-start" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start gap-2 justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg">{title}</div>
            <div className="text-xs text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {showField && <span className="text-fg-2">{r.field.name}</span>}
              {r.cropCycle && <CropTag name={r.cropCycle.cropName} color={r.cropCycle.cropColor} />}
              <span className={cx(r.windowFrom ? 'text-fg-2 font-medium' : '')}>{r.windowFrom ? whenLabel(r.windowFrom, r.windowTo) : t('recommendations.noDay')}</span>
              {r.zoneNos && r.kind !== 'variable_rate' && <span>{t('recommendations.zones', { zones: r.zoneNos.join(', ') })}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityBadge priority={r.priority} />
            <span className="text-xs text-muted tabular hidden sm:inline">{t('recommendations.confidence', { pct: Math.round(r.confidence * 100) })}</span>
          </div>
        </div>

        {r.explanation && (
          <p className="text-sm text-fg-2">
            {r.explanation}{' '}
            <Tooltip content={t('recommendations.aiPhrasedHint', { model: r.explanationModel ?? '', ruleSet })}>
              <AriaButton className="align-middle inline-flex items-center gap-1 text-[11px] text-accent outline-none">
                <Sparkles className="size-3" aria-hidden />
                {t('recommendations.aiPhrased')}
              </AriaButton>
            </Tooltip>
          </p>
        )}

        <div>
          <AriaButton onPress={() => setOpen((o) => !o)} className="text-xs text-muted hover:text-fg inline-flex items-center gap-1 outline-none" aria-expanded={open}>
            <ChevronDown className={cx('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
            {t('recommendations.why')}
          </AriaButton>
          {open && (
            <ul className="mt-1 ml-4.5 list-disc pl-3 space-y-0.5 text-xs text-fg-2">
              {r.evidence.map((e, i) => (
                <li key={i}>{evidenceText(e)}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {can('task.write') && (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={accept.isPending || dismiss.isPending}
              onPress={() => accept.mutate({ title: `${title} – ${r.field.name}`, dueOn: reschedules ? undefined : (r.windowFrom ?? undefined) })}
            >
              {reschedules ? t('recommendations.accept.reschedule', { date: fmt.shortDate(r.windowFrom) }) : t('recommendations.accept.task')}
            </Button>
          )}
          {r.operation && (
            <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: r.operation.id }} size="sm" variant="ghost">
              {t('recommendations.open.operation')}
            </Link>
          )}
          {r.kind === 'variable_rate' && r.cropCycle && (
            <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: r.cropCycle.id }} search={{ tab: 'zones' }} size="sm" variant="ghost">
              {t('recommendations.open.zones')}
            </Link>
          )}
          {r.kind === 'scouting' && (
            <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: r.field.id }} search={{ tab: 'satellite' }} size="sm" variant="ghost">
              {t('recommendations.open.satellite')}
            </Link>
          )}
          {can('task.write') && (
            <MenuTrigger>
              <Button size="sm" variant="ghost" isDisabled={accept.isPending || dismiss.isPending}>
                <X /> {t('recommendations.dismiss')}
              </Button>
              <Menu onAction={(key) => dismiss.mutate(key as DismissReason)}>
                {DISMISS_REASONS.map((reason) => (
                  <MenuItem key={reason} id={reason}>
                    {t(`recommendations.dismissReason.${reason}`)}
                  </MenuItem>
                ))}
              </Menu>
            </MenuTrigger>
          )}
        </div>
      </div>
    </li>
  )
}

function headline(r: Recommendation): string {
  const what = r.operation?.title ?? (r.operationType ? tt(`enum.operationType.${r.operationType}`) : '')
  return tt(`recommendations.headline.${r.action}`, { what })
}

function whenLabel(from: string, to: string | null) {
  const day = (d: string) => `${fmt.weekday(d)}, ${fmt.shortDate(d)}`
  return to && to !== from ? `${day(from)} – ${day(to)}` : `${day(from)} (${fmt.relativeDays(from)})`
}

const isDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Evidence as a sentence: dates with weekday, times of spray windows, numbers in German format. */
function evidenceText(e: RecommendationEvidence): string {
  const p: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(e.params)) {
    if (v == null) p[k] = '–'
    else if (typeof v === 'string' && isDate(v)) p[k] = `${fmt.weekday(v)}, ${fmt.shortDate(v)}`
    else if ((k === 'start' || k === 'end') && typeof v === 'string') p[k] = v.slice(11, 16)
    else if ((k === 'from' || k === 'to') && typeof v === 'string' && /^\d{2}-\d{2}$/.test(v)) p[k] = `${v.slice(3)}.${v.slice(0, 2)}.`
    else if (typeof v === 'number') p[k] = fmt.num(v, 2)
    else p[k] = v
  }
  if (e.code === 'spray_window' && typeof e.params.start === 'string') p.date = `${fmt.weekday(e.params.start.slice(0, 10))}, ${fmt.shortDate(e.params.start.slice(0, 10))}`
  if (e.code === 'overdue_days') return tt('recommendations.evidence.overdue_days', { count: Number(e.params.days) })
  if (e.code === 'psm_finding') {
    const { code, productName, ...rest } = e.params
    return tt('recommendations.evidence.psm_finding', { productName, message: tt(`psm.finding.${code}`, rest) })
  }
  // German short dates end with a period ("12. Okt."); avoid a double one at the sentence end.
  return tt(`recommendations.evidence.${e.code}`, p).replace(/\.\.$/, '.')
}
