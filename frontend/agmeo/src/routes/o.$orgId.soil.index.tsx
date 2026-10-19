import { HEADLINE_PARAMS, type SoilFieldRow } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FlaskConical, Hash, Layers, Map as MapIcon } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Selection } from 'react-aria-components'
import { z } from 'zod'
import { BatchZonationDialog } from '#/components/soil/BatchZonationDialog'
import { AnalysisDashboard } from '#/components/soil/AnalysisDashboard'
import { ExportDialog } from '#/components/soil/ExportDialog'
import { HistoryStatesDialog, LabImports } from '#/components/soil/HistoryStatesDialog'
import { ShareDialog, SharesList } from '#/components/soil/ShareDialog'
import { UploadLabResultsDialog } from '#/components/soil/UploadLabResultsDialog'
import { methodLabel, paramLabel, paramValue, statusText } from '#/components/soil/soilLabels'
import { SelectionBar, selectedIds } from '#/components/table/tableTools'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, NumberField, SearchField, num } from '#/ui/Field'
import { Badge, Card, ErrorNotice, Loading, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

const TABS = ['overview', 'analysis', 'imports', 'shares'] as const
type SoilTabId = (typeof TABS)[number]

export const Route = createFileRoute('/o/$orgId/soil/')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: SoilPage,
})

function SoilPage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const [labOpen, setLabOpen] = useState(false)
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const tabs: { id: SoilTabId; label: string; panel: ReactNode }[] = [
    { id: 'overview', label: t('soil.page.tab.overview'), panel: <Overview /> },
    { id: 'analysis', label: t('soil.page.tab.analysis'), panel: <AnalysisDashboard /> },
    { id: 'imports', label: t('soil.page.tab.imports'), panel: <LabImports /> },
    { id: 'shares', label: t('soil.page.tab.shares'), panel: <SharesList /> },
  ]
  return (
    <>
      <PageHeader
        title={t('soil.page.title')}
        subtitle={t('soil.page.subtitle')}
        actions={
          can('field.write') && (
            <Button variant="primary" onPress={() => setLabOpen(true)}>
              <FlaskConical /> {t('soil.lab.button')}
            </Button>
          )
        }
      />
      <UploadLabResultsDialog isOpen={labOpen} onOpenChange={setLabOpen} />
      <Tabs selectedKey={search.tab ?? 'overview'} onSelectionChange={(key) => navigate({ search: { tab: key === 'overview' ? undefined : (key as SoilTabId) }, replace: true })}>
        <TabList aria-label={t('soil.page.tabs')}>
          {tabs.map((tab) => (
            <Tab key={tab.id} id={tab.id}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {tabs.map((tab) => (
          <TabPanel key={tab.id} id={tab.id}>
            {tab.panel}
          </TabPanel>
        ))}
      </Tabs>
    </>
  )
}

function Overview() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const navigate = useNavigate()
  const rows = useOrgQuery<SoilFieldRow[]>('/soil/fields', undefined, {
    refetchInterval: (data) => (data?.some((r) => r.pending?.status === 'queued' || r.pending?.status === 'running') ? 4_000 : false),
  })
  const [selection, setSelection] = useState<Selection>(new Set())
  const [query, setQuery] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [numbersOpen, setNumbersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const writable = can('field.write')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows.data ?? []).filter((r) => !q || r.fieldName.toLowerCase().includes(q) || r.farmName.toLowerCase().includes(q)).map((r) => ({ ...r, id: r.fieldId }))
  }, [rows.data, query])
  const selected = useMemo(() => {
    const ids = selectedIds(selection, shown)
    return shown.filter((r) => ids.has(r.id))
  }, [selection, shown])

  if (rows.isLoading) return <Loading />
  if (rows.error) return <ErrorNotice error={rows.error} />
  const all = rows.data ?? []
  const zoned = all.filter((r) => r.zonation)
  const sampled = all.filter((r) => r.sampledOn)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={MapIcon} label={t('soil.page.stat.fields')} value={fmt.num(all.length)} hint={fmt.ha(all.reduce((s, r) => s + r.areaHa, 0))} />
        <Stat icon={Layers} label={t('soil.page.stat.zoned')} value={fmt.num(zoned.length)} hint={t('soil.page.stat.zones', { count: zoned.reduce((s, r) => s + (r.zonation?.zoneCount ?? 0), 0) })} />
        <Stat icon={Hash} label={t('soil.page.stat.probes')} value={fmt.num(all.reduce((s, r) => s + r.probes, 0))} />
        <Stat label={t('soil.page.stat.sampled')} value={fmt.num(sampled.length)} hint={t('soil.page.stat.sampledHint')} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label={t('soil.page.search')} value={query} onChange={setQuery} className="w-64" />
      </div>

      <Card padded={false}>
        <Table aria-label={t('soil.page.title')} selectionMode={writable ? 'multiple' : 'none'} selectedKeys={selection} onSelectionChange={setSelection} onRowAction={(key) => navigate({ to: '/o/$orgId/soil/$fieldId', params: { orgId, fieldId: String(key) } })}>
          <TableHeader>
            {writable && (
              <Column className="w-10">
                <Checkbox slot="selection" />
              </Column>
            )}
            <Column isRowHeader>{t('soil.page.field')}</Column>
            <Column align="end">{t('soil.col.size')}</Column>
            <Column>{t('soil.col.zonation')}</Column>
            <Column align="end">{t('soil.page.col.probes')}</Column>
            <Column>{t('soil.page.col.sampledOn')}</Column>
            {HEADLINE_PARAMS.map((p) => (
              <Column key={p} align="end">
                {paramLabel(p)}
              </Column>
            ))}
          </TableHeader>
          <TableBody items={shown} renderEmptyState={() => <div className="py-10 text-center text-sm text-muted">{t('soil.page.empty')}</div>}>
            {(r) => (
              <Row id={r.id}>
                {writable && (
                  <Cell>
                    <Checkbox slot="selection" />
                  </Cell>
                )}
                <Cell>
                  <span className="font-medium">{r.fieldName}</span>
                  <span className="block text-xs text-muted">{r.farmName}</span>
                </Cell>
                <Cell align="end">{fmt.ha(r.areaHa)}</Cell>
                <Cell>
                  <ZonationCell row={r} />
                </Cell>
                <Cell align="end">{r.probes ? fmt.num(r.probes) : '—'}</Cell>
                <Cell>{fmt.date(r.sampledOn)}</Cell>
                {HEADLINE_PARAMS.map((p) => (
                  <Cell key={p} align="end">
                    {paramValue(p, r.means[p])}
                  </Cell>
                ))}
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>

      <SelectionBar count={selected.length} onClear={() => setSelection(new Set())}>
        <Button size="sm" variant="primary" onPress={() => setBatchOpen(true)}>
          {t('soil.batch.button', { count: selected.length })}
        </Button>
        <Button size="sm" onPress={() => setNumbersOpen(true)} isDisabled={!selected.some((r) => r.zonation)}>
          {t('soil.page.assignNumbers')}
        </Button>
        <Button size="sm" onPress={() => setExportOpen(true)}>
          {t('soil.export.button', { count: selected.length })}
        </Button>
        <Button size="sm" onPress={() => setShareOpen(true)}>
          {t('soil.share.button')}
        </Button>
        <Button size="sm" onPress={() => setHistoryOpen(true)}>
          {t('soil.history.bulk.button', { count: selected.length })}
        </Button>
      </SelectionBar>

      <BatchZonationDialog
        isOpen={batchOpen}
        onOpenChange={setBatchOpen}
        fields={selected.map((r) => ({ fieldId: r.fieldId, fieldName: r.fieldName, areaHa: r.areaHa, hasZonation: !!r.zonation }))}
      />
      <ShareDialog isOpen={shareOpen} onOpenChange={setShareOpen} fieldIds={selected.map((r) => r.fieldId)} />
      <HistoryStatesDialog isOpen={historyOpen} onOpenChange={setHistoryOpen} fieldIds={selected.map((r) => r.fieldId)} />
      <ExportDialog isOpen={exportOpen} onOpenChange={setExportOpen} fieldIds={selected.map((r) => r.fieldId)} />
      <ProbeNumbersDialog isOpen={numbersOpen} onOpenChange={setNumbersOpen} fieldIds={selected.filter((r) => r.zonation).map((r) => r.fieldId)} />
    </div>
  )
}

