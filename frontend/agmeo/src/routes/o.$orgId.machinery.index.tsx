import { EQUIPMENT_GONE_STATUSES, type Equipment, type EquipmentClass, type Farm } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { CalendarClock, Clock, Plus, Tractor, Wrench } from 'lucide-react'
import { ActionCatalogue } from '#/components/resources/actions'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EquipmentDialog, EquipmentIcon, EquipmentStatusBadge, NextMaintenance, SciBadge, equipmentCategoryLabel } from '#/components/resources/equipment'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { SearchField, Switch } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/machinery/')({ component: MachineryPage })

type StatusFilter = 'all' | 'in_use' | 'gone'
const gone = (e: Equipment) => EQUIPMENT_GONE_STATUSES.includes(e.status) || e.archivedAt != null

function MachineryPage() {
  const { t } = useTranslation()
  const { orgId, org, can } = useOrg()
  const canWrite = can('machinery.write')
  const [showArchived, setShowArchived] = useState(false)
  const equipment = useOrgQuery<Equipment[]>('/equipment', { includeArchived: showArchived || undefined })
  const farms = useOrgQuery<Farm[]>('/farms')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('in_use')
  const [tab, setTab] = useState<EquipmentClass | 'actions'>('machine')

  const all = equipment.data ?? []
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((e) => e.class === tab)
      .filter((e) => status === 'all' || (status === 'gone') === gone(e))
      .filter((e) => !q || [e.name, e.manufacturer, e.model, e.registration, e.serialNumber, e.inventoryNumber, equipmentCategoryLabel(e)].some((s) => s?.toLowerCase().includes(q)))
      .sort((a, b) => Number(gone(a)) - Number(gone(b)) || a.name.localeCompare(b.name))
  }, [all, search, status, tab])

  const inUse = all.filter((e) => !gone(e))
  const hoursThisYear = inUse.reduce((s, e) => s + e.hoursThisYear, 0)
  const maintenanceCost = all.reduce((s, e) => s + e.maintenanceCostThisYear, 0)
  const overdue = inUse.filter((e) => e.nextMaintenance?.overdue).length
  const scheduled = inUse.filter((e) => e.nextMaintenance && (e.nextMaintenance.dueOn || e.nextMaintenance.dueHours != null)).length
  const farmName = (id: string | null) => (farms.data && farms.data.length > 1 ? farms.data.find((f) => f.id === id)?.name : undefined)

  const addButton = canWrite && tab !== 'actions' && (
    <EquipmentDialog
      key={tab}
      defaultClass={tab}
      trigger={
        <Button variant="primary">
          <Plus /> {tab === 'machine' ? t('machinery.addMachine') : t('machinery.addImplement')}
        </Button>
      }
    />
  )

  return (
    <>
      <PageHeader title={t('machinery.title')} subtitle={t('machinery.subtitle')} actions={addButton} />

      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as EquipmentClass | 'actions')} className="mb-6">
        <TabList aria-label={t('machinery.title')}>
          <Tab id="machine">{t('machinery.tabs.machines', { count: all.filter((e) => e.class === 'machine' && !gone(e)).length })}</Tab>
          <Tab id="implement">{t('machinery.tabs.implements', { count: all.filter((e) => e.class === 'implement' && !gone(e)).length })}</Tab>
          <Tab id="actions">{t('machinery.tabs.actions')}</Tab>
        </TabList>
        <TabPanel id="actions">
          <ActionCatalogue />
        </TabPanel>
        <TabPanel id="machine" className="hidden" />
        <TabPanel id="implement" className="hidden" />
      </Tabs>

      {tab === 'actions' ? null : equipment.isLoading ? (
        <Loading />
      ) : equipment.error ? (
        <ErrorNotice error={equipment.error} />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState icon={Tractor} title={t('machinery.empty.title')} action={addButton}>
            {t('machinery.empty.text')}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <Stat icon={Tractor} label={t('machinery.stats.inUse')} value={fmt.num(inUse.length)} hint={all.length > inUse.length ? t('machinery.stats.gone', { count: all.length - inUse.length }) : undefined} />
            <Stat icon={Clock} label={t('machinery.stats.hoursThisYear')} value={`${fmt.num(hoursThisYear, 1)} h`} hint={t('machinery.stats.hoursThisYearHint')} />
            <Stat icon={Wrench} label={t('machinery.stats.maintenanceThisYear')} value={fmt.money(maintenanceCost, org.currency)} />
            <Stat
              icon={CalendarClock}
              label={t('machinery.stats.serviceOverdue')}
              value={fmt.num(overdue)}
              hint={t('machinery.stats.scheduled', { count: scheduled })}
              tone={overdue ? 'danger' : 'success'}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <SearchField placeholder={t('machinery.search')} value={search} onChange={setSearch} className="flex-1 min-w-56 max-w-md" />
            <div className="overflow-x-auto max-w-full">
              <SegmentedControl<StatusFilter>
                aria-label={t('common.status')}
                value={status}
                onChange={setStatus}
                items={[
                  { id: 'in_use', label: t('machinery.filter.inUse') },
                  { id: 'gone', label: t('machinery.filter.gone') },
                  { id: 'all', label: t('machinery.filter.all') },
                ]}
              />
            </div>
            <Switch isSelected={showArchived} onChange={setShowArchived}>
              {t('machinery.showArchived')}
            </Switch>
          </div>

          {visible.length === 0 ? (
            <Card>
              <p className="text-sm text-muted text-center py-6">{t('machinery.noMatches')}</p>
            </Card>
          ) : (
            <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-label={t('machinery.listLabel')}>
              {visible.map((e) => (
                <li key={e.id}>
                  <EquipmentCard equipment={e} orgId={orgId} currency={org.currency} farmName={farmName(e.farmId)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function EquipmentCard({ equipment: e, orgId, currency, farmName }: { equipment: Equipment; orgId: string; currency: string; farmName?: string }) {
  const { t } = useTranslation()
  const details = [e.manufacturer, e.model, e.modelYear && String(e.modelYear)].filter(Boolean).join(' · ')
  return (
    <article
      className={cx(
        'relative h-full rounded-xl border bg-surface p-4 shadow-xs flex flex-col gap-4 transition-colors hover:border-line-strong hover:bg-surface-2/40',
        e.nextMaintenance?.overdue && !gone(e) ? 'border-danger/40' : 'border-line',
        gone(e) && 'opacity-75',
      )}
    >
      <header className="flex items-start gap-3">
        <EquipmentIcon kind={e.kind} />
        <div className="min-w-0 flex-1">
          <Link
            to="/o/$orgId/machinery/$equipmentId"
            params={{ orgId, equipmentId: e.id }}
            className="block font-semibold truncate after:absolute after:inset-0 after:rounded-xl"
          >
            {e.name}
          </Link>
          <div className="text-xs text-muted truncate mt-0.5">
            {equipmentCategoryLabel(e)}
            {e.workingWidthM != null && ` · ${fmt.num(e.workingWidthM, 1)} m`}
            {farmName && ` · ${farmName}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <EquipmentStatusBadge status={e.status} />
          {e.archivedAt && <span className="text-xs text-muted">{t('machinery.archived')}</span>}
          <SciBadge equipment={e} />
        </div>
      </header>

      <div className="text-sm text-fg-2 truncate -mt-1">{details || <span className="text-muted">{t('machinery.noMakeModel')}</span>}</div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Figure label={t('machinery.field.hourMeter')} value={`${fmt.num(e.hourMeter)} h`} />
        <Figure label={t('machinery.thisYear')} value={`${fmt.num(e.hoursThisYear, 1)} h`} />
        <Figure label={t('machinery.field.hourlyCost')} value={e.hourlyCost != null ? fmt.money(e.hourlyCost, currency, 2) : '—'} />
      </dl>

      <div className="mt-auto pt-3 border-t border-line text-sm flex items-start gap-2">
        <Wrench className="size-4 text-muted mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <span className="text-muted">{t('machinery.card.nextService')} </span>
          <NextMaintenance next={e.nextMaintenance} />
        </div>
      </div>
    </article>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-2">
      <dt className="text-xs text-muted truncate">{label}</dt>
      <dd className="font-medium tabular text-fg truncate">{value}</dd>
    </div>
  )
}
