import {
  type PsmAffectedPass,
  type PsmAttestations,
  type PsmAttestationsForm,
  type PsmAttestationsInput,
  type PsmIssueTargets,
  type PsmReadinessItem,
  type PsmReadinessSeverity,
  type PsmRecordFile,
  type PsmRecordFormat,
  type PsmRecordReadiness,
  type PsmRecordResult,
  validateAttestations,
} from '@agmeo/contracts'
import type { TFunction } from 'i18next'
import { ArrowRight, CheckCircle2, CircleX, Download, Info, RefreshCw, ScrollText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#/components/files/upload'
import { LOCALE } from '#/i18n'
import { api, errorMessage, saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, DatePicker, TextField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'

/**
 * The plant-protection record wizard (ported from agmeo's protection-reports): readiness check,
 * the farm's certificates, the record files. The record of EU 2023/564 is uniform across the
 * federal states, so unlike the fertilizer reports there is no state step.
 */
export const PSM_RECORD_STEPS = ['readiness', 'farm-data', 'record'] as const
export type PsmRecordStep = (typeof PSM_RECORD_STEPS)[number]

const SEVERITIES: PsmReadinessSeverity[] = ['blocking', 'warning', 'info']
const SEVERITY_ICON = { blocking: CircleX, warning: TriangleAlert, info: Info } as const
const SEVERITY_CLASS = { blocking: 'text-danger', warning: 'text-warning', info: 'text-muted' } as const

const readinessPath = '/protection/record/readiness'

/** Text of a readiness row; dates in its parameters are shown in the user's format. */
function ruleLabel(t: TFunction, item: Pick<PsmReadinessItem, 'code' | 'params'>) {
  const params = { ...item.params }
  if (typeof params.date === 'string') params.date = params.date ? fmt.date(params.date) : '—'
  return t(`psmRecord.rule.${item.code}`, { defaultValue: item.code, ...params })
}

// ---------------------------------------------------------------------------
// Step 1: readiness
// ---------------------------------------------------------------------------

export function ReadinessStep({ year, onFixFarmData, onContinue }: { year: number; onFixFarmData: (code: string) => void; onContinue: () => void }) {
  const { t } = useTranslation()
  const readiness = useOrgQuery<PsmRecordReadiness>(readinessPath, { year })
  const r = readiness.data
  if (readiness.isLoading) return <Loading />
  if (readiness.error || !r) return <ErrorNotice error={readiness.error} />

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('psmRecord.readiness.summary', { applications: r.applications, incomplete: r.incomplete })}</p>
      {r.applications === 0 ? (
        <Notice tone="info" icon={Info}>
          {t('psmRecord.readiness.noApplications', { year })}
        </Notice>
      ) : (
        r.items.length === 0 && (
          <Notice tone="success" icon={CheckCircle2}>
            {t('psmRecord.readiness.allClear')}
          </Notice>
        )
      )}

      {SEVERITIES.map((severity) => {
        const items = r.items.filter((i) => i.severity === severity)
        if (!items.length) return null
        return (
          <Card key={severity} title={t(`psmRecord.readiness.severity.${severity}`, { count: items.length })} padded={false}>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <ReadinessRuleRow key={item.code} item={item} year={year} onFixFarmData={onFixFarmData} />
              ))}
            </ul>
          </Card>
        )
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onPress={() => readiness.refetch()} isDisabled={readiness.isFetching}>
          <RefreshCw className={readiness.isFetching ? 'animate-spin' : undefined} /> {t('psmRecord.readiness.recheck')}
        </Button>
        <Button variant="primary" onPress={onContinue}>
          {t('psmRecord.continue')} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

/** One rule with the passes it concerns, each linked to where the gap is closed. */
function ReadinessRuleRow({ item, year, onFixFarmData }: { item: PsmReadinessItem; year: number; onFixFarmData: (code: string) => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hidden = item.count - item.affected.length
  // The readiness list carries the first passes; all of them are loaded on demand.
  const all = useOrgQuery<PsmIssueTargets>(`/protection/record/issues/${encodeURIComponent(item.code)}`, { year }, { enabled: expanded && hidden > 0 })
  const passes = expanded && all.data ? all.data.passes : item.affected
  const Icon = SEVERITY_ICON[item.severity]

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className={cx('mt-0.5 size-4 shrink-0', SEVERITY_CLASS[item.severity])} aria-hidden />
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-medium">{ruleLabel(t, item)}</p>
          {passes.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {passes.map((pass) => (
                <PassLink key={pass.passId} pass={pass} toField={item.fix === 'fieldsManager'} />
              ))}
              {hidden > 0 && !expanded && (
                <button type="button" className="text-primary hover:underline underline-offset-2 cursor-pointer" onClick={() => setExpanded(true)}>
                  {t('psmRecord.readiness.andMore', { count: hidden })}
                </button>
              )}
              {expanded && all.isLoading && <span>{t('common.loading')}</span>}
            </p>
          )}
        </div>
      </div>
      {item.fix === 'farmData' && (
        <Button size="sm" className="shrink-0" onPress={() => onFixFarmData(item.code)}>
          {t('psmRecord.readiness.fixInFarmData')}
        </Button>
      )}
    </li>
  )
}

/** A pass as "Field · date", linked to its operation or, for field data, to the field. */
function PassLink({ pass, toField }: { pass: PsmAffectedPass; toField: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const label = [pass.fieldName ?? t('psmRecord.pass.unnamed'), pass.date ? fmt.date(pass.date) : null].filter(Boolean).join(' · ')
  if (toField && pass.fieldId)
    return (
      <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: pass.fieldId }} className="text-xs">
        {label}
      </Link>
    )
  return (
    <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: pass.operationId }} className="text-xs">
      <span title={pass.detail}>{label}</span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Step 2: farm data (Sachkundenachweis, sprayer inspection)