function ZonationCell({ row }: { row: SoilFieldRow }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.zonation ? (
        <span>
          {methodLabel(row.zonation.method)} · {t('soil.batch.successZones', { count: row.zonation.zoneCount })}
        </span>
      ) : (
        <span className="text-muted">{t('soil.page.noZonation')}</span>
      )}
      {row.pending?.status === 'queued' || row.pending?.status === 'running' ? (
        <Badge tone="info">{t(`soil.batch.${row.pending.status === 'queued' ? 'pending' : 'running'}`)}</Badge>
      ) : row.pending?.status === 'failed' ? (
        <Badge tone="danger">{statusText(row.pending.statusCode)}</Badge>
      ) : null}
    </div>
  )
}

/** Probe numbers continue after the highest in use, or start at a chosen number. */
function ProbeNumbersDialog({ isOpen, onOpenChange, fieldIds }: { isOpen: boolean; onOpenChange: (open: boolean) => void; fieldIds: string[] }) {
  const { t } = useTranslation()
  const [start, setStart] = useState<number | null>(null)
  const assign = useOrgMutation((base, _: void) => api.post<{ probeNr: number }[]>(`${base}/soil/probe-numbers`, { fieldIds, start }), {
    success: (r) => t('soil.page.numbersAssigned', { count: r.length }),
    onSuccess: () => onOpenChange(false),
  })
  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t('soil.page.assignNumbers')}
      description={t('soil.page.assignNumbersHint')}
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onPress={() => assign.mutate()} isPending={assign.isPending}>
            {t('soil.page.assign')}
          </Button>
        </>
      )}
    >
      <NumberField label={t('soil.export.sampleCard.startProbeNr')} description={t('soil.page.startHint')} minValue={1} value={start ?? NaN} onChange={(v) => setStart(num(v))} />
    </ModalDialog>
  )
}
