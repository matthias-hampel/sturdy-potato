import {
  CROP_CYCLE_STATUSES,
  CROP_ROLES,
  type Crop,
  type CropCycle,
  type CropCycleStatus,
  type Field,
  type FieldPart,
  type FieldPartUsage,
  type Season,
} from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CalendarRange, Droplets, FlaskConical, LayoutGrid, Leaf, ListChecks, MoreHorizontal, Pencil, Plus, Shield, Sprout, Tractor, Trash2, Wheat, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton, Form, type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FieldNameLink } from '#/components/crops/FieldNameLink'
import { ApplyTemplateDialog, CycleFields, EMPTY_CYCLE_FORM, EditCycleDialog, seedPayload, useVarietyResolver, type CycleForm } from '#/components/crops/CycleDialogs'
import { OPERATION_TABS, OperationTabPanel, operationTabType, type OperationTab } from '#/components/crops/OperationTab'
import { HarvestYieldPanel } from '#/components/yield/HarvestYieldPanel'
import { PartUsageBadge } from '#/components/fields/FieldParts'
import { FieldShape } from '#/components/map/FieldShape'
import { ColumnConfigButton, NoMatches, SelectionBar, selectedIds, useBulkMutation, useColumnConfig, useTableView, type ColumnDef, type ColumnPreset } from '#/components/table/tableTools'
import { CropCycleStatusBadge, CropRoleBadge, CropTag } from '#/components/labels'
import { cropRoleLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, buttonClass } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, NumberField, Option, Select, num } from '#/ui/Field'
import { Card, EmptyState, Loading, Notice, PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ConfirmButton, Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

const TABS = ['overview', ...OPERATION_TABS] as const
type CropsTab = (typeof TABS)[number]

/** Same order and icons as the field tabs of the original agmeo. */
const TAB_ICONS: Record<CropsTab, LucideIcon> = {
  overview: LayoutGrid,
  tillage: Tractor,
  base_fertilization: FlaskConical,
  sowing: Sprout,
  nitrogen: Leaf,
  crop_protection: Shield,
  irrigation: Droplets,
  harvest: Wheat,
}

export const Route = createFileRoute('/o/$orgId/crops/')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: CropPlanning,
})

/** What a crop is planned on: a whole field, or a part of a field divided in the season. */
interface PlanTarget {
  /** `f:<fieldId>` or `p:<partId>`. */
  id: string
  name: string
  areaHa: number
  currentCrop: { cropName: string } | null
}

