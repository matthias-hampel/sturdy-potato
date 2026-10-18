import {
  CROP_CYCLE_STATUSES,
  CROP_ROLES,
  type ApplyTemplateResult,
  type Crop,
  type CropCycle,
  type CropCycleStatus,
  type CropRole,
  type CropRotation,
  type CultivationTemplate,
  type Field,
  type FieldPart,
  type FieldPartUsage,
  type RegisteredVariety,
  type RollOverResult,
  type RotationInput,
  type Season,
  type Variety,
  varietyKey,
} from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, CalendarRange, ChevronDown, ChevronUp, ListChecks, MapPin, MoreHorizontal, Pencil, Plus, Repeat, Sprout, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton, Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { BarList } from '#/components/charts'
import { PartUsageBadge } from '#/components/fields/FieldParts'
import { CropCycleStatusBadge, CropRoleBadge, CropTag, templateStepTiming } from '#/components/labels'
import { cropRoleLabel, operationTypeLabel } from '#/i18n/labels'
import { ApiRequestError, api, errorMessage } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, buttonClass } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ConfirmButton, Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx, focusRing } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/crops')({ component: CropPlanning })

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
  const { can } = useOrg()
  const { seasons, season, seasonId, isLoading } = useSeason()
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId }, { enabled: !!seasonId })
  const allCycles = useOrgQuery<CropCycle[]>('/crop-cycles')
  const parts = useOrgQuery<FieldPart[]>('/field-parts', { seasonId }, { enabled: !!seasonId })
  const [seasonOpen, setSeasonOpen] = useState(false)
  const [assign, setAssign] = useState<{ fieldIds: string[] } | null>(null)
  const [edit, setEdit] = useState<CropCycle | null>(null)
  const [apply, setApply] = useState<CropCycle | null>(null)

  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/crop-cycles/${id}`), { success: t('crops.removed') })

  const rows = useMemo(() => {
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
    return (fields.data ?? []).flatMap((f) => {
      const fieldCycles = byField.get(f.id) ?? []
      const fieldParts = partsOf.get(f.id)
      if (!fieldParts) {
        return [{ id: `f:${f.id}`, field: f, part: null as FieldPart | null, areaHa: f.areaHa, usage: null as FieldPartUsage | null, cycles: fieldCycles, previous: previous.get(f.id) ?? null }]
      }
      return fieldParts.map((p) => ({ id: `p:${p.id}`, field: f, part: p as FieldPart | null, areaHa: p.areaHa, usage: p.usage as FieldPartUsage | null, cycles: fieldCycles.filter((c) => c.fieldPartId === p.id), previous: previous.get(f.id) ?? null }))
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
  const byCrop = useMemo(() => {
    const m = new Map<string, { name: string; color: string; area: number }>()
    for (const c of cycles.data ?? []) {
      const cur = m.get(c.cropId) ?? { name: c.cropName, color: c.cropColor, area: 0 }
      cur.area += c.areaHa
      m.set(c.cropId, cur)
    }
    return [...m.entries()].map(([id, v]) => ({ key: id, label: v.name, swatch: v.color, value: v.area })).sort((a, b) => b.value - a.value)
  }, [cycles.data])

  if (isLoading) return <Loading />

  return (
    <>
      <PageHeader
        title={t('crops.title')}
        subtitle={season ? `${season.name} · ${fmt.date(season.startDate)} – ${fmt.date(season.endDate)}` : t('crops.subtitle')}
        actions={
          can('crop.write') && (
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
        <div className="grid xl:grid-cols-[1fr_20rem] gap-6 items-start">
          <Card padded={false} title={t('crops.plan.title', { season: season?.name })} description={unassigned.length ? t('crops.plan.unassigned', { count: unassigned.length }) : t('crops.plan.allAssigned')}>
            <Table aria-label={t('crops.plan.label')}>
              <TableHeader>
                <Column isRowHeader>{t('crops.plan.field')}</Column>
                <Column align="end">{t('crops.plan.area')}</Column>
                <Column>{t('crops.plan.previousCrop')}</Column>
                <Column>{t('crops.plan.crop')}</Column>
                <Column>{t('crops.plan.sown')}</Column>
                <Column align="end">{t('crops.plan.expected')}</Column>
                <Column>{t('common.status')}</Column>
                <Column aria-label={t('crops.plan.actions')}> </Column>
              </TableHeader>
              <TableBody items={rows} renderEmptyState={() => <div className="py-10 text-center text-sm text-muted">{t('crops.plan.empty')}</div>}>
                {(r) => {
                  const c = r.cycles[0]
                  return (
                    <Row id={r.id}>
                      <Cell>
                        <div className="font-medium">{r.field.name}</div>
                        {r.part ? (
                          <div className="text-xs text-muted flex items-center gap-1.5">{r.part.name} <PartUsageBadge usage={r.part.usage} /></div>
                        ) : (
                          <div className="text-xs text-muted">{r.field.farmName}</div>
                        )}
                      </Cell>
                      <Cell align="end">{fmt.ha(c?.areaHa ?? r.areaHa)}</Cell>
                      <Cell>{r.previous ? <CropTag name={r.previous.cropName} color={r.previous.cropColor} /> : <span className="text-muted">—</span>}</Cell>
                      <Cell>
                        {c ? (
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
                        ) : can('crop.write') && r.usage !== 'leased_out' ? (
                          <Button size="sm" variant="quiet" onPress={() => setAssign({ fieldIds: [r.id] })}>
                            <Plus /> {t('crops.plan.assign')}
                          </Button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Cell>
                      <Cell className="tabular whitespace-nowrap">{c?.sowingDate ? fmt.date(c.sowingDate) : <span className="text-muted">—</span>}</Cell>
                      <Cell align="end">
                        {c?.expectedYieldTHa != null ? `${fmt.fixed(c.expectedYieldTHa, 1)} t/ha` : '—'}
                        {c?.expectedPricePerT != null && <div className="text-xs text-muted">{fmt.money(c.expectedPricePerT)}/t</div>}
                      </Cell>
                      <Cell>{c && <CropCycleStatusBadge status={c.status} />}</Cell>
                      <Cell>
                        {c && (can('crop.write') || can('operation.write')) && (
                          <MenuTrigger>
                            <AriaButton aria-label={t('crops.plan.actionsFor', { name: r.field.name })} className={buttonClass('ghost', 'icon-sm')}>
                              <MoreHorizontal className="size-4" />
                            </AriaButton>
                            <Menu
                              onAction={(key) => {
                                const [action, id] = String(key).split(':')
                                const cy = r.cycles.find((x) => x.id === id)
                                if (!cy) return
                                if (action === 'edit') setEdit(cy)
                                if (action === 'template') setApply(cy)
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
                  )
                }}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-6">
            <Card title={t('crops.areaByCrop')}>
              {byCrop.length ? <BarList items={byCrop} format={(v) => fmt.ha(v, 1)} /> : <p className="text-sm text-muted">{t('crops.noneAssigned')}</p>}
            </Card>
            <RotationsCard season={season} fields={fields.data ?? []} />
            <RotationHistoryCard fields={fields.data ?? []} cycles={allCycles.data ?? []} seasons={seasons} />
          </div>
        </div>
      )}

      {seasonOpen && <SeasonDialog seasons={seasons} onClose={() => setSeasonOpen(false)} />}
      {assign && season && <AssignDialog season={season} fields={targets} initialFieldIds={assign.fieldIds} onClose={() => setAssign(null)} />}
      {edit && <EditCycleDialog cycle={edit} onClose={() => setEdit(null)} />}
      {apply && <ApplyTemplateDialog cycle={apply} onClose={() => setApply(null)} />}
    </>
  )
}

/** What each field actually grew in the last seasons (main crops only). */
function RotationHistoryCard({ fields, cycles, seasons }: { fields: Field[]; cycles: CropCycle[]; seasons: Season[] }) {
  const { t } = useTranslation()
  const recent = [...seasons].sort((a, b) => a.harvestYear - b.harvestYear).slice(-4)
  if (recent.length < 2) return null
  const lookup = new Map(cycles.filter((c) => c.role === 'main').map((c) => [`${c.fieldId}:${c.seasonId}`, c]))
  return (
    <Card title={t('rotations.history.title')} description={t('crops.rotation.description')} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="text-left font-medium px-3 py-2">{t('crops.plan.field')}</th>
              {recent.map((s) => (
                <th key={s.id} className="text-left font-medium px-2 py-2 whitespace-nowrap">{s.harvestYear}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-1.5 font-medium text-fg truncate max-w-28">{f.name}</td>
                {recent.map((s) => {
                  const c = lookup.get(`${f.id}:${s.id}`)
                  return (
                    <td key={s.id} className="px-2 py-1.5">
                      {c ? (
                        <span className="inline-flex items-center gap-1 max-w-24" title={c.cropName}>
                          <span className="size-2 rounded-full shrink-0" style={{ background: c.cropColor }} aria-hidden />
                          <span className="truncate text-fg-2">{c.cropName}</span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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

interface CycleForm {
  cropId: string | null
  varietyName: string
  status: CropCycleStatus
  role: CropRole
  sowingDate: string | null
  expectedHarvestDate: string | null
  expectedYieldTHa: number
  expectedPricePerT: number
  areaHa: number
  notes: string
}

function useVarietyResolver() {
  return async (orgPath: string, cropId: string, name: string) => {
    if (!name.trim()) return null
    const v = await api.post<Variety>(`${orgPath}/varieties`, { cropId, name: name.trim() })
    return v.id
  }
}

function CycleFields({ value, onChange, crops, showArea }: { value: CycleForm; onChange: (v: CycleForm) => void; crops: Crop[]; showArea?: boolean }) {
  const { t } = useTranslation()
  const statusLabels: Record<CropCycleStatus, string> = {
    planned: t('crops.status.planned'),
    active: t('crops.status.active'),
    harvested: t('crops.status.harvested'),
    closed: t('crops.status.closed'),
  }
  const set = <K extends keyof CycleForm>(k: K, v: CycleForm[K]) => onChange({ ...value, [k]: v })
  const varieties = useOrgQuery<Variety[]>('/varieties', { cropId: value.cropId ?? undefined }, { enabled: !!value.cropId })
  const registered = useOrgQuery<RegisteredVariety[]>(value.cropId ? `/crops/${value.cropId}/registered-varieties` : null, undefined, { staleTime: 3_600_000 })
  // The organization's own varieties first, then the rest of the Bundessortenamt register and the EU catalogue.
  const varietyOptions = useMemo(() => {
    const byRegisteredId = new Map((registered.data ?? []).map((r) => [r.id, r]))
    const byKey = new Map((registered.data ?? []).map((r) => [varietyKey(r.name), r]))
    const used = (varieties.data ?? []).map((v) => ({ key: `org:${v.id}`, name: v.name, registered: (v.registeredVarietyId && byRegisteredId.get(v.registeredVarietyId)) || byKey.get(varietyKey(v.name)), used: true }))
    const usedNames = new Set(used.map((v) => varietyKey(v.name)))
    const rest = (registered.data ?? []).filter((r) => !usedNames.has(varietyKey(r.name))).map((r) => ({ key: `${r.source}:${r.id}`, name: r.name, registered: r, used: false }))
    return [...used, ...rest]
  }, [varieties.data, registered.data])
  // The EU catalogue lists thousands of maize varieties; the list shows the first matches only.
  const shownVarieties = useMemo(() => {
    const q = varietyKey(value.varietyName)
    return (q ? varietyOptions.filter((o) => varietyKey(o.name).includes(q)) : varietyOptions).slice(0, 100)
  }, [varietyOptions, value.varietyName])
  const describeVariety = (o: (typeof varietyOptions)[number]) => {
    const r = o.registered
    const register = !r
      ? null
      : r.source === 'eu'
        ? r.marketableUntil
          ? t('crops.form.varietyEuPhasingOut', { date: fmt.date(r.marketableUntil) })
          : t('crops.form.varietyEu', { countries: r.countries.length > 5 ? `${r.countries.slice(0, 4).join(', ')} +${r.countries.length - 4}` : r.countries.join(', ') })
        : r.marketableUntil
          ? t('crops.form.varietyPhasingOut', { number: r.registrationNumber, date: fmt.date(r.marketableUntil) })
          : r.conservationRegion
            ? t('crops.form.varietyConservation', { number: r.registrationNumber, region: r.conservationRegion })
            : t('crops.form.varietyApproved', { number: r.registrationNumber, date: fmt.date(r.approvedOn) })
    return [o.used ? t('crops.form.varietyUsed') : null, register].filter(Boolean).join(' · ') || undefined
  }
  const registeredCount = registered.data?.length ?? 0
  const hasEu = registered.data?.some((r) => r.source === 'eu')
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <ComboBox label={t('crops.form.crop')} isRequired items={crops} value={value.cropId} onChange={(v) => onChange({ ...value, cropId: v ? String(v) : null, varietyName: '' })} placeholder={t('crops.form.searchCrops')}>
        {(c) => (
          <Option id={c.id} textValue={c.name}>
            <CropTag name={c.name} color={c.color} />
          </Option>
        )}
      </ComboBox>
      <Select label={t('crops.form.role')} description={value.role !== 'main' ? t('crops.form.roleHint') : undefined} items={CROP_ROLES.map((r) => ({ id: r, name: cropRoleLabel(r) }))} value={value.role} onChange={(v) => v && set('role', v as CropRole)}>
        {(r) => <Option id={r.id}>{r.name}</Option>}
      </Select>
      <ComboBox
        label={t('crops.form.variety')}
        allowsCustomValue
        items={shownVarieties}
        defaultFilter={() => true}
        inputValue={value.varietyName}
        onInputChange={(v) => set('varietyName', v)}
        isDisabled={!value.cropId}
        placeholder={t('crops.form.varietyPlaceholder')}
        description={registeredCount ? t(hasEu ? 'crops.form.varietyRegisteredEuHint' : 'crops.form.varietyRegisteredHint', { count: registeredCount }) : undefined}
      >
        {(o) => (
          <Option id={o.key} textValue={o.name} description={describeVariety(o)}>
            {o.name}
          </Option>
        )}
      </ComboBox>
      <Select label={t('common.status')} items={CROP_CYCLE_STATUSES.map((s) => ({ id: s, name: statusLabels[s] }))} value={value.status} onChange={(v) => v && set('status', v as CropCycleStatus)}>
        {(s) => <Option id={s.id}>{s.name}</Option>}
      </Select>
      <DatePicker label={t('crops.form.sowingDate')} value={value.sowingDate} onChange={(v) => set('sowingDate', v)} />
      <DatePicker label={t('crops.form.expectedHarvest')} value={value.expectedHarvestDate} onChange={(v) => set('expectedHarvestDate', v)} />
      <NumberField label={t('crops.form.expectedYield')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={value.expectedYieldTHa} onChange={(v) => set('expectedYieldTHa', v)} />
      <NumberField label={t('crops.form.expectedPrice')} unit="€/t" minValue={0} value={value.expectedPricePerT} onChange={(v) => set('expectedPricePerT', v)} />
      {showArea && <NumberField label={t('crops.form.plantedArea')} unit="ha" minValue={0} step={0.01} description={t('crops.form.plantedAreaHint')} value={value.areaHa} onChange={(v) => set('areaHa', v)} />}
      <TextField label={t('common.notes')} multiline rows={2} value={value.notes} onChange={(v) => set('notes', v)} className="sm:col-span-2" />
    </div>
  )
}

function AssignDialog({ season, fields, initialFieldIds, onClose }: { season: Season; fields: PlanTarget[]; initialFieldIds: string[]; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  const [fieldIds, setFieldIds] = useState<string[]>(initialFieldIds)
  const [form, setForm] = useState<CycleForm>({ cropId: null, varietyName: '', status: 'planned', role: 'main', sowingDate: null, expectedHarvestDate: null, expectedYieldTHa: NaN, expectedPricePerT: NaN, areaHa: NaN, notes: '' })
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

function EditCycleDialog({ cycle, onClose }: { cycle: CropCycle; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  // A crop on a field divided in its season can move to another part (not to a leased-out one).
  const parts = useOrgQuery<FieldPart[]>(`/fields/${cycle.fieldId}/parts`, { seasonId: cycle.seasonId })
  const [fieldPartId, setFieldPartId] = useState(cycle.fieldPartId)
  const [form, setForm] = useState<CycleForm>({
    cropId: cycle.cropId,
    varietyName: cycle.varietyName ?? '',
    status: cycle.status,
    role: cycle.role,
    sowingDate: cycle.sowingDate,
    expectedHarvestDate: cycle.expectedHarvestDate,
    expectedYieldTHa: cycle.expectedYieldTHa ?? NaN,
    expectedPricePerT: cycle.expectedPricePerT ?? NaN,
    areaHa: NaN,
    notes: cycle.notes ?? '',
  })
  const save = useOrgMutation(
    async (base, _: void) => {
      const varietyId = form.cropId ? await resolveVariety(base, form.cropId, form.varietyName) : null
      return api.patch<CropCycle>(`${base}/crop-cycles/${cycle.id}`, {
        cropId: form.cropId,
        varietyId,
        status: form.status,
        role: form.role,
        sowingDate: form.sowingDate,
        expectedHarvestDate: form.expectedHarvestDate,
        expectedYieldTHa: num(form.expectedYieldTHa),
        expectedPricePerT: num(form.expectedPricePerT),
        ...(Number.isNaN(form.areaHa) ? {} : { areaHa: form.areaHa }),
        ...(fieldPartId && fieldPartId !== cycle.fieldPartId ? { fieldPartId } : {}),
        notes: form.notes || null,
      })
    },
    { success: t('crops.updated'), onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={`${cycle.fieldName} · ${cycle.seasonName}`} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {(parts.data?.length ?? 0) > 0 && (
          <Select
            label={t('crops.part')}
            description={t('crops.partDescription')}
            items={parts.data ?? []}
            value={fieldPartId}
            onChange={(v) => setFieldPartId(v ? String(v) : cycle.fieldPartId)}
            disabledKeys={(parts.data ?? []).filter((p) => p.usage === 'leased_out' && p.id !== cycle.fieldPartId).map((p) => p.id)}
          >
            {(p) => (
              <Option
                id={p.id}
                textValue={p.name}
                description={[
                  fmt.ha(p.areaHa, 1),
                  t(`fieldParts.usage.${p.usage}`),
                  ...p.crops.filter((c) => c.cropCycleId !== cycle.id).map((c) => c.cropName),
                ].join(' · ')}
              >
                {p.name}
              </Option>
            )}
          </Select>
        )}
        <CycleFields value={form} onChange={setForm} crops={crops.data ?? []} showArea />
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!form.cropId || parts.isLoading} isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function ApplyTemplateDialog({ cycle, onClose }: { cycle: CropCycle; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const options = (templates.data ?? []).filter((x) => x.cropId === cycle.cropId)
  const [picked, setPicked] = useState<string | null>(cycle.templateId)
  const selected = options.find((x) => x.id === picked) ?? options[0]
  const apply = useOrgMutation(
    (base, replace: boolean) => api.post<ApplyTemplateResult>(`${base}/crop-cycles/${cycle.id}/apply-template`, { templateId: selected?.id, replace }),
    {
      success: (r) => (r.removed ? t('templates.apply.replaced', { count: r.created, removed: r.removed }) : t('templates.apply.success', { count: r.created })),
      onSuccess: onClose,
      silentError: true,
    },
  )
  // Applied before: the API keeps completed work and only swaps the planned operations, on request.
  const alreadyApplied = (apply.error instanceof ApiRequestError && apply.error.code === 'template_applied') || (apply.isPending && apply.variables === true)
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('templates.apply.title')} description={`${cycle.fieldName}${cycle.fieldPartName ? ` · ${cycle.fieldPartName}` : ''} · ${cycle.cropName} · ${cycle.seasonName}`} size="md">
      {templates.isLoading ? (
        <Loading />
      ) : !options.length ? (
        <div className="space-y-4">
          <Notice tone="info">{t('templates.apply.none', { crop: cycle.cropName })}</Notice>
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.close')}</Button>
            <Link to="/o/$orgId/templates" params={{ orgId }} variant="primary"><ListChecks /> {t('nav.templates')}</Link>
          </div>
        </div>
      ) : (
        <Form onSubmit={(e) => { e.preventDefault(); apply.mutate(alreadyApplied) }} className="space-y-4">
          <Select
            label={t('templates.apply.template')}
            items={options}
            value={selected?.id ?? null}
            onChange={(v) => { setPicked(v ? String(v) : null); apply.reset() }}
          >
            {(x) => <Option id={x.id} textValue={x.name} description={t('templates.stepCount', { count: x.steps.length })}>{x.name}</Option>}
          </Select>
          {cycle.templateName && <p className="text-xs text-muted">{t('templates.apply.current', { name: cycle.templateName })}</p>}
          {selected && selected.steps.length > 0 && (
            <ol className="rounded-lg border border-line divide-y divide-line max-h-64 overflow-y-auto text-sm">
              {selected.steps.map((s) => (
                <li key={s.id} className="px-3 py-2 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{s.title}</span>
                    <span className="block text-xs text-muted">{operationTypeLabel(s.type)}{s.bbchStage ? ` · BBCH ${s.bbchStage}` : ''}</span>
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap">{templateStepTiming(s.anchor, s.offsetDays)}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted">{t('templates.apply.hint')}</p>
          {alreadyApplied ? (
            <Notice tone="warning">{t('templates.apply.alreadyApplied')}</Notice>
          ) : (
            apply.error && <Notice tone="danger">{errorMessage(apply.error)}</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isDisabled={!selected} isPending={apply.isPending}>
              {alreadyApplied ? t('templates.apply.replace') : t('templates.apply.submit')}
            </Button>
          </div>
        </Form>
      )}
    </ModalDialog>
  )
}

// ---------------------------------------------------------------------------
// Crop rotations: planned sequences of crops that fields follow year by year.
// ---------------------------------------------------------------------------

function RotationsCard({ season, fields }: { season: Season | null; fields: Field[] }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const rotations = useOrgQuery<CropRotation[]>('/rotations')
  const [editing, setEditing] = useState<CropRotation | 'new' | null>(null)
  const [assigning, setAssigning] = useState<CropRotation | null>(null)
  const [rollOver, setRollOver] = useState(false)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/rotations/${id}`), { success: t('rotations.toast.deleted') })
  const unassign = useOrgMutation((base, id: string) => api.delete(`${base}/rotation-assignments/${id}`), { success: t('rotations.toast.unassigned') })
  const writable = can('crop.write')
  const list = rotations.data ?? []
  return (
    <Card
      title={t('rotations.title')}
      description={t('rotations.description')}
      padded={false}
      actions={writable && <Button size="icon-sm" variant="ghost" aria-label={t('rotations.new')} onPress={() => setEditing('new')}><Plus /></Button>}
    >
      {rotations.isLoading ? (
        <div className="p-4"><Loading /></div>
      ) : !list.length ? (
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted">{t('rotations.empty')}</p>
          {writable && <Button size="sm" onPress={() => setEditing('new')}><Plus /> {t('rotations.new')}</Button>}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((rot) => (
            <li key={rot.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg truncate">{rot.name}</div>
                  <div className="text-xs text-muted">{t('rotations.fieldCount', { count: rot.fields.length })}</div>
                </div>
                {writable && (
                  <div className="flex -mr-1.5 -mt-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.assign.titleNamed', { name: rot.name })} onPress={() => setAssigning(rot)}><MapPin /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.editNamed', { name: rot.name })} onPress={() => setEditing(rot)}><Pencil /></Button>
                    <ConfirmButton
                      title={t('rotations.delete.title', { name: rot.name })}
                      message={t('rotations.delete.message')}
                      confirmLabel={t('common.delete')}
                      onConfirm={() => remove.mutateAsync(rot.id)}
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={t('rotations.deleteNamed', { name: rot.name })}><Trash2 /></Button>}
                    />
                  </div>
                )}
              </div>
              <ol className="flex flex-wrap items-start gap-x-1 gap-y-1.5" aria-label={t('rotations.sequence')}>
                {rot.entries.map((e, i) => (
                  <li key={e.position} className="flex items-start gap-1">
                    {i > 0 && <ArrowRight className="size-3 text-muted mt-1.5 shrink-0" aria-hidden />}
                    <span className="flex flex-col">
                      <CropTag name={e.cropName} color={e.cropColor} />
                      {e.catchCropName && <span className="text-[11px] text-muted pl-4">+ {e.catchCropName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {rot.fields.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {rot.fields.map((f) => (
                    <li key={f.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 pl-2 pr-0.5 py-0.5 text-xs text-fg-2 max-w-full">
                      <span className="truncate">{f.fieldName}</span>
                      <span className="text-muted tabular whitespace-nowrap">{f.endYear ? `${f.startYear}–${f.endYear}` : t('rotations.since', { year: f.startYear })}</span>
                      {writable ? (
                        <AriaButton aria-label={t('rotations.unassign', { field: f.fieldName })} onPress={() => unassign.mutate(f.id)} className={cx('size-5 rounded-full flex items-center justify-center text-muted hover:bg-surface-3 hover:text-fg cursor-pointer', focusRing)}>
                          <X className="size-3" />
                        </AriaButton>
                      ) : (
                        <span className="pr-1.5" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {writable && season && list.some((r) => r.fields.length > 0) && (
        <div className="p-4 border-t border-line">
          <Button variant="primary" className="w-full" onPress={() => setRollOver(true)}>
            <Repeat /> {t('rotations.rollOver.button')}
          </Button>
          <p className="text-xs text-muted mt-1.5">{t('rotations.rollOver.hint', { season: season.name })}</p>
        </div>
      )}
      {editing && <RotationDialog rotation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {assigning && <AssignRotationDialog rotation={assigning} rotations={list} fields={fields} defaultYear={season?.harvestYear ?? Number(today().slice(0, 4))} onClose={() => setAssigning(null)} />}
      {rollOver && season && <RollOverDialog season={season} onClose={() => setRollOver(false)} />}
    </Card>
  )
}

interface EntryForm {
  key: number
  cropId: string | null
  templateId: string | null
  catchCropId: string | null
  expectedYieldTHa: number
}

let entryKeySeq = 0
const newEntry = (): EntryForm => ({ key: entryKeySeq++, cropId: null, templateId: null, catchCropId: null, expectedYieldTHa: NaN })

function RotationDialog({ rotation, onClose }: { rotation: CropRotation | null; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const coverCrops = (crops.data ?? []).filter((c) => c.category === 'cover')
  const [name, setName] = useState(rotation?.name ?? '')
  const [notes, setNotes] = useState(rotation?.notes ?? '')
  const [entries, setEntries] = useState<EntryForm[]>(() =>
    rotation
      ? rotation.entries.map((e) => ({ key: entryKeySeq++, cropId: e.cropId, templateId: e.templateId, catchCropId: e.catchCropId, expectedYieldTHa: e.expectedYieldTHa ?? NaN }))
      : [newEntry(), newEntry(), newEntry()],
  )
  const update = (key: number, patch: Partial<EntryForm>) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  const move = (index: number, by: -1 | 1) =>
    setEntries((list) => {
      const next = [...list]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })
  const valid = !!name.trim() && entries.length > 0 && entries.every((e) => e.cropId)
  const body: RotationInput = {
    name,
    notes: notes || null,
    entries: entries.map((e) => ({ cropId: e.cropId ?? '', templateId: e.templateId, catchCropId: e.catchCropId, expectedYieldTHa: num(e.expectedYieldTHa) })),
  }
  const save = useOrgMutation((base, _: void) => (rotation ? api.put<CropRotation>(`${base}/rotations/${rotation.id}`, body) : api.post<CropRotation>(`${base}/rotations`, body)), {
    success: rotation ? t('rotations.toast.updated') : t('rotations.toast.created'),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={rotation ? t('rotations.dialog.editTitle') : t('rotations.new')} size="lg">
      <Form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('rotations.dialog.namePlaceholder')} />
          <TextField label={t('common.notes')} value={notes} onChange={setNotes} />
        </div>
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">{t('rotations.entries.title')}</h3>
              <p className="text-xs text-muted mt-0.5">{t('rotations.entries.description')}</p>
            </div>
            <Button size="sm" isDisabled={entries.length >= 12} onPress={() => setEntries((list) => [...list, newEntry()])}>
              <Plus /> {t('rotations.entries.add')}
            </Button>
          </div>
          <ol className="space-y-3">
            {entries.map((e, i) => {
              const cropTemplates = (templates.data ?? []).filter((x) => x.cropId === e.cropId)
              return (
                <li key={e.key} className="rounded-lg border border-line p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted uppercase tracking-wider flex-1">{t('rotations.entries.year', { n: i + 1 })}</span>
                    <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveUp')} isDisabled={i === 0} onPress={() => move(i, -1)}><ChevronUp /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveDown')} isDisabled={i === entries.length - 1} onPress={() => move(i, 1)}><ChevronDown /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.entries.remove')} isDisabled={entries.length === 1} onPress={() => setEntries((list) => list.filter((x) => x.key !== e.key))}><Trash2 /></Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <ComboBox
                      label={t('crops.form.crop')}
                      isRequired
                      items={crops.data ?? []}
                      value={e.cropId}
                      // A template belongs to one crop; drop it when the crop changes.
                      onChange={(v) => update(e.key, { cropId: v ? String(v) : null, templateId: null })}
                      placeholder={t('crops.form.searchCrops')}
                    >
                      {(c) => (
                        <Option id={c.id} textValue={c.name}>
                          <CropTag name={c.name} color={c.color} />
                        </Option>
                      )}
                    </ComboBox>
                    <Select
                      label={t('rotations.entries.template')}
                      isDisabled={!e.cropId}
                      items={[{ id: '__none', name: t('rotations.entries.noTemplate') }, ...cropTemplates]}
                      value={e.templateId ?? '__none'}
                      onChange={(v) => update(e.key, { templateId: v && v !== '__none' ? String(v) : null })}
                    >
                      {(x) => <Option id={x.id}>{x.name}</Option>}
                    </Select>
                    <Select
                      label={t('rotations.entries.catchCrop')}
                      description={t('rotations.entries.catchCropHint')}
                      items={[{ id: '__none', name: t('common.none') }, ...coverCrops]}
                      value={e.catchCropId ?? '__none'}
                      onChange={(v) => update(e.key, { catchCropId: v && v !== '__none' ? String(v) : null })}
                    >
                      {(c) => <Option id={c.id} textValue={c.name}>{'color' in c ? <CropTag name={c.name} color={c.color} /> : c.name}</Option>}
                    </Select>
                    <NumberField label={t('crops.form.expectedYield')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={e.expectedYieldTHa} onChange={(v) => update(e.key, { expectedYieldTHa: v })} />
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!valid} isPending={save.isPending}>{rotation ? t('common.save') : t('common.create')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function AssignRotationDialog({ rotation, rotations, fields, defaultYear, onClose }: { rotation: CropRotation; rotations: CropRotation[]; fields: Field[]; defaultYear: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [startYear, setStartYear] = useState(defaultYear)
  const [endYear, setEndYear] = useState(NaN)
  // Shown next to each field so a second rotation is assigned knowingly.
  const followed = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of rotations) for (const f of r.fields) m.set(f.fieldId, [...(m.get(f.fieldId) ?? []), r.name])
    return m
  }, [rotations])
  const area = fields.filter((f) => fieldIds.includes(f.id)).reduce((s, f) => s + f.areaHa, 0)
  const save = useOrgMutation((base, _: void) => api.post(`${base}/rotations/${rotation.id}/fields`, { fieldIds, startYear, endYear: num(endYear) }), {
    success: t('rotations.assign.success', { count: fieldIds.length }),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('rotations.assign.title')} description={rotation.name} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <div>
          <div className="text-sm font-medium text-fg-2 mb-2">{t('crops.assign.fields')} <span className="text-muted font-normal">· {t('crops.assign.selected', { count: fieldIds.length, area: fmt.ha(area, 1) })}</span></div>
          <div className="border border-line rounded-lg max-h-72 overflow-y-auto divide-y divide-line">
            {fields.map((f) => (
              <div key={f.id} className={cx('px-3 py-2', fieldIds.includes(f.id) && 'bg-primary-soft/50')}>
                <Checkbox isSelected={fieldIds.includes(f.id)} onChange={(sel) => setFieldIds((ids) => (sel ? [...ids, f.id] : ids.filter((i) => i !== f.id)))}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-xs text-muted truncate">{[fmt.ha(f.areaHa, 1), ...(followed.get(f.id) ?? [])].join(' · ')}</span>
                  </span>
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('rotations.assign.startYear')} description={t('rotations.assign.startYearHint')} isRequired value={startYear} formatOptions={{ useGrouping: false }} minValue={1990} maxValue={2200} onChange={setStartYear} />
          <NumberField label={t('rotations.assign.endYear')} value={endYear} formatOptions={{ useGrouping: false }} minValue={Number.isNaN(startYear) ? 1990 : startYear} maxValue={2200} onChange={setEndYear} placeholder={t('common.optional')} />
        </div>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!fieldIds.length || Number.isNaN(startYear)} isPending={save.isPending}>
            <MapPin /> {t('rotations.assign.submit', { count: fieldIds.length })}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

const OUTCOME_TONE: Record<RollOverResult['fields'][number]['outcome'], BadgeTone> = { created: 'success', already_planned: 'neutral', field_divided: 'warning' }

function RollOverDialog({ season, onClose }: { season: Season; onClose: () => void }) {
  const { t } = useTranslation()
  const [applyTemplates, setApplyTemplates] = useState(true)
  const [result, setResult] = useState<RollOverResult | null>(null)
  const run = useOrgMutation((base, _: void) => api.post<RollOverResult>(`${base}/rotations/roll-over`, { targetSeasonId: season.id, applyTemplates }), {
    success: (r) => t('rotations.rollOver.success', { count: r.created }),
    onSuccess: setResult,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('rotations.rollOver.title', { season: season.name })} size="md">
      {result ? (
        <div className="space-y-4">
          <Notice tone={result.created ? 'success' : 'info'}>
            {result.fields.length ? t('rotations.rollOver.summary', { count: result.created, skipped: result.skipped }) : t('rotations.rollOver.nothing', { year: season.harvestYear })}
          </Notice>
          {result.fields.length > 0 && (
            <ul className="rounded-lg border border-line divide-y divide-line max-h-80 overflow-y-auto">
              {result.fields.map((f) => (
                <li key={f.fieldId} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.fieldName}</span>
                    {f.cropName && <span className="block text-xs text-muted truncate">{f.cropName}</span>}
                  </span>
                  <Badge tone={OUTCOME_TONE[f.outcome]}>{t(`rotations.outcome.${f.outcome}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {result.fields.some((f) => f.outcome === 'field_divided') && <p className="text-xs text-muted">{t('rotations.rollOver.dividedHint')}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onPress={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <Form onSubmit={(e) => { e.preventDefault(); run.mutate() }} className="space-y-4">
          <p className="text-sm text-fg-2">{t('rotations.rollOver.body', { season: season.name, year: season.harvestYear })}</p>
          <Checkbox isSelected={applyTemplates} onChange={setApplyTemplates}>{t('rotations.rollOver.applyTemplates')}</Checkbox>
          <p className="text-xs text-muted -mt-2 pl-6">{t('rotations.rollOver.applyTemplatesHint')}</p>
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isPending={run.isPending}><Repeat /> {t('rotations.rollOver.submit')}</Button>
          </div>
        </Form>
      )}
    </ModalDialog>
  )
}
