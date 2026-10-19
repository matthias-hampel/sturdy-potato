import { type ExportPreflight, FEDERAL_STATE_NAMES, type FederalExportFormat, type RegulatoryRegion } from '@agmeo/contracts'
import { Check, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton } from 'react-aria-components'
import { useOrgQuery } from '#/lib/queries'
import { ErrorNotice, Loading } from '#/ui/Layout'
import { toast } from '#/ui/Toast'
import { cx, focusRing } from '#/ui/utils'
import { DownloadStep } from './DownloadStep'
import { FarmDataStep } from './FarmDataStep'
import { REPORT_STEPS, type ReportNavigation, type ReportStep } from './formats'
import { ReadinessStep } from './ReadinessStep'
import { RegionStep } from './RegionStep'

const STEP_LABELS: Record<ReportStep, string> = {
  region: 'fertilizerReports.step.region',
  readiness: 'fertilizerReports.step.readiness',
  'farm-data': 'fertilizerReports.step.farmData',
  download: 'fertilizerReports.step.download',
}

/**
 * Düngemeldung wizard (agmeo fertilizer-reports): the Bundesland and format, the check before the
 * export, the farm data the format needs, then the file with the authority's upload guide. Step,
 * format and the field to focus live in the URL so the browser's back button walks the steps.
 */
export function FertilizerReportsTab({
  farmId,
  year,
  search,
  onNavigate,
}: {
  farmId: string
  year: number
  search: ReportNavigation
  onNavigate: (next: ReportNavigation) => void
}) {
  const { t } = useTranslation()
  const region = useOrgQuery<RegulatoryRegion>('/regulatory/region', { farmId, year })

  const available = region.data?.formats.map((f) => f.format) ?? []
  const format: FederalExportFormat | null = search.format && available.includes(search.format) ? search.format : (available[0] ?? null)
  const step: ReportStep = search.step && format ? search.step : 'region'
  const preflight = useOrgQuery<ExportPreflight>(format ? '/regulatory/preflight' : null, { format: format ?? undefined, farmId, year })

  if (region.isLoading) return <Loading />
  if (region.error || !region.data) return <ErrorNotice error={region.error} />
  const federalState = region.data.federalState

  const lockedMessage = (next: ReportStep): string | null => {
    if (next === 'region') return null
    if (!federalState) return t('fertilizerReports.step.lockedNoState')
    if (!format) return t('fertilizerReports.step.lockedUnsupported', { state: FEDERAL_STATE_NAMES[federalState] })
    if (next !== 'download' || preflight.data?.ready) return null
    if (preflight.isLoading) return t('fertilizerReports.download.blockedPending')
    if (preflight.error) return t('fertilizerReports.download.checkFailed')
    return t('fertilizerReports.download.fixFirst')
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted max-w-3xl">{t('fertilizerReports.description')}</p>
      <StepIndicator step={step} lockedMessage={lockedMessage} onStepChange={(next) => onNavigate({ step: next })} />

      {step === 'region' && (
        <RegionStep
          farmId={farmId}
          year={year}
          region={region.data}
          selected={format}
          onContinue={(chosen) => onNavigate({ step: 'readiness', format: chosen, focus: null })}
        />
      )}
      {step === 'readiness' && format && (
        <ReadinessStep
          farmId={farmId}
          year={year}
          format={format}
          onFixFarmData={(field) => onNavigate({ step: 'farm-data', focus: field })}
          onFixRegion={() => onNavigate({ step: 'region', focus: null })}
          onContinue={() => onNavigate({ step: 'farm-data', focus: null })}
        />
      )}
      {step === 'farm-data' && format && (
        <FarmDataStep farmId={farmId} year={year} format={format} federalState={federalState} focus={search.focus ?? null} onContinue={() => onNavigate({ step: 'download', focus: null })} />
      )}
      {step === 'download' && format && <DownloadStep farmId={farmId} year={year} format={format} offer={region.data.formats.find((f) => f.format === format)!} />}
    </div>
  )
}

/** The four steps as numbered tabs; a locked step explains why instead of opening. */
function StepIndicator({ step, lockedMessage, onStepChange }: { step: ReportStep; lockedMessage: (step: ReportStep) => string | null; onStepChange: (step: ReportStep) => void }) {
  const { t } = useTranslation()
  const current = REPORT_STEPS.indexOf(step)
  return (
    <nav aria-label={t('fertilizerReports.step.label')}>
      <ol className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {REPORT_STEPS.map((s, index) => {
          const active = s === step
          const locked = !active && !!lockedMessage(s)
          const done = index < current
          const press = () => {
            const message = lockedMessage(s)
            if (message) toast.info(message)
            else if (!active) onStepChange(s)
          }
          return (
            <li key={s} className="min-w-0">
              <AriaButton
                onPress={press}
                aria-label={t(STEP_LABELS[s])}
                aria-current={active ? 'step' : undefined}
                aria-disabled={locked || undefined}
                className={cx(
                  'w-full h-10 px-2 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors',
                  active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
                  locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  focusRing,
                )}
              >
                <span
                  className={cx(
                    'size-5 rounded-full flex items-center justify-center text-xs shrink-0 tabular',
                    active ? 'bg-primary text-primary-fg' : done ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-muted',
                  )}
                  aria-hidden
                >
                  {locked ? <Lock className="size-3" /> : done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                <span className="hidden sm:inline truncate">{t(STEP_LABELS[s])}</span>
              </AriaButton>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
