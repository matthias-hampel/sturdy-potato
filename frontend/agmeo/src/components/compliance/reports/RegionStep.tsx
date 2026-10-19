import { FEDERAL_STATE_NAMES, FEDERAL_STATES, type FarmRegulatory, type FederalExportFormat, type FederalState, type RegulatoryFormatOffer, type RegulatoryRegion } from '@agmeo/contracts'
import { ArrowRight, CalendarClock, FileText, Info, MapPin, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Badge, Card, Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'
import { type DeadlineTone, daysUntil, deadlineTone, formatAuthority, formatDeadline, formatShortName, formatTitle, regulatoryInput, uploadSteps } from './formats'

const AUTO = 'auto'

/** Step 1: where the farm reports, and the formats that state takes with their deadlines. */
export function RegionStep({
  farmId,
  year,
  region,
  selected,
  onContinue,
}: {
  farmId: string
  year: number
  region: RegulatoryRegion
  selected: FederalExportFormat | null
  onContinue: (format: FederalExportFormat) => void
}) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const farm = useOrgQuery<FarmRegulatory>(`/farms/${farmId}/regulatory`)
  // The farm's stored Bundesland is the override; without it the FLIKs decide.
  const save = useOrgMutation((base, federalState: FederalState | null) => api.put<FarmRegulatory>(`${base}/farms/${farmId}/regulatory`, { ...regulatoryInput(farm.data!), federalState }), {
    success: t('fertilizerReports.region.saved'),
  })

  const state = region.federalState
  const stateName = state ? FEDERAL_STATE_NAMES[state] : null
  const recommended = selected ?? region.formats[0]?.format ?? null
  const detectedFrom =
    state && region.source === 'farm'
      ? t('fertilizerReports.region.detectedFrom.farm', { state: stateName })
      : state && region.source === 'flik'
        ? t('fertilizerReports.region.detectedFrom.flik', { state: stateName, percent: Math.round(region.flikCoverage * 100) })
        : t('fertilizerReports.region.unknown')

  return (
    <div className="space-y-6">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <MapPin className="size-4 text-muted" aria-hidden /> {t('fertilizerReports.region.title')}
          </span>
        }
        description={detectedFrom}
      >
        <div className="flex flex-wrap items-end gap-4">
          {stateName && (
            <div className="pb-2">
              <Badge tone="primary">{stateName}</Badge>
            </div>
          )}
          <Select
            label={t('fertilizerReports.region.override')}
            items={[{ id: AUTO, name: t('fertilizerReports.region.auto') }, ...FEDERAL_STATES.map((id) => ({ id, name: FEDERAL_STATE_NAMES[id] }))]}
            value={region.source === 'farm' && state ? state : AUTO}
            onChange={(v) => v != null && save.mutate(v === AUTO ? null : (v as FederalState))}
            isDisabled={!can('farm.write') || !farm.data || save.isPending}
            className="w-72"
          >
            {(s) => <Option id={s.id}>{s.name}</Option>}
          </Select>
        </div>
        <p className="text-xs text-muted mt-2">{can('farm.write') ? t('fertilizerReports.region.overrideHint') : t('fertilizerReports.region.readOnly')}</p>
      </Card>

      {region.formats.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 items-stretch">
          {region.formats.map((offer) => (
            <FormatCard key={offer.format} offer={offer} recommended={offer.format === recommended} onContinue={() => onContinue(offer.format)} />
          ))}
        </div>
      )}

      {stateName && region.formats.length === 0 && (
        <Notice tone="info" icon={Info}>
          <p className="font-medium text-fg">{t('fertilizerReports.unsupported.title', { state: stateName })}</p>
          <p className="mt-1">{t('fertilizerReports.unsupported.body')}</p>
        </Notice>
      )}

      <RecordReportCard farmId={farmId} year={year} />
    </div>
  )
}

const TONE_CLASS: Record<DeadlineTone, string> = {
  past: 'bg-surface-2 text-muted',
  urgent: 'bg-danger-soft text-danger',
  soon: 'bg-warning-soft text-warning',
  relaxed: 'bg-success-soft text-success',
}

/** One report format: authority, deadline, how the file gets there, and the way into the wizard. */
function FormatCard({ offer, recommended, onContinue }: { offer: RegulatoryFormatOffer; recommended: boolean; onContinue: () => void }) {
  const { t } = useTranslation()
  const date = offer.deadline ? formatDeadline(offer.deadline) : ''
  const days = offer.deadline ? daysUntil(offer.deadline) : 0
  const tone = deadlineTone(days)
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-xs flex flex-col min-w-0', recommended && 'ring-2 ring-primary/60')}>
      <header className="px-4 pt-3.5 pb-2.5 border-b border-line/70">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">{formatTitle(offer.format)}</h2>
          {recommended && <Badge tone="primary">{t('fertilizerReports.format.recommended')}</Badge>}
        </div>
        <p className="text-xs text-muted mt-0.5">{formatAuthority(offer.format)}</p>
      </header>
      <div className="p-4 space-y-4 flex-1">
        {offer.deadline ? (
          <div className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', TONE_CLASS[tone])} aria-label={`${t('fertilizerReports.format.deadline')}: ${date}`}>
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            <span>{tone === 'past' ? t('fertilizerReports.format.deadlinePassed', { date }) : t('fertilizerReports.format.deadlineIn', { count: days, date })}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-surface-2 text-muted">
            <Info className="size-4 shrink-0" aria-hidden />
            <span>{t('fertilizerReports.format.noReportingDuty')}</span>
          </div>
        )}
        <ol className="list-decimal list-outside pl-5 space-y-1 text-sm text-fg-2">
          {uploadSteps(offer.format, date).map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      </div>
      <footer className="px-4 pb-4">
        <Button variant={recommended ? 'primary' : 'secondary'} onPress={onContinue}>
          {t('fertilizerReports.format.continue', { format: formatShortName(offer.format) })} <ArrowRight />
        </Button>
      </footer>
    </section>
  )
}

/**
 * The state-neutral record for the farm file (agmeo's Düngebericht PDF): here the printable
 * Düngedokumentation with the fertilizer need and the § 10 records, offered in every state.
 */
export function RecordReportCard({ farmId, year }: { farmId: string; year: number }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <FileText className="size-4 text-muted" aria-hidden /> {t('fertilizerReports.record.title')}
        </span>
      }
      description={t('fertilizerReports.record.description')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/o/$orgId/compliance/report" params={{ orgId }} search={{ farmId, year }} variant="secondary">
          <Printer /> {t('fertilizerReports.record.open')}
        </Link>
        <p className="text-xs text-muted">{t('fertilizerReports.record.hint')}</p>
      </div>
    </Card>
  )
}
