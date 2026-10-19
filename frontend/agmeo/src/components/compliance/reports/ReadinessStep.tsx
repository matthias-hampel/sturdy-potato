import type { ExportPreflight, FederalExportFormat, PreflightIssue } from '@agmeo/contracts'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, OctagonAlert, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'
import { preflightText } from '../shared'
import { type MissingCropMapping, type MissingFarmDatum, splitPreflight } from './formats'

type Severity = PreflightIssue['severity']
const SEVERITIES: Severity[] = ['blocking', 'warning', 'info']
const SEVERITY_TITLES: Record<Severity, string> = {
  blocking: 'fertilizerReports.readiness.blocking',
  warning: 'fertilizerReports.readiness.warning',
  info: 'fertilizerReports.readiness.info',
}

/** Findings fixed on the fields (names, numbers, FLIK) — the field manager. */
const FIELD_MANAGER_CODES = new Set([
  'flik_missing',
  'flik_too_long',
  'schlagnummer_missing',
  'schlagnummer_not_integer',
  'schlagnummer_duplicate',
  'schlagname_missing',
  'field_area_too_large',
  'st_feldblock_format',
  'st_parzelle_missing',
])
/** Findings fixed on the cultivations of the year (crop planning). */
const CULTIVATION_CODES = new Set(['field_without_cultivation', 'vorfrucht_missing', 'multiple_hauptfrucht', 'sowing_date_missing', 'st_dbe_missing'])
const FARM_DATA_CODES = new Set(['betriebsnummer_format', 'st_betriebsnummer_land'])
const REGION_CODES = new Set(['bundesland_mismatch'])

