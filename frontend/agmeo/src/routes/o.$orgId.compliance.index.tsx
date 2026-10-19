import type { ComplianceIssue, ComplianceReport, Farm } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileWarning, Info, OctagonAlert, ScrollText, ShieldCheck, Tractor } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { z } from 'zod'
import { AnnualTotalsTab } from '#/components/compliance/AnnualTotals'
import { ExportsTab } from '#/components/compliance/Exports'
import { FarmRegulatoryTab } from '#/components/compliance/FarmRegulatoryForm'
import { N170Tab } from '#/components/compliance/N170'
import { useDefaultYear } from '#/components/compliance/shared'
import { OperationTypeLabel } from '#/components/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

const TABS = ['records', 'farm', 'annual', 'n170', 'exports'] as const
type ComplianceTab = (typeof TABS)[number]

export const Route = createFileRoute('/o/$orgId/compliance/')({
  // Farm and year are kept in the URL so the regulatory tabs and the printed report share them.
  validateSearch: z.object({ tab: z.enum(TABS).optional(), farmId: z.string().optional(), year: z.number().int().optional() }),
  component: CompliancePage,
})

type SeverityFilter = 'all' | ComplianceIssue['severity']

function SeverityBadge({ severity }: { severity: ComplianceIssue['severity'] }) {
  const { t } = useTranslation()
  return severity === 'error' ? (
    <Badge tone="danger">
      <OctagonAlert className="size-3" aria-hidden />
      {t('compliance.severity.error')}
    </Badge>
  ) : (
    <Badge tone="warning">
      <AlertTriangle className="size-3" aria-hidden />
      {t('compliance.severity.warning')}
    </Badge>
  )
}

function CompliancePage() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { season } = useSeason()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const tab = search.tab ?? 'records'
  return (
    <>
      <PageHeader
        title={t('compliance.title')}
        subtitle={season ? t('compliance.subtitleSeason', { season: season.harvestYear }) : t('compliance.subtitle')}
        actions={
          <>
            <Link to="/o/$orgId/compliance/psm-record" params={{ orgId }} variant="secondary">
              <ScrollText /> {t('psmRecord.title')}
            </Link>
            {tab === 'records' && <ExportRecordsButton />}
          </>
        }
      />
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => navigate({ search: (s) => ({ ...s, tab: key === 'records' ? undefined : (key as ComplianceTab) }), replace: true })}
      >
        <TabList aria-label={t('regulatory.tabs.label')}>
          <Tab id="records">{t('regulatory.tabs.records')}</Tab>
          <Tab id="farm">{t('regulatory.tabs.farm')}</Tab>
          <Tab id="annual">{t('regulatory.tabs.annual')}</Tab>
          <Tab id="n170">{t('regulatory.tabs.n170')}</Tab>
          <Tab id="exports">{t('regulatory.tabs.exports')}</Tab>
        </TabList>
        <TabPanel id="records">
          <RecordsTab />
        </TabPanel>
        <TabPanel id="farm">
          <FarmScope>{(farmId) => <FarmRegulatoryTab farmId={farmId} />}</FarmScope>
        </TabPanel>
        <TabPanel id="annual">
          <FarmScope withYear>{(farmId, year) => <AnnualTotalsTab farmId={farmId} year={year} />}</FarmScope>
        </TabPanel>
        <TabPanel id="n170">
          <FarmScope withYear>{(farmId, year) => <N170Tab farmId={farmId} year={year} />}</FarmScope>
        </TabPanel>
        <TabPanel id="exports">
          <FarmScope withYear>{(farmId, year) => <ExportsTab farmId={farmId} year={year} />}</FarmScope>
        </TabPanel>
      </Tabs>
    </>
  )
}

/**
 * Farm (when there is more than one) and fertilizer year for the regulatory tabs. The farm
 * defaults to the first active one, the year to the working season's harvest year.
 */