// ---------------------------------------------------------------------------

type FormKey = keyof PsmAttestationsInput

const FIELDS: { key: FormKey; kind: 'text' | 'date' }[] = [
  { key: 'certificateNumber', kind: 'text' },
  { key: 'certificateHolder', kind: 'text' },
  { key: 'certificateValidUntil', kind: 'date' },
  { key: 'sprayerInspectionNumber', kind: 'text' },
  { key: 'sprayerInspectedOn', kind: 'date' },
]

/** The inputs that close each farm-data row of the readiness check. */
const ISSUE_FIELDS: Record<string, FormKey[]> = {
  sachkunde_missing: ['certificateNumber', 'certificateHolder', 'certificateValidUntil'],
  sachkunde_unknown: ['certificateValidUntil'],
  sachkunde_expired: ['certificateValidUntil'],
  sachkunde_expiring: ['certificateValidUntil'],
  sprayer_missing: ['sprayerInspectionNumber', 'sprayerInspectedOn'],
  sprayer_unknown: ['sprayerInspectedOn'],
  sprayer_overdue: ['sprayerInspectedOn'],
}

export function FarmDataStep({ year, issueCode, onContinue }: { year: number; issueCode: string | undefined; onContinue: () => void }) {
  const data = useOrgQuery<PsmAttestations>('/protection/attestations')
  if (data.isLoading) return <Loading />
  if (data.error || !data.data) return <ErrorNotice error={data.error} />
  return <FarmDataForm saved={data.data} year={year} issueCode={issueCode} onContinue={onContinue} />
}

