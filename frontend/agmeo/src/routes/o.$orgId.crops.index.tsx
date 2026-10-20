import {
  CROP_CYCLE_STATUSES,
  CROP_ROLES,
  type CarryForwardResult,
  type Crop,
  type CropCycle,
  type CropCycleStatus,
  type CultivationTemplate,
  type CropRole,
  type Field,
  type FieldGroup,
  type FieldPart,
  type FieldPartUsage,
  type RollOverResult,
  type Season,
} from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CalendarRange, CopyPlus, Droplets, FlaskConical, LayoutGrid, Leaf, ListChecks, MoreHorizontal, Pencil, Plus, Repeat, Save, Shield, Sprout, Tractor, Trash2, Wheat, X, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton, Form, type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FieldNameLink } from '#/components/crops/FieldNameLink'
import { METRIC_COLUMN_GROUP, cropTableKey, metricColumns, useCropTableMetrics } from '#/components/crops/cropTableMetrics'
import { ApplyTemplateDialog, CycleFields, EMPTY_CYCLE_FORM, EditCycleDialog, seedPayload, useVarietyResolver, type CycleForm } from '#/components/crops/CycleDialogs'
import { OPERATION_TABS, OperationTabPanel, operationTabType, type OperationTab } from '#/components/crops/OperationTab'
import { HarvestYieldPanel } from '#/components/yield/HarvestYieldPanel'
import { PartUsageBadge } from '#/components/fields/FieldParts'
import { FieldShape } from '#/components/map/FieldShape'
import { DataTable } from '#/components/table/DataTable'
import { ColumnConfigButton, SelectionBar, selectedIds, useBulkMutation, useColumnConfig, useTableView, type ColumnDef, type ColumnPreset } from '#/components/table/tableTools'
import { CropCycleStatusBadge, CropRoleBadge, CropTag } from '#/components/labels'
import { cropRoleLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, buttonClass } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, NumberField, Option, Select, Switch, num } from '#/ui/Field'
import { Card, EmptyState, Loading, Notice, PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ConfirmButton, Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog, Tooltip } from '#/ui/Overlay'
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
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
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
  const [assign, setAssign] = useState<{ fieldIds: string[]; role?: CropRole } | null>(null)
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
  const nextSeason = season ? (seasons.find((s) => s.harvestYear === season.harvestYear + 1) ?? null) : null
  // Last season had crops but this one has none yet: offer to plan it from there.
  const previousPlanned = !!season && (allCycles.data ?? []).some((c) => c.harvestYear === season.harvestYear - 1)

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
            {season && !cycles.isLoading && !(cycles.data ?? []).length && previousPlanned && <PlanNextYear season={season} />}
            <PlanTable
              rows={rows}
              season={season}
              nextSeason={nextSeason}
              onAssign={(ids) => setAssign({ fieldIds: ids })}
              onSecondary={(ids) => setAssign({ fieldIds: ids, role: 'catch_crop' })}
              onEdit={setEdit}
              onApply={setApply}
            />
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
      {assign && season && <AssignDialog season={season} fields={targets} initialFieldIds={assign.fieldIds} initialRole={assign.role} onClose={() => setAssign(null)} />}
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

/** Values changed inline on a crop and not saved yet. */
interface CycleEdit {
  cropId?: string
  sowingDate?: string | null
  expectedYieldTHa?: number | null
}

const BASE_COLUMNS = ['field', 'area', 'parcel', 'group', 'previous', 'crop', 'usage', 'landUse', 'sown', 'expected', 'status']
const PLAN_COLUMNS = [...BASE_COLUMNS, ...Object.keys(METRIC_COLUMN_GROUP)]

/** At most two catch or undersown crops per field and season, as in the reference. */
const MAX_SECONDARY = 2
const secondaryCount = (r: PlanRow) => r.cycles.filter((c) => c.role !== 'main').length