function CropPlanning() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasons, season, seasonId, isLoading } = useSeason()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const tab = search.tab ?? 'overview'
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId }, { enabled: !!seasonId })
  const allCycles = useOrgQuery<CropCycle[]>('/crop-cycles')
  const parts = useOrgQuery<FieldPart[]>('/field-parts', { seasonId }, { enabled: !!seasonId })
  const [seasonOpen, setSeasonOpen] = useState(false)
  const [assign, setAssign] = useState<{ fieldIds: string[] } | null>(null)
  const [edit, setEdit] = useState<CropCycle | null>(null)
  const [apply, setApply] = useState<CropCycle | null>(null)

  const rows = useMemo<PlanRow[]>(() => {
    const byField = new Map<string, CropCycle[]>()
    for (const c of cycles.data ?? []) byField.set(c.fieldId, [...(byField.get(c.fieldId) ?? []), c])
    // The main crop leads; catch and undersown crops of the season follow it.
    for (const list of byField.values()) list.sort((a, b) => CROP_ROLES.indexOf(a.role) - CROP_ROLES.indexOf(b.role))
    const previous = new Map<string, CropCycle>()
    if (season) {
      for (const c of allCycles.data ?? []) {
        if (c.harvestYear >= season.harvestYear || c.role !== 'main') continue
        const p = previous.get(c.fieldId)
        if (!p || c.harvestYear > p.harvestYear) previous.set(c.fieldId, c)
      }
    }
    // A divided field is planned per part (Teilschlag).
    const partsOf = new Map<string, FieldPart[]>()
    for (const p of parts.data ?? []) partsOf.set(p.fieldId, [...(partsOf.get(p.fieldId) ?? []), p])
    return (fields.data ?? []).flatMap((f): PlanRow[] => {
      const fieldCycles = byField.get(f.id) ?? []
      const fieldParts = partsOf.get(f.id)
      if (!fieldParts) {
        return [{ id: `f:${f.id}`, field: f, part: null, areaHa: f.areaHa, usage: null, cycles: fieldCycles, previous: previous.get(f.id) ?? null }]
      }
      return fieldParts.map((p) => ({ id: `p:${p.id}`, field: f, part: p, areaHa: p.areaHa, usage: p.usage, cycles: fieldCycles.filter((c) => c.fieldPartId === p.id), previous: previous.get(f.id) ?? null }))
    })
  }, [fields.data, cycles.data, allCycles.data, parts.data, season])

  const targets = useMemo<PlanTarget[]>(
    () =>
      rows
        .filter((r) => r.usage !== 'leased_out')
        .map((r) => ({ id: r.id, name: r.part ? `${r.field.name} · ${r.part.name}` : r.field.name, areaHa: r.areaHa, currentCrop: r.cycles[0] ? { cropName: r.cycles[0].cropName } : null })),
    [rows],
  )
  const unassigned = rows.filter((r) => r.cycles.length === 0 && r.usage !== 'leased_out')

  if (isLoading) return <Loading />

  return (
    <>
      <PageHeader
        title={t('crops.title')}
        subtitle={season ? `${season.harvestYear} · ${fmt.date(season.startDate)} – ${fmt.date(season.endDate)}` : t('crops.subtitle')}
        actions={
          tab !== 'overview' ? (
            can('operation.write') && season && (
              <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{ type: operationTabType(tab) }} variant="primary">
                <Plus /> {t('fieldOps.plan')}
              </Link>
            )
          ) : can('crop.write') && (
            <>
              <Button onPress={() => setSeasonOpen(true)}>
                <CalendarRange /> {t('crops.newSeason')}
              </Button>
              {season && (
                <Button variant="primary" onPress={() => setAssign({ fieldIds: unassigned.map((r) => r.id) })}>
                  <Plus /> {t('crops.assignCrop')}
                </Button>
              )}
            </>
          )
        }
      />

      {seasons.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarRange} title={t('crops.empty.title')} action={can('crop.write') && <Button variant="primary" onPress={() => setSeasonOpen(true)}><Plus /> {t('crops.newSeason')}</Button>}>
            {t('crops.empty.description')}
          </EmptyState>
        </Card>
      ) : (
        <Tabs selectedKey={tab} onSelectionChange={(key) => navigate({ search: { tab: key === 'overview' ? undefined : (key as CropsTab) }, replace: true })}>
          <TabList aria-label={t('crops.tabs.label')}>
            {TABS.map((id) => {
              const Icon = TAB_ICONS[id]
              return (
                <Tab key={id} id={id} className="inline-flex items-center gap-1.5">
                  <Icon className="size-4" aria-hidden /> {t(`crops.tabs.${id}`)}
                </Tab>
              )
            })}
          </TabList>
          <TabPanel id="overview">
            <PlanTable rows={rows} onAssign={(ids) => setAssign({ fieldIds: ids })} onEdit={setEdit} onApply={setApply} />
          </TabPanel>
          {OPERATION_TABS.map((id: OperationTab) => (
            <TabPanel key={id} id={id}>
              {id === 'harvest' && <HarvestYieldPanel />}
              <OperationTabPanel tab={id} label={t(`crops.tabs.${id}`)} />
            </TabPanel>
          ))}
        </Tabs>
      )}

      {seasonOpen && <SeasonDialog seasons={seasons} onClose={() => setSeasonOpen(false)} />}
      {assign && season && <AssignDialog season={season} fields={targets} initialFieldIds={assign.fieldIds} onClose={() => setAssign(null)} />}
      {edit && <EditCycleDialog cycle={edit} onClose={() => setEdit(null)} />}
      {apply && <ApplyTemplateDialog cycle={apply} onClose={() => setApply(null)} />}
    </>
  )
}

/** A field, or a part of a divided field (Teilschlag), with what grows on it this season. */
interface PlanRow {
  id: string
  field: Field
  part: FieldPart | null
  areaHa: number
  usage: FieldPartUsage | null
  /** The main crop first, then catch and undersown crops. */
  cycles: CropCycle[]
  previous: CropCycle | null
}

/** The crop a bulk edit changes on a row: its main crop, or the only one it has. */
const leadCycle = (r: PlanRow) => r.cycles.find((c) => c.role === 'main') ?? r.cycles[0]