function FarmScope({ withYear, children }: { withYear?: boolean; children: (farmId: string, year: number) => ReactNode }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasons } = useSeason()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const farms = useOrgQuery<Farm[]>('/farms')
  const defaultYear = useDefaultYear()

  if (farms.isLoading) return <Loading />
  if (farms.error) return <ErrorNotice error={farms.error} />
  const list = (farms.data ?? []).filter((f) => !f.archivedAt)
  if (list.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Tractor}
          title={t('fields.new.noFarm.title')}
          action={
            <Link to="/o/$orgId/settings" params={{ orgId }} variant="primary">
              {t('fields.new.noFarm.action')}
            </Link>
          }
        >
          {t('regulatory.noFarm')}
        </EmptyState>
      </Card>
    )

  const farmId = list.some((f) => f.id === search.farmId) ? search.farmId! : list[0].id
  const year = search.year ?? defaultYear
  const years = [...new Set([...seasons.map((s) => s.harvestYear), defaultYear, year])].sort((a, b) => b - a)
  return (
    <div className="space-y-6">
      {(list.length > 1 || withYear) && (
        <div className="flex flex-wrap items-end gap-4">
          {list.length > 1 && (
            <Select
              label={t('regulatory.scope.farm')}
              items={list}
              value={farmId}
              onChange={(v) => v && navigate({ search: (s) => ({ ...s, farmId: String(v) }), replace: true })}
              className="w-64"
            >
              {(f) => <Option id={f.id}>{f.name}</Option>}
            </Select>
          )}
          {withYear && (
            <Select
              label={t('regulatory.scope.year')}
              items={years.map((y) => ({ id: y, name: String(y) }))}
              value={year}
              onChange={(v) => v != null && navigate({ search: (s) => ({ ...s, year: v === defaultYear ? undefined : Number(v) }), replace: true })}
              className="w-40"
            >
              {(y) => <Option id={y.id}>{y.name}</Option>}
            </Select>
          )}
        </div>
      )}
      {children(farmId, year)}
    </div>
  )
}