function PlanTable({
  rows,
  season,
  nextSeason,
  onAssign,
  onSecondary,
  onEdit,
  onApply,
}: {
  rows: PlanRow[]
  season: Season | null
  nextSeason: Season | null
  onAssign: (ids: string[]) => void
  onSecondary: (ids: string[]) => void
  onEdit: (c: CropCycle) => void
  onApply: (c: CropCycle) => void
}) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const writable = can('crop.write')
  const fieldWritable = can('field.write')
  const crops = useOrgQuery<Crop[]>('/crops', undefined, { enabled: writable })
  const allGroups = useOrgQuery<FieldGroup[]>('/field-groups', undefined, { enabled: fieldWritable })
  const [selection, setSelection] = useState<Selection>(new Set())
  const [bulkEdit, setBulkEdit] = useState<CropCycle[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [edits, setEdits] = useState<Record<string, CycleEdit>>({})
  const clear = () => setSelection(new Set())
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/crop-cycles/${id}`), { success: t('crops.removed') })
  const removeMany = useBulkMutation((base, c: CropCycle) => api.delete(`${base}/crop-cycles/${c.id}`), {
    label: (c) => `${c.fieldName} · ${c.cropName}`,
    success: (count) => t('crops.bulk.removed', { count }),
    onDone: clear,
  })
  const toNextSeason = useOrgMutation(
    (base, fieldIds: string[]) => api.post<CarryForwardResult>(`${base}/crop-cycles/carry-forward`, { targetSeasonId: nextSeason!.id, fieldIds }),
    { success: (r) => t('cropTable.nextSeason.success', { count: r.created, year: nextSeason?.harvestYear }), onSuccess: clear },
  )
  const groupMembers = useOrgMutation(
    (base, v: { fieldIds: string[]; groupId?: string; groupName?: string; remove?: boolean }) =>
      api.post(`${base}/field-groups/members${v.remove ? '/remove' : ''}`, { fieldIds: v.fieldIds, groupId: v.groupId, groupName: v.groupName }),
  )
  const saveEdits = useBulkMutation(
    (base, [id, e]: [string, CycleEdit]) => {
      const cycle = rows.flatMap((r) => r.cycles).find((c) => c.id === id)
      return api.patch(`${base}/crop-cycles/${id}`, {
        // A variety belongs to its crop; it goes when the crop changes.
        ...(e.cropId && e.cropId !== cycle?.cropId ? { cropId: e.cropId, varietyId: null } : {}),
        ...(e.sowingDate !== undefined ? { sowingDate: e.sowingDate } : {}),
        ...(e.expectedYieldTHa !== undefined ? { expectedYieldTHa: e.expectedYieldTHa } : {}),
      })
    },
    {
      label: ([id]) => {
        const c = rows.flatMap((r) => r.cycles).find((x) => x.id === id)
        return c ? `${c.fieldName} · ${c.cropName}` : id
      },
      success: (count) => t('crops.bulk.updated', { count }),
      onDone: () => {
        setEdits({})
        qc.invalidateQueries({ queryKey: cropTableKey(orgId) })
      },
    },
  )

  const selectedRows = useMemo(() => {
    const ids = selection === 'all' ? new Set(rows.map((r) => r.id)) : new Set([...selection].map(String))
    return rows.filter((r) => ids.has(r.id))
  }, [selection, rows])
  /**
   * An inline edit on a selected row applies to the main crop of every selected row (the
   * reference's multi-row editing); otherwise to the edited crop only.
   */
  const edit = (r: PlanRow, cycle: CropCycle, patch: CycleEdit) => {
    const targets = selectedRows.length > 1 && selectedRows.some((x) => x.id === r.id) ? selectedRows.flatMap((x) => (leadCycle(x) ? [leadCycle(x)!] : [])) : [cycle]
    setEdits((all) => {
      const next = { ...all }
      for (const c of targets) {
        const merged = { ...next[c.id], ...patch }
        // Values set back to the saved ones are no change.
        if (merged.cropId === c.cropId) delete merged.cropId
        if (merged.sowingDate !== undefined && (merged.sowingDate ?? null) === (c.sowingDate ?? null)) delete merged.sowingDate
        if (merged.expectedYieldTHa !== undefined && (merged.expectedYieldTHa ?? null) === (c.expectedYieldTHa ?? null)) delete merged.expectedYieldTHa
        if (Object.keys(merged).length) next[c.id] = merged
        else delete next[c.id]
      }
      return next
    })
  }
  const pending = Object.entries(edits)
  const isEditing = editing && writable
  const groupTargets = (r: PlanRow) => (selectedRows.length > 1 && selectedRows.some((x) => x.id === r.id) ? [...new Set(selectedRows.map((x) => x.field.id))] : [r.field.id])

  const cropName = (id: string | undefined) => crops.data?.find((c) => c.id === id)
  const sowingOf = (c: CropCycle) => (edits[c.id]?.sowingDate !== undefined ? edits[c.id].sowingDate : c.sowingDate)
  const expectedOf = (c: CropCycle) => (edits[c.id]?.expectedYieldTHa !== undefined ? edits[c.id].expectedYieldTHa : c.expectedYieldTHa)
  const expectedInput = (r: PlanRow, c: CropCycle) => (
    <NumberField
      aria-label={t('cropTable.edit.expectedFor', { name: r.field.name })}
      className="w-28 ml-auto"
      unit="t/ha"
      minValue={0}
      step={0.1}
      formatOptions={{ maximumFractionDigits: 2 }}
      value={expectedOf(c) ?? NaN}
      onChange={(v) => edit(r, c, { expectedYieldTHa: Number.isNaN(v) ? null : v })}
    />
  )

  const presets = useMemo<ColumnPreset[]>(
    () => [
      { id: 'overview', label: t('crops.plan.views.overview'), columns: ['area', 'previous', 'crop', 'sown', 'expected', 'status'] },
      { id: 'planning', label: t('crops.plan.views.planning'), columns: ['area', 'group', 'previous', 'crop', 'usage', 'expected'] },
      { id: 'regulatory', label: t('crops.plan.views.regulatory'), columns: ['parcel', 'area', 'crop', 'landUse', 'status'] },
      // The reference's quick views of its field list.
      { id: 'conditions', label: t('cropTable.views.conditions'), columns: ['area', 'crop', 'group', 'gdd', 'ndvi', 'lai', 'trafficability', 'sprayingWindow', 'diseaseRisk', 'precipNext24h', 'yield', 'bbch'] },
      { id: 'development', label: t('cropTable.views.development'), columns: ['area', 'crop', 'group', 'sown', 'precipSeason', 'gdd', 'precipLast24h', 'precipNext7d', 'ndvi', 'lai'] },
      { id: 'economics', label: t('cropTable.views.economics'), columns: ['area', 'crop', 'group', 'yield', 'yieldMap', 'margin', 'co2e', 'nitrogen'] },
      { id: 'all', label: t('crops.plan.views.all'), columns: PLAN_COLUMNS },
    ],
    [t],
  )
  const config = useColumnConfig('agmeo.cropPlan.columns', { all: PLAN_COLUMNS, fixed: ['field', 'crop'], defaults: presets[0].columns })
  // Only the shown columns' batch values are loaded.
  const metrics = useCropTableMetrics(season?.id ?? null, config.isVisible)

  const columns = useMemo<(ColumnDef<PlanRow> & { group: string })[]>(() => {
    const general = t('cropTable.groups.general')
    const base: ColumnDef<PlanRow>[] = [
      {
        id: 'field',
        label: t('crops.plan.field'),
        isRowHeader: true,
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
          editing && fieldWritable ? (
            <GroupTags
              field={r.field}
              groups={allGroups.data ?? []}
              onAdd={(g) => groupMembers.mutate({ fieldIds: groupTargets(r), ...g })}
              onRemove={(groupId) => groupMembers.mutate({ fieldIds: groupTargets(r), groupId, remove: true })}
            />
          ) : r.field.groups.length ? (
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
              {r.cycles.map((cy) => {
                const changed = cropName(edits[cy.id]?.cropId)
                return (
                  <div key={cy.id}>
                    {isEditing && cy === leadCycle(r) ? (
                      <ComboBox
                        aria-label={t('cropTable.edit.cropFor', { name: r.field.name })}
                        className="w-48"
                        items={crops.data ?? []}
                        value={edits[cy.id]?.cropId ?? cy.cropId}
                        onChange={(v) => v && edit(r, cy, { cropId: String(v) })}
                      >
                        {(c) => (
                          <Option id={c.id} textValue={c.name}>
                            <CropTag name={c.name} color={c.color} />
                          </Option>
                        )}
                      </ComboBox>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CropTag name={changed?.name ?? cy.cropName} color={changed?.color ?? cy.cropColor} />
                        <CropRoleBadge role={cy.role} />
                      </div>
                    )}
                    {cy.varietyName && !changed && <div className="text-xs text-muted pl-4">{cy.varietyName}</div>}
                    {cy.templateName && (
                      <div className="text-xs text-muted pl-4 flex items-center gap-1" title={t('crops.plan.template')}>
                        <ListChecks className="size-3 shrink-0" aria-hidden /> {cy.templateName}
                      </div>
                    )}
                  </div>
                )
              })}
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
        value: (r) => (leadCycle(r) ? sowingOf(leadCycle(r)!) : null),
        text: (r) => {
          const d = leadCycle(r) ? sowingOf(leadCycle(r)!) : null
          return d ? fmt.date(d) : null
        },
        render: (r) => {
          const c = leadCycle(r)
          if (isEditing && c) {
            return <DatePicker aria-label={t('cropTable.edit.sowingFor', { name: r.field.name })} className="w-40" value={sowingOf(c)} onChange={(d) => edit(r, c, { sowingDate: d })} />
          }
          const d = c ? sowingOf(c) : null
          return <span className="tabular whitespace-nowrap">{d ? fmt.date(d) : <span className="text-muted">—</span>}</span>
        },
      },
      {
        id: 'expected',
        label: t('crops.plan.expected'),
        align: 'end',
        filter: 'number',
        value: (r) => (leadCycle(r) ? expectedOf(leadCycle(r)!) : null),
        text: (r) => {
          const c = leadCycle(r)
          const y = c ? expectedOf(c) : null
          return c ? [y != null ? `${fmt.fixed(y, 1)} t/ha` : null, c.expectedPricePerT != null ? `${fmt.money(c.expectedPricePerT)}/t` : null].filter(Boolean).join(' ') : null
        },
        render: (r) => {
          const c = leadCycle(r)
          if (isEditing && c) return expectedInput(r, c)
          const y = c ? expectedOf(c) : null
          return (
            <>
              {y != null ? `${fmt.fixed(y, 1)} t/ha` : '—'}
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
    ]
    const extra = metricColumns<PlanRow>(t, metrics, leadCycle, {
      canObserveBbch: writable,
      yieldCell: (r, c) =>
        isEditing ? (
          expectedInput(r, c)
        ) : expectedOf(c) != null ? (
          <span className="tabular text-info" title={t('cropTable.yield.expected')}>
            {fmt.measure(expectedOf(c), 'yieldMass')}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    })
    return [...base.map((c) => ({ ...c, group: general })), ...extra.map((c) => ({ ...c, group: t(`cropTable.groups.${METRIC_COLUMN_GROUP[c.id]}`) }))]
  }, [t, writable, fieldWritable, onAssign, editing, isEditing, edits, crops.data, allGroups.data, metrics, selectedRows])

  // The table sorts, searches and filters by the columns shown.
  const visibleIds = columns.flatMap((c) => (config.isVisible(c.id) ? [c.id] : [])).join(',')
  const visibleColumns = useMemo(() => columns.filter((c) => visibleIds.split(',').includes(c.id)), [columns, visibleIds])
  const view = useTableView(visibleColumns, rows)
  const shown = view.shown

  const selected = useMemo(() => {
    const ids = selectedIds(selection, shown)
    return shown.filter((r) => ids.has(r.id))
  }, [selection, shown])
  const assignable = selected.filter((r) => r.usage !== 'leased_out').map((r) => r.id)
  const editable = selected.flatMap((r) => (leadCycle(r) ? [leadCycle(r)!] : []))
  const removable = selected.flatMap((r) => r.cycles)
  const secondaryTargets = selected.filter((r) => r.cycles.some((c) => c.role === 'main') && secondaryCount(r) < MAX_SECONDARY).map((r) => r.id)
  const nextSeasonFields = [...new Set(selected.filter((r) => r.cycles.length).map((r) => r.field.id))]

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
        {metrics.refreshedAt && <span className="mr-auto text-xs text-muted">{t('cropTable.weatherAsOf', { date: fmt.dateTime(metrics.refreshedAt) })}</span>}
        {(writable || fieldWritable) && (
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} onPress={() => setEditing((e) => !e)}>
            <Pencil /> {editing ? t('cropTable.edit.done') : t('cropTable.edit.start')}
          </Button>
        )}
        <ColumnConfigButton columns={columns} fixed={['field', 'crop']} presets={presets} config={config} />
      </div>
      {editing && <p className="text-xs text-muted mb-2">{t('cropTable.edit.hint')}</p>}
      <Card padded={false}>
        <DataTable
          aria-label={t('crops.plan.label')}
          view={view}
          selectionMode={writable ? 'multiple' : 'none'}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          empty={<div className="py-10 text-center text-sm text-muted">{t('crops.plan.empty')}</div>}
          actions={(r) =>
            r.cycles.length > 0 && (can('crop.write') || can('operation.write')) && (
              <MenuTrigger>
                <AriaButton aria-label={t('crops.plan.actionsFor', { name: r.field.name })} className={buttonClass('ghost', 'icon-sm')}>
                  <MoreHorizontal className="size-4" />
                </AriaButton>
                <Menu
                  onAction={(key) => {
                    const [action, id] = String(key).split(':')
                    if (action === 'secondary') return onSecondary([r.id])
                    const cy = r.cycles.find((x) => x.id === id)
                    if (!cy) return
                    if (action === 'edit') onEdit(cy)
                    if (action === 'template') onApply(cy)
                    if (action === 'delete') remove.mutate(cy.id)
                  }}
                >
                  {can('crop.write') && r.cycles.some((c) => c.role === 'main') && secondaryCount(r) < MAX_SECONDARY
                    ? [<MenuItem key="secondary" id="secondary" textValue={t('cropTable.secondary.add')}><Sprout /> {t('cropTable.secondary.add')}</MenuItem>, <MenuSeparator key="sep:secondary" />]
                    : null}
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
            )
          }
        />
      </Card>

      {pending.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none mt-4">
          <div role="status" className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-medium px-1">{t('cropTable.edit.unsaved', { count: pending.length })}</span>
            <Button size="sm" onPress={() => setEdits({})} isDisabled={saveEdits.isPending}>{t('cropTable.edit.discard')}</Button>
            <Button size="sm" variant="primary" isPending={saveEdits.isPending} onPress={() => saveEdits.mutate(pending)}>
              <Save /> {t('common.save')}
            </Button>
          </div>
        </div>
      )}

      <SelectionBar count={selected.length} onClear={clear}>
        <Button size="sm" isDisabled={!assignable.length} onPress={() => onAssign(assignable)}>
          <Sprout /> {t('crops.assignCrop')}
        </Button>
        <Button size="sm" isDisabled={!secondaryTargets.length} onPress={() => onSecondary(secondaryTargets)}>
          <Sprout /> {t('cropTable.secondary.add')}
        </Button>
        <Button size="sm" isDisabled={!editable.length} onPress={() => setBulkEdit(editable)}>
          <Pencil /> {t('crops.bulk.edit')}
        </Button>
        {nextSeason ? (
          <Button size="sm" isDisabled={!nextSeasonFields.length} isPending={toNextSeason.isPending} onPress={() => toNextSeason.mutate(nextSeasonFields)}>
            <CalendarRange /> {t('cropTable.nextSeason.button', { year: nextSeason.harvestYear })}
          </Button>
        ) : (
          <Tooltip content={t('cropTable.nextSeason.missing')}>
            <Button size="sm" isDisabled>
              <CalendarRange /> {t('cropTable.nextSeason.button', { year: (season?.harvestYear ?? 0) + 1 })}
            </Button>
          </Tooltip>
        )}
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

/** The field's groups with a remove button each, and a field to add one (new names create the group). */
function GroupTags({ field, groups, onAdd, onRemove }: { field: Field; groups: FieldGroup[]; onAdd: (g: { groupId?: string; groupName?: string }) => void; onRemove: (groupId: string) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const options = groups.filter((g) => !field.groups.some((x) => x.id === g.id))
  const add = (value: string) => {
    const v = value.trim()
    if (!v) return
    const existing = groups.find((g) => g.name.toLowerCase() === v.toLowerCase())
    onAdd(existing ? { groupId: existing.id } : { groupName: v })
    setName('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-48">
      {field.groups.map((g) => (
        <span key={g.id} className="inline-flex items-center gap-1 rounded-full border border-line pl-2 pr-0.5 py-0.5 text-xs">
          <span className="size-2 rounded-full" style={{ background: g.color }} aria-hidden />
          {g.name}
          <AriaButton aria-label={t('cropTable.groups.removeFrom', { group: g.name, field: field.name })} onPress={() => onRemove(g.id)} className="rounded-full p-0.5 text-muted hover:text-fg hover:bg-surface-2">
            <X className="size-3" aria-hidden />
          </AriaButton>
        </span>
      ))}
      <ComboBox
        aria-label={t('cropTable.groups.addTo', { field: field.name })}
        placeholder={t('cropTable.groups.add')}
        className="w-36"
        allowsCustomValue
        items={options.map((g) => ({ id: g.id, name: g.name }))}
        inputValue={name}
        onInputChange={setName}
        onChange={(v) => v && add(groups.find((g) => g.id === v)?.name ?? '')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add(name)
        }}
      >
        {(g) => <Option id={g.id}>{g.name}</Option>}
      </ComboBox>
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

/**
 * Shown on an empty season after a planned one (the reference's PlanNextYear): continue the crop
 * rotations into it, or repeat last season's crops.
 */
function PlanNextYear({ season }: { season: Season }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: cropTableKey(orgId) })
  const rollOver = useOrgMutation((base, _: void) => api.post<RollOverResult>(`${base}/rotations/roll-over`, { targetSeasonId: season.id, applyTemplates: can('operation.write') }), {
    success: (r) => (r.fields.length ? t('rotations.rollOver.summary', { count: r.created, skipped: r.skipped }) : t('rotations.rollOver.nothing', { year: season.harvestYear })),
    onSuccess: refresh,
  })
  const carry = useOrgMutation((base, _: void) => api.post<CarryForwardResult>(`${base}/crop-cycles/carry-forward`, { targetSeasonId: season.id }), {
    success: (r) => t('rotations.carry.success', { count: r.created }),
    onSuccess: refresh,
  })
  if (!can('crop.write')) return null
  return (
    <Notice tone="warning" className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 min-w-64">{t('cropTable.planNextYear.text', { year: season.harvestYear, previousYear: season.harvestYear - 1 })}</span>
        <Button size="sm" variant="primary" isPending={rollOver.isPending} isDisabled={carry.isPending} onPress={() => rollOver.mutate()}>
          <Repeat /> {t('cropTable.planNextYear.rotation', { year: season.harvestYear })}
        </Button>
        <Button size="sm" isPending={carry.isPending} isDisabled={rollOver.isPending} onPress={() => carry.mutate()}>
          <CopyPlus /> {t('cropTable.planNextYear.carry', { previousYear: season.harvestYear - 1 })}
        </Button>
      </div>
    </Notice>
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

function AssignDialog({ season, fields, initialFieldIds, initialRole, onClose }: { season: Season; fields: PlanTarget[]; initialFieldIds: string[]; initialRole?: CropRole; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  const [fieldIds, setFieldIds] = useState<string[]>(initialFieldIds)
  const [form, setForm] = useState<CycleForm>({ ...EMPTY_CYCLE_FORM, role: initialRole ?? EMPTY_CYCLE_FORM.role })
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [strawRemoved, setStrawRemoved] = useState(false)
  const cropTemplates = (templates.data ?? []).filter((tpl) => tpl.cropId === form.cropId)
  const area = fields.filter((f) => fieldIds.includes(f.id)).reduce((s, f) => s + f.areaHa, 0)
  const save = useOrgMutation(
    async (base, _: void) => {
      const varietyId = form.cropId ? await resolveVariety(base, form.cropId, form.varietyName) : null
      const created = await api.post<CropCycle[]>(`${base}/crop-cycles`, {
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
      // As in the reference's assignment on the operations map: the cultivation template's
      // operations are planned and the straw (by-product) choice is kept on each new crop.
      const template = cropTemplates.find((tpl) => tpl.id === templateId)
      for (const c of created) {
        if (template) await api.post(`${base}/crop-cycles/${c.id}/apply-template`, { templateId: template.id })
        if (strawRemoved) await api.put(`${base}/crop-cycles/${c.id}/base-fertilization`, { strawRemoved: true })
      }
      return created
    },
    { success: (r) => t('crops.assign.success', { count: r.length }), onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={initialRole && initialRole !== 'main' ? t('cropTable.secondary.title', { season: season.name }) : t('crops.assign.title', { season: season.name })} size="lg">
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
          {(!initialRole || initialRole === 'main') && (
            <div className="grid sm:grid-cols-2 gap-4 items-end">
              <Select
                label={t('crops.assign.template')}
                items={[{ id: '__none', name: t('crops.assign.noTemplate') }, ...cropTemplates]}
                value={templateId ?? '__none'}
                onChange={(v) => setTemplateId(v && v !== '__none' ? String(v) : null)}
                isDisabled={!form.cropId}
                description={t('crops.assign.templateHint')}
              >
                {(tpl) => <Option id={tpl.id}>{tpl.name}</Option>}
              </Select>
              <Switch isSelected={strawRemoved} onChange={setStrawRemoved}>
                {t('crops.assign.strawRemoved')}
              </Switch>
            </div>
          )}
          {initialRole && initialRole !== 'main' && <Notice tone="info">{t('cropTable.secondary.hint')}</Notice>}
          {(!initialRole || initialRole === 'main') && fields.some((f) => fieldIds.includes(f.id) && f.currentCrop) && (
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