function PlanTable({ rows, onAssign, onEdit, onApply }: { rows: PlanRow[]; onAssign: (ids: string[]) => void; onEdit: (c: CropCycle) => void; onApply: (c: CropCycle) => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const writable = can('crop.write')
  const [selection, setSelection] = useState<Selection>(new Set())
  const [bulkEdit, setBulkEdit] = useState<CropCycle[] | null>(null)
  const clear = () => setSelection(new Set())
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/crop-cycles/${id}`), { success: t('crops.removed') })
  const removeMany = useBulkMutation((base, c: CropCycle) => api.delete(`${base}/crop-cycles/${c.id}`), {
    label: (c) => `${c.fieldName} · ${c.cropName}`,
    success: (count) => t('crops.bulk.removed', { count }),
    onDone: clear,
  })

  const columns = useMemo<ColumnDef<PlanRow>[]>(
    () => [
      {
        id: 'field',
        label: t('crops.plan.field'),
        value: (r) => (r.part ? `${r.field.name} ${r.part.name}` : r.field.name),
        text: (r) => [r.field.name, r.part?.name, r.field.farmName].filter(Boolean).join(' '),
        render: (r) => {
          const color = leadCycle(r)?.cropColor ?? '#9aa392'
          return (
            <div className="flex items-center gap-2.5">
              {/* A part is shown inside its field's outline. */}
              <FieldShape geometry={r.field.geometry} fill={color} parts={r.part ? [{ geometry: r.part.geometry, color }] : undefined} className="size-8 text-fg" />
              <div className="min-w-0">
                <FieldNameLink field={r.field} cycle={leadCycle(r)} />
                {r.part ? (
                  <div className="text-xs text-muted flex items-center gap-1.5">{r.part.name} <PartUsageBadge usage={r.part.usage} /></div>
                ) : (
                  <div className="text-xs text-muted">{r.field.farmName}</div>
                )}
              </div>
            </div>
          )
        },
      },
      {
        id: 'area',
        label: t('crops.plan.area'),
        align: 'end',
        filter: 'number',
        value: (r) => r.cycles[0]?.areaHa ?? r.areaHa,
        text: (r) => fmt.ha(r.cycles[0]?.areaHa ?? r.areaHa),
        render: (r) => fmt.ha(r.cycles[0]?.areaHa ?? r.areaHa),
      },
      {
        id: 'parcel',
        label: t('crops.plan.parcelNumber'),
        value: (r) => r.field.parcelNumber,
        render: (r) => r.field.parcelNumber ?? <span className="text-muted">—</span>,
      },
      {
        id: 'group',
        label: t('crops.plan.group'),
        filter: 'select',
        value: (r) => r.field.groups[0]?.name,
        options: (r) => r.field.groups.map((g) => g.name),
        text: (r) => r.field.groups.map((g) => g.name).join(', '),
        render: (r) =>
          r.field.groups.length ? (
            <div className="flex flex-wrap gap-1">
              {r.field.groups.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                  <span className="size-2 rounded-full" style={{ background: g.color }} aria-hidden />
                  {g.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        id: 'previous',
        label: t('crops.plan.previousCrop'),
        filter: 'select',
        value: (r) => r.previous?.cropName,
        render: (r) => (r.previous ? <CropTag name={r.previous.cropName} color={r.previous.cropColor} /> : <span className="text-muted">—</span>),
      },
      {
        id: 'crop',
        label: t('crops.plan.crop'),
        filter: 'select',
        value: (r) => r.cycles[0]?.cropName,
        options: (r) => r.cycles.map((c) => c.cropName),
        text: (r) => r.cycles.flatMap((c) => [c.cropName, cropRoleLabel(c.role), c.varietyName, c.templateName]).filter(Boolean).join(' '),
        render: (r) =>
          r.cycles.length ? (
            <div className="space-y-1.5">
              {r.cycles.map((cy) => (
                <div key={cy.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CropTag name={cy.cropName} color={cy.cropColor} />
                    <CropRoleBadge role={cy.role} />
                  </div>
                  {cy.varietyName && <div className="text-xs text-muted pl-4">{cy.varietyName}</div>}
                  {cy.templateName && (
                    <div className="text-xs text-muted pl-4 flex items-center gap-1" title={t('crops.plan.template')}>
                      <ListChecks className="size-3 shrink-0" aria-hidden /> {cy.templateName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : writable && r.usage !== 'leased_out' ? (
            <Button size="sm" variant="quiet" onPress={() => onAssign([r.id])}>
              <Plus /> {t('crops.plan.assign')}
            </Button>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        id: 'usage',
        label: t('crops.plan.usage'),
        filter: 'select',
        value: (r) => (r.cycles[0] ? t(`crops.usage.${r.cycles[0].usage}`) : null),
        render: (r) =>
          r.cycles[0] ? (
            <>
              {t(`crops.usage.${r.cycles[0].usage}`)}
              {r.cycles[0].seedLot && <div className="text-xs text-muted">{[r.cycles[0].seedLot, r.cycles[0].multiplicationGeneration].filter(Boolean).join(' · ')}</div>}
            </>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        id: 'landUse',
        label: t('crops.plan.landUseCode'),
        filter: 'select',
        value: (r) => r.cycles[0]?.landUseCode,
        render: (r) => (r.cycles[0]?.landUseCode ? <span className={cx('tabular', r.cycles[0].landUseCodeIsDefault && 'text-muted')}>{r.cycles[0].landUseCode}</span> : <span className="text-muted">—</span>),
      },
      {
        id: 'sown',
        label: t('crops.plan.sown'),
        filter: 'date',
        value: (r) => r.cycles[0]?.sowingDate,
        text: (r) => (r.cycles[0]?.sowingDate ? fmt.date(r.cycles[0].sowingDate) : null),
        render: (r) => <span className="tabular whitespace-nowrap">{r.cycles[0]?.sowingDate ? fmt.date(r.cycles[0].sowingDate) : <span className="text-muted">—</span>}</span>,
      },
      {
        id: 'expected',
        label: t('crops.plan.expected'),
        align: 'end',
        filter: 'number',
        value: (r) => r.cycles[0]?.expectedYieldTHa,
        text: (r) => {
          const c = r.cycles[0]
          return c ? [c.expectedYieldTHa != null ? `${fmt.fixed(c.expectedYieldTHa, 1)} t/ha` : null, c.expectedPricePerT != null ? `${fmt.money(c.expectedPricePerT)}/t` : null].filter(Boolean).join(' ') : null
        },
        render: (r) => {
          const c = r.cycles[0]
          return (
            <>
              {c?.expectedYieldTHa != null ? `${fmt.fixed(c.expectedYieldTHa, 1)} t/ha` : '—'}
              {c?.expectedPricePerT != null && <div className="text-xs text-muted">{fmt.money(c.expectedPricePerT)}/t</div>}
            </>
          )
        },
      },
      {
        id: 'status',
        label: t('common.status'),
        filter: 'select',
        value: (r) => (r.cycles[0] ? CROP_CYCLE_STATUSES.indexOf(r.cycles[0].status) : null),
        text: (r) => (r.cycles[0] ? t(`enum.cropCycleStatus.${r.cycles[0].status}`) : null),
        render: (r) => r.cycles[0] && <CropCycleStatusBadge status={r.cycles[0].status} />,
      },
    ],
    [t, writable, onAssign],
  )
  const presets = useMemo<ColumnPreset[]>(
    () => [
      { id: 'overview', label: t('crops.plan.views.overview'), columns: ['area', 'previous', 'crop', 'sown', 'expected', 'status'] },
      { id: 'planning', label: t('crops.plan.views.planning'), columns: ['area', 'group', 'previous', 'crop', 'usage', 'expected'] },
      { id: 'regulatory', label: t('crops.plan.views.regulatory'), columns: ['parcel', 'area', 'crop', 'landUse', 'status'] },
      { id: 'all', label: t('crops.plan.views.all'), columns: columns.map((c) => c.id) },
    ],
    [t, columns],
  )
  const config = useColumnConfig('agmeo.cropPlan.columns', { all: columns.map((c) => c.id), fixed: ['field', 'crop'], defaults: presets[0].columns })
  const visibleColumns = columns.filter((c) => config.isVisible(c.id))
  const view = useTableView(columns, rows)
  const shown = useMemo(() => {
    const list = rows.filter(view.matches)
    return view.compare ? [...list].sort(view.compare) : list
  }, [rows, view])

  const selected = useMemo(() => {
    const ids = selectedIds(selection, shown)
    return shown.filter((r) => ids.has(r.id))
  }, [selection, shown])
  const assignable = selected.filter((r) => r.usage !== 'leased_out').map((r) => r.id)
  const editable = selected.flatMap((r) => (leadCycle(r) ? [leadCycle(r)!] : []))
  const removable = selected.flatMap((r) => r.cycles)

  return (
    <div className="min-w-0">
      <div className="flex justify-end mb-2">
        <ColumnConfigButton columns={columns} fixed={['field', 'crop']} presets={presets} config={config} />
      </div>
      <Card padded={false}>
        <Table
          aria-label={t('crops.plan.label')}
          selectionMode={writable ? 'multiple' : 'none'}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          sortDescriptor={view.sort}
          onSortChange={view.setSort}
        >
          <TableHeader>
            {writable && (
              <Column className="w-10">
                <Checkbox slot="selection" />
              </Column>
            )}
            {visibleColumns.map((c) => (
              <Column key={c.id} id={c.id} isRowHeader={c.id === 'field'} align={c.align} allowsSorting>
                {view.head(c)}
              </Column>
            ))}
            <Column aria-label={t('crops.plan.actions')}> </Column>
          </TableHeader>
          <TableBody items={shown} renderEmptyState={() => (view.filtered ? <NoMatches onReset={view.clearFilters} /> : <div className="py-10 text-center text-sm text-muted">{t('crops.plan.empty')}</div>)}>
            {(r) => (
              <Row id={r.id}>
                {writable && (
                  <Cell>
                    <Checkbox slot="selection" />
                  </Cell>
                )}
                {visibleColumns.map((c) => (
                  <Cell key={c.id} align={c.align}>{c.render(r)}</Cell>
                ))}
                <Cell>
                  {r.cycles.length > 0 && (can('crop.write') || can('operation.write')) && (
                    <MenuTrigger>
                      <AriaButton aria-label={t('crops.plan.actionsFor', { name: r.field.name })} className={buttonClass('ghost', 'icon-sm')}>
                        <MoreHorizontal className="size-4" />
                      </AriaButton>
                      <Menu
                        onAction={(key) => {
                          const [action, id] = String(key).split(':')
                          const cy = r.cycles.find((x) => x.id === id)
                          if (!cy) return
                          if (action === 'edit') onEdit(cy)
                          if (action === 'template') onApply(cy)
                          if (action === 'delete') remove.mutate(cy.id)
                        }}
                      >
                        {/* One block of actions per crop when a catch or undersown crop shares the field. */}
                        {r.cycles.flatMap((cy, i) => {
                          const suffix = r.cycles.length > 1 ? ` · ${cy.cropName}` : ''
                          return [
                            ...(i > 0 ? [<MenuSeparator key={`sep:${cy.id}`} />] : []),
                            ...(can('crop.write') ? [<MenuItem key={`edit:${cy.id}`} id={`edit:${cy.id}`} textValue={t('crops.edit') + suffix}><Pencil /> {t('crops.edit')}{suffix}</MenuItem>] : []),
                            ...(can('operation.write') ? [<MenuItem key={`template:${cy.id}`} id={`template:${cy.id}`} textValue={t('templates.apply.action') + suffix}><ListChecks /> {t('templates.apply.action')}{suffix}</MenuItem>] : []),
                            ...(can('crop.write') ? [<MenuItem key={`delete:${cy.id}`} id={`delete:${cy.id}`} textValue={t('crops.remove') + suffix} danger><Trash2 /> {t('crops.remove')}{suffix}</MenuItem>] : []),
                          ]
                        })}
                      </Menu>
                    </MenuTrigger>
                  )}
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>

      <SelectionBar count={selected.length} onClear={clear}>
        <Button size="sm" isDisabled={!assignable.length} onPress={() => onAssign(assignable)}>
          <Sprout /> {t('crops.assignCrop')}
        </Button>
        <Button size="sm" isDisabled={!editable.length} onPress={() => setBulkEdit(editable)}>
          <Pencil /> {t('crops.bulk.edit')}
        </Button>
        <ConfirmButton
          title={t('crops.bulk.removeTitle', { count: removable.length })}
          message={t('crops.bulk.removeMessage')}
          confirmLabel={t('crops.remove')}
          onConfirm={() => removeMany.mutateAsync(removable)}
          trigger={
            <Button size="sm" isDisabled={!removable.length}>
              <Trash2 /> {t('crops.remove')}
            </Button>
          }
        />
      </SelectionBar>

      {bulkEdit && <BulkEditCyclesDialog cycles={bulkEdit} onClose={() => { setBulkEdit(null); clear() }} />}
    </div>
  )
}

const UNCHANGED = '__unchanged'

/** Sets the filled-in values on the main crop of every selected field; empty inputs keep each crop as it is. */
function BulkEditCyclesDialog({ cycles, onClose }: { cycles: CropCycle[]; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const [cropId, setCropId] = useState<string | null>(null)
  const [status, setStatus] = useState<CropCycleStatus | typeof UNCHANGED>(UNCHANGED)
  const [sowingDate, setSowingDate] = useState<string | null>(null)
  const [harvestDate, setHarvestDate] = useState<string | null>(null)
  const [yieldTHa, setYieldTHa] = useState(NaN)
  const [price, setPrice] = useState(NaN)
  const changed = !!cropId || status !== UNCHANGED || !!sowingDate || !!harvestDate || !Number.isNaN(yieldTHa) || !Number.isNaN(price)
  const save = useBulkMutation(
    (base, c: CropCycle) =>
      api.patch(`${base}/crop-cycles/${c.id}`, {
        // A variety belongs to its crop; it goes when the crop changes.
        ...(cropId && cropId !== c.cropId ? { cropId, varietyId: null } : {}),
        ...(status !== UNCHANGED ? { status } : {}),
        ...(sowingDate ? { sowingDate } : {}),
        ...(harvestDate ? { expectedHarvestDate: harvestDate } : {}),
        ...(Number.isNaN(yieldTHa) ? {} : { expectedYieldTHa: yieldTHa }),
        ...(Number.isNaN(price) ? {} : { expectedPricePerT: price }),
      }),
    { label: (c) => `${c.fieldName} · ${c.cropName}`, success: (count) => t('crops.bulk.updated', { count }), onDone: onClose },
  )
  const statusItems = [{ id: UNCHANGED, name: t('fieldOps.bulk.unchanged') }, ...CROP_CYCLE_STATUSES.map((s) => ({ id: s, name: t(`enum.cropCycleStatus.${s}`) }))]
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('crops.bulk.editTitle', { count: cycles.length })} description={t('crops.bulk.editHint')} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate(cycles) }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <ComboBox label={t('crops.form.crop')} items={crops.data ?? []} value={cropId} onChange={(v) => setCropId(v ? String(v) : null)} placeholder={t('fieldOps.bulk.unchanged')}>
            {(c) => (
              <Option id={c.id} textValue={c.name}>
                <CropTag name={c.name} color={c.color} />
              </Option>
            )}
          </ComboBox>
          <Select label={t('common.status')} items={statusItems} value={status} onChange={(v) => v && setStatus(v as CropCycleStatus | typeof UNCHANGED)}>
            {(s) => <Option id={s.id}>{s.name}</Option>}
          </Select>
          <DatePicker label={t('crops.form.sowingDate')} value={sowingDate} onChange={setSowingDate} />
          <DatePicker label={t('crops.form.expectedHarvest')} value={harvestDate} onChange={setHarvestDate} />
          <NumberField label={t('crops.form.expectedYield')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={yieldTHa} onChange={setYieldTHa} placeholder={t('fieldOps.bulk.unchanged')} />
          <NumberField label={t('crops.form.expectedPrice')} unit="€/t" minValue={0} value={price} onChange={setPrice} placeholder={t('fieldOps.bulk.unchanged')} />
        </div>
        {cropId && <Notice tone="info">{t('crops.bulk.cropChangeHint')}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!changed} isPending={save.isPending}>
            {t('fieldOps.bulk.apply', { count: cycles.length })}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function SeasonDialog({ seasons, onClose }: { seasons: Season[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const nextYear = seasons.length ? Math.max(...seasons.map((s) => s.harvestYear)) + 1 : Number(today().slice(0, 4)) + (Number(today().slice(5, 7)) >= org.cropYearStartMonth ? 1 : 0)
  const startMonth = String(org.cropYearStartMonth).padStart(2, '0')
  const [year, setYear] = useState(nextYear)
  const [start, setStart] = useState<string | null>(`${nextYear - 1}-${startMonth}-01`)
  const [end, setEnd] = useState<string | null>(endOf(nextYear, org.cropYearStartMonth))
  const create = useOrgMutation((base, _: void) => api.post(`${base}/seasons`, { harvestYear: year, startDate: start, endDate: end }), {
    success: t('crops.season.created', { year }),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('crops.season.title')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); create.mutate() }} className="space-y-4">
        <NumberField
          label={t('crops.season.harvestYear')}
          value={year}
          formatOptions={{ useGrouping: false }}
          minValue={1990}
          maxValue={2200}
          onChange={(v) => {
            if (Number.isNaN(v)) return
            setYear(v)
            setStart(`${v - 1}-${startMonth}-01`)
            setEnd(endOf(v, org.cropYearStartMonth))
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label={t('crops.season.start')} value={start} onChange={setStart} isRequired />
          <DatePicker label={t('crops.season.end')} value={end} onChange={setEnd} isRequired />
        </div>
        <p className="text-xs text-muted">{t('crops.season.hint', { sown: year - 1, year })}</p>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={create.isPending}>{t('crops.season.create')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function endOf(harvestYear: number, startMonth: number) {
  const d = new Date(Date.UTC(harvestYear, startMonth - 1, 1))
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

function AssignDialog({ season, fields, initialFieldIds, onClose }: { season: Season; fields: PlanTarget[]; initialFieldIds: string[]; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  const [fieldIds, setFieldIds] = useState<string[]>(initialFieldIds)
  const [form, setForm] = useState<CycleForm>(EMPTY_CYCLE_FORM)
  const area = fields.filter((f) => fieldIds.includes(f.id)).reduce((s, f) => s + f.areaHa, 0)
  const save = useOrgMutation(
    async (base, _: void) => {
      const varietyId = form.cropId ? await resolveVariety(base, form.cropId, form.varietyName) : null
      return api.post<CropCycle[]>(`${base}/crop-cycles`, {
        seasonId: season.id,
        fieldIds: fieldIds.filter((k) => k.startsWith('f:')).map((k) => k.slice(2)),
        fieldPartIds: fieldIds.filter((k) => k.startsWith('p:')).map((k) => k.slice(2)),
        cropId: form.cropId,
        varietyId,
        status: form.status,
        role: form.role,
        sowingDate: form.sowingDate,
        expectedHarvestDate: form.expectedHarvestDate,
        expectedYieldTHa: num(form.expectedYieldTHa),
        expectedPricePerT: num(form.expectedPricePerT),
        areaHa: fieldIds.length === 1 ? num(form.areaHa) : null,
        ...seedPayload(form),
        notes: form.notes || null,
      })
    },
    { success: (r) => t('crops.assign.success', { count: r.length }), onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('crops.assign.title', { season: season.name })} size="lg">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="grid md:grid-cols-[16rem_1fr] gap-6">
        <div>
          <div className="text-sm font-medium text-fg-2 mb-2">{t('crops.assign.fields')} <span className="text-muted font-normal">· {t('crops.assign.selected', { count: fieldIds.length, area: fmt.ha(area, 1) })}</span></div>
          <div className="border border-line rounded-lg max-h-80 overflow-y-auto divide-y divide-line">
            {fields.map((f) => (
              <div key={f.id} className={cx('px-3 py-2', fieldIds.includes(f.id) && 'bg-primary-soft/50')}>
                <Checkbox isSelected={fieldIds.includes(f.id)} onChange={(sel) => setFieldIds((ids) => (sel ? [...ids, f.id] : ids.filter((i) => i !== f.id)))}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-xs text-muted">{fmt.ha(f.areaHa, 1)}{f.currentCrop ? ` · ${f.currentCrop.cropName}` : ''}</span>
                  </span>
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <CycleFields value={form} onChange={setForm} crops={crops.data ?? []} showArea={fieldIds.length === 1} />
          {fields.some((f) => fieldIds.includes(f.id) && f.currentCrop) && (
            <Notice tone="info">{t('crops.assign.additionalCycle')}</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isDisabled={!form.cropId || !fieldIds.length} isPending={save.isPending}>
              <Sprout /> {t('crops.assign.submit', { count: fieldIds.length })}
            </Button>
          </div>
        </div>
      </Form>
    </ModalDialog>
  )
}