function ExportRecordsButton() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasonId } = useSeason()
  const report = useOrgQuery<ComplianceReport>('/compliance/report', { seasonId })
  const [exporting, setExporting] = useState(false)

  const exportCsv = async () => {
    setExporting(true)
    try {
      await api.download(`/orgs/${orgId}/compliance/application-records.csv`, { seasonId })
    } catch (e) {
      toast.error(t('compliance.exportFailed'), errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Button onPress={exportCsv} isPending={exporting} isDisabled={!report.data || report.data.checkedOperations === 0}>
      {!exporting && <Download />} {t('compliance.export')}
    </Button>
  )
}

/** Title of an issue code (`compliance.code.<code>`, including `closed_period` and `psm.<code>`); null for unknown codes. */
function useIssueTitle() {
  const { t, i18n } = useTranslation()
  return (code: string) => (i18n.exists(`compliance.code.${code}`) ? t(`compliance.code.${code}`) : null)
}

function RecordsTab() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasonId, season } = useSeason()
  const report = useOrgQuery<ComplianceReport>('/compliance/report', { seasonId })
  const [filter, setFilter] = useState<SeverityFilter>('all')
  const issueTitle = useIssueTitle()

  const r = report.data
  const issues = r?.issues ?? []
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  const visible = (filter === 'all' ? issues : issues.filter((i) => i.severity === filter)).sort(
    (a, b) => (a.severity === b.severity ? (b.performedAt ?? '').localeCompare(a.performedAt ?? '') : a.severity === 'error' ? -1 : 1),
  )

  return report.isLoading ? (
    <Loading />
  ) : report.error ? (
    <ErrorNotice error={report.error} />
  ) : r ? (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat icon={ClipboardCheck} label={t('compliance.stat.checked')} value={fmt.num(r.checkedOperations)} hint={t('compliance.stat.checkedHint')} />
        <Stat
          icon={CheckCircle2}
          label={t('compliance.stat.complete')}
          value={fmt.num(r.completeOperations)}
          hint={r.checkedOperations ? t('compliance.stat.completeHint', { pct: fmt.num((r.completeOperations / r.checkedOperations) * 100) }) : t('compliance.stat.nothingToCheck')}
          tone="success"
        />
        <Stat
          icon={FileWarning}
          label={t('compliance.issues')}
          value={fmt.num(issues.length)}
          hint={t('compliance.stat.issuesHint', { errors: t('compliance.errorCount', { count: errors }), warnings: t('compliance.warningCount', { count: warnings }) })}
          tone={errors ? 'danger' : warnings ? 'warning' : 'success'}
        />
      </div>

      <Notice tone="info" icon={Info}>
        <p>
          <Trans i18nKey="compliance.notice.body" components={{ b: <strong /> }} />
        </p>
        <p className="mt-1.5 text-xs text-muted">
          <Trans i18nKey="compliance.notice.ruleset" values={{ ruleset: r.ruleset }} components={{ code: <span className="font-mono text-fg-2" /> }} />
        </p>
      </Notice>

      <Card
        title={t('compliance.issues')}
        description={issues.length ? t('compliance.issuesDescription') : undefined}
        padded={false}
        actions={
          issues.length > 0 && (
            <SegmentedControl
              aria-label={t('compliance.filter')}
              value={filter}
              onChange={setFilter}
              items={[
                { id: 'all', label: t('compliance.filter.all', { n: issues.length }) },
                { id: 'error', label: t('compliance.filter.errors', { n: errors }) },
                { id: 'warning', label: t('compliance.filter.warnings', { n: warnings }) },
              ]}
            />
          )
        }
      >
        {issues.length === 0 ? (
          r.checkedOperations === 0 ? (
            <EmptyState icon={ClipboardCheck} title={t('compliance.empty.noApplications.title')}>
              {t('compliance.empty.noApplications.body', { season: season?.name ?? t('compliance.thisSeason') })}
            </EmptyState>
          ) : (
            <EmptyState icon={ShieldCheck} title={t('compliance.empty.complete.title')}>
              {t('compliance.empty.complete.body', { count: r.checkedOperations })}
            </EmptyState>
          )
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('compliance.noIssuesWithSeverity')}</p>
        ) : (
          <Table aria-label={t('compliance.table')}>
            <TableHeader>
              <Column>{t('compliance.col.severity')}</Column>
              <Column isRowHeader>{t('operations.operation')}</Column>
              <Column>{t('common.type')}</Column>
              <Column>{t('common.date')}</Column>
              <Column>{t('operations.fields')}</Column>
              <Column>{t('compliance.col.issue')}</Column>
            </TableHeader>
            <TableBody items={visible.map((i, n) => ({ ...i, id: `${i.operationId}:${i.code}:${n}` }))}>
              {(i) => {
                const title = issueTitle(i.code)
                return (
                  <Row id={i.id}>
                    <Cell>
                      <SeverityBadge severity={i.severity} />
                    </Cell>
                    <Cell>
                      <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: i.operationId }} className="font-medium">
                        {i.operationTitle}
                      </Link>
                    </Cell>
                    <Cell>
                      <OperationTypeLabel type={i.operationType} className="whitespace-nowrap" />
                    </Cell>
                    <Cell className="whitespace-nowrap tabular">{fmt.date(i.performedAt)}</Cell>
                    <Cell className="min-w-40 text-fg-2">{i.fieldNames.length ? i.fieldNames.join(', ') : <span className="text-muted">—</span>}</Cell>
                    <Cell className="min-w-56">
                      {title ? (
                        <>
                          <div className="font-medium">{title}</div>
                          <div className="text-xs text-muted">{i.message}</div>
                        </>
                      ) : (
                        i.message
                      )}
                    </Cell>
                  </Row>
                )
              }}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  ) : null
}