function FarmDataForm({ saved, year, issueCode, onContinue }: { saved: PsmAttestations; year: number; issueCode: string | undefined; onContinue: () => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const editable = can('farm.write')
  const readiness = useOrgQuery<PsmRecordReadiness>(readinessPath, { year })
  const [draft, setDraft] = useState<PsmAttestationsForm | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const form: PsmAttestationsForm = draft ?? saved
  const errors = validateAttestations(form, new Date())
  const invalid = Object.keys(errors).length > 0
  // Shade the inputs of the row the user came from, until the saved values clear it.
  const issueOpen = !!issueCode && !!readiness.data?.items.some((i) => i.code === issueCode)
  const highlighted = (issueOpen && ISSUE_FIELDS[issueCode]) || []

  const save = useOrgMutation((base, input: PsmAttestationsInput) => api.put<PsmAttestations>(`${base}/protection/attestations`, input), {
    success: t('psmRecord.farmData.saved'),
    onSuccess: () => {
      setDraft(null)
      setSubmitted(false)
    },
  })
  const input = (): PsmAttestationsInput => Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key]?.trim() || null]))
  const submit = (then?: () => void) => {
    if (invalid) return setSubmitted(true)
    save.mutate(input(), { onSuccess: () => then?.() })
  }
  const next = () => (draft && editable ? submit(onContinue) : onContinue())
  const patch = (key: FormKey, value: string | null) => setDraft({ ...form, [key]: value })
  const error = (key: FormKey) => (submitted && errors[key] ? t(`psmRecord.farmData.error.${errors[key]}`) : undefined)

  return (
    <div className="space-y-4">
      {!editable && (
        <Notice tone="info" icon={Info}>
          {t('psmRecord.farmData.readOnly')}
        </Notice>
      )}
      <Card title={t('psmRecord.farmData.title')} description={t('psmRecord.farmData.hint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const className = cx(highlighted.includes(f.key) && 'rounded-md bg-danger-soft ring-4 ring-danger-soft')
            const label = t(`psmRecord.farmData.field.${f.key}`)
            return f.kind === 'text' ? (
              <TextField
                key={f.key}
                label={label}
                value={form[f.key] ?? ''}
                onChange={(v) => patch(f.key, v)}
                isInvalid={!!error(f.key)}
                errorMessage={error(f.key)}
                isReadOnly={!editable}
                autoFocus={f.key === highlighted[0]}
                className={className}
              />
            ) : (
              <DatePicker
                key={f.key}
                label={label}
                value={form[f.key] ?? null}
                onChange={(v) => patch(f.key, v)}
                // The date picker has no invalid state of its own; the message shows as its description.
                description={error(f.key) && <span className="text-danger">{error(f.key)}</span>}
                isDisabled={!editable}
                className={className}
              />
            )
          })}
        </div>
        {editable && (
          <div className="mt-4">
            <Button onPress={() => submit()} isPending={save.isPending} isDisabled={!draft}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Card>
      <div className="flex justify-end">
        <Button variant="primary" onPress={next} isDisabled={save.isPending}>
          {t('psmRecord.continue')} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3: the record files and their history
// ---------------------------------------------------------------------------

/**
 * Generates the record on the server, archives it under Files > Exports and hands the same
 * bytes to the browser. Gaps block the file unless the user opts in; a failed archive write is
 * said out loud.
 */
export function RecordStep({ year }: { year: number }) {
  const { t } = useTranslation()
  const readiness = useOrgQuery<PsmRecordReadiness>(readinessPath, { year })
  const [includeIncomplete, setIncludeIncomplete] = useState(false)
  const generate = useOrgMutation((base, format: PsmRecordFormat) => api.post<PsmRecordResult>(`${base}/protection/record`, { year, format, includeIncomplete }), {
    silentError: true,
    onSuccess: (result) => {
      saveBlob(new Blob([result.body], { type: `${result.mimeType};charset=utf-8` }), result.filename)
      if (result.archived) toast.success(t('psmRecord.download.success'))
      else toast.error(t('psmRecord.download.archiveFailed'))
    },
  })

  const r = readiness.data
  const incomplete = r?.incomplete ?? 0
  const noApplications = !!r && r.applications === 0
  const blocked = !r || noApplications || (incomplete > 0 && !includeIncomplete)
  const run = (format: PsmRecordFormat) => generate.mutate(format, { onError: (e) => toast.error(t('psmRecord.download.failed'), errorMessage(e)) })

  return (
    <div className="space-y-4">
      {readiness.isLoading && <Loading label={t('psmRecord.download.checking')} />}
      {readiness.error && <ErrorNotice error={readiness.error} />}
      {noApplications && (
        <Notice tone="info" icon={Info}>
          {t('psmRecord.readiness.noApplications', { year })}
        </Notice>
      )}
      {incomplete > 0 && (
        <Notice tone="danger" icon={TriangleAlert}>
          <p>{t('psmRecord.download.fixFirst', { count: incomplete })}</p>
          <Checkbox className="mt-2" isSelected={includeIncomplete} onChange={setIncludeIncomplete}>
            {t('psmRecord.download.generateAnyway')}
          </Checkbox>
        </Notice>
      )}

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <ScrollText className="size-4" aria-hidden /> {t('psmRecord.download.title', { year })}
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('psmRecord.download.legalNote')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onPress={() => run('csv')} isDisabled={blocked || generate.isPending} isPending={generate.isPending && generate.variables === 'csv'}>
              <Download /> {t('psmRecord.download.csv')}
            </Button>
            <Button onPress={() => run('json')} isDisabled={blocked || generate.isPending} isPending={generate.isPending && generate.variables === 'json'}>
              <Download /> {t('psmRecord.download.json')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('psmRecord.download.hint', { year })}</p>
        </div>
      </Card>

      <RecordHistory year={year} />
    </div>
  )
}

/** The archived records of the year — the audit trail an on-site inspection asks for. */
function RecordHistory({ year }: { year: number }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const history = useOrgQuery<PsmRecordFile[]>('/protection/record/history', { year })
  const download = (file: PsmRecordFile) => api.download(`/orgs/${orgId}/files/${file.id}/content`, undefined, file.name).catch((e) => toast.error(t('psmRecord.download.failed'), errorMessage(e)))

  return (
    <Card title={t('psmRecord.history.title')} padded={false}>
      {history.isLoading ? (
        <Loading />
      ) : history.error ? (
        <ErrorNotice error={history.error} className="m-4" />
      ) : !history.data?.length ? (
        <p className="p-4 text-sm text-muted">{t('psmRecord.history.empty', { year })}</p>
      ) : (
        <Table aria-label={t('psmRecord.history.title')}>
          <TableHeader>
            <Column isRowHeader>{t('psmRecord.history.created')}</Column>
            <Column>{t('psmRecord.history.file')}</Column>
            <Column align="end">{t('psmRecord.history.size')}</Column>
            <Column align="end">
              <span className="sr-only">{t('common.download')}</span>
            </Column>
          </TableHeader>
          <TableBody items={history.data}>
            {(file) => (
              <Row id={file.id}>
                <Cell className="whitespace-nowrap">{fmt.dateTime(file.createdAt)}</Cell>
                <Cell className="font-mono text-xs">{file.name}</Cell>
                <Cell align="end" className="tabular">
                  {formatBytes(file.sizeBytes, LOCALE)}
                </Cell>
                <Cell align="end">
                  <Button size="icon-sm" variant="ghost" aria-label={t('common.download')} onPress={() => void download(file)}>
                    <Download />
                  </Button>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