/** Step 2: the check before the export, grouped by severity, each rule with the way to fix it. */
export function ReadinessStep({
  farmId,
  year,
  format,
  onFixFarmData,
  onFixRegion,
  onContinue,
}: {
  farmId: string
  year: number
  format: FederalExportFormat
  onFixFarmData: (field: string) => void
  onFixRegion: () => void
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const preflight = useOrgQuery<ExportPreflight>('/regulatory/preflight', { format, farmId, year })

  if (preflight.isLoading) return <Loading />
  if (preflight.error || !preflight.data)
    return (
      <div className="space-y-3">
        <ErrorNotice error={preflight.error} />
        <Button size="sm" onPress={() => preflight.refetch()}>
          <RefreshCw /> {t('fertilizerReports.readiness.recheck')}
        </Button>
      </div>
    )

  const { missingFields, missingCropMappings, issues } = splitPreflight(preflight.data)
  const allClear = issues.length === 0 && missingFields.length === 0 && missingCropMappings.length === 0
  const betriebsnummerKey = format === 'st' ? 'euBetriebsnummer' : 'betriebsnummer'

  return (
    <div className="space-y-4">
      {allClear && (
        <Notice tone="success" icon={CheckCircle2}>
          <span className="font-medium text-fg">{t('fertilizerReports.readiness.allClear')}</span>
        </Notice>
      )}

      {(missingFields.length > 0 || missingCropMappings.length > 0) && (
        <MissingFarmDataList missingFields={missingFields} missingCropMappings={missingCropMappings} onFix={onFixFarmData} />
      )}

      {SEVERITIES.map((severity) => {
        const groups = groupByCode(issues.filter((i) => i.severity === severity))
        if (groups.length === 0) return null
        return (
          <Card key={severity} title={t(SEVERITY_TITLES[severity], { count: groups.length })} padded={false}>
            <ul className="divide-y divide-line">
              {groups.map(([code, group]) => (
                <RuleRow key={code} code={code} severity={severity} issues={group} onFixFarmData={() => onFixFarmData(betriebsnummerKey)} onFixRegion={onFixRegion} />
              ))}
            </ul>
          </Card>
        )
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button variant="ghost" onPress={() => preflight.refetch()} isDisabled={preflight.isFetching}>
          <RefreshCw className={preflight.isFetching ? 'animate-spin' : undefined} /> {t('fertilizerReports.readiness.recheck')}
        </Button>
        <Button variant="primary" onPress={onContinue}>
          {t('fertilizerReports.readiness.continue')} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

function groupByCode(issues: PreflightIssue[]) {
  const groups = new Map<string, PreflightIssue[]>()
  for (const issue of issues) groups.set(issue.code, [...(groups.get(issue.code) ?? []), issue])
  return [...groups.entries()]
}

/** Farm data the authority needs and the farm has not stored yet, each with its own fix. */
function MissingFarmDataList({ missingFields, missingCropMappings, onFix }: { missingFields: MissingFarmDatum[]; missingCropMappings: MissingCropMapping[]; onFix: (field: string) => void }) {
  const { t } = useTranslation()
  return (
    <section className="rounded-xl border border-danger/30 bg-danger-soft p-4" aria-labelledby="missing-farm-data">
      <h2 id="missing-farm-data" className="text-sm font-semibold text-danger flex items-center gap-2">
        <OctagonAlert className="size-4" aria-hidden /> {t('fertilizerReports.readiness.missingFieldsTitle')}
      </h2>
      <ul className="mt-3 space-y-2">
        {missingFields.map((field) => (
          <li key={field.key} className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg">
            <span>{field.label}</span>
            <Button size="sm" onPress={() => onFix(field.key)}>
              {t('fertilizerReports.readiness.fixInFarmData')}
            </Button>
          </li>
        ))}
        {missingCropMappings.length > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg">
            <span>
              {t('fertilizerReports.readiness.missingCropMappings', { count: missingCropMappings.length })}
              <span className="text-muted"> · {missingCropMappings.map((m) => m.cropName).join(', ')}</span>
            </span>
            <Button size="sm" onPress={() => onFix('cropCodeOverrides')}>
              {t('fertilizerReports.readiness.fixInFarmData')}
            </Button>
          </li>
        )}
      </ul>
    </section>
  )
}

const SEVERITY_ICON = { blocking: OctagonAlert, warning: AlertTriangle, info: Info } as const
const SEVERITY_CLASS: Record<Severity, string> = { blocking: 'text-danger', warning: 'text-warning', info: 'text-muted' }

/** One rule with every affected field collapsed into a list of names. */
function RuleRow({ code, severity, issues, onFixFarmData, onFixRegion }: { code: string; severity: Severity; issues: PreflightIssue[]; onFixFarmData: () => void; onFixRegion: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const Icon = SEVERITY_ICON[severity]
  const fieldNames = [...new Set(issues.map((i) => i.fieldName).filter((n): n is string => !!n))]
  return (
    <li className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className={cx('size-4 mt-0.5 shrink-0', SEVERITY_CLASS[severity])} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{preflightText(issues[0])}</p>
          {fieldNames.length > 0 && (
            <p className="text-xs text-muted mt-0.5">
              {fieldNames.slice(0, 5).join(', ')}
              {fieldNames.length > 5 && ` ${t('fertilizerReports.readiness.andMore', { count: fieldNames.length - 5 })}`}
            </p>
          )}
          {issues.length > 1 && fieldNames.length === 0 && <p className="text-xs text-muted mt-0.5">{t('fertilizerReports.readiness.occurrences', { count: issues.length })}</p>}
        </div>
      </div>
      <div className="shrink-0">
        {FIELD_MANAGER_CODES.has(code) && (
          <Link to="/o/$orgId/fields/manage" params={{ orgId }} variant="secondary" size="sm">
            {t('fertilizerReports.readiness.fixInFieldsManager')}
          </Link>
        )}
        {CULTIVATION_CODES.has(code) && (
          <Link to="/o/$orgId/crops" params={{ orgId }} variant="secondary" size="sm">
            {t('fertilizerReports.readiness.fixInCrops')}
          </Link>
        )}
        {FARM_DATA_CODES.has(code) && (
          <Button size="sm" onPress={onFixFarmData}>
            {t('fertilizerReports.readiness.fixInFarmData')}
          </Button>
        )}
        {REGION_CODES.has(code) && (
          <Button size="sm" onPress={onFixRegion}>
            {t('fertilizerReports.readiness.fixInRegion')}
          </Button>
        )}
      </div>
    </li>
  )
}
