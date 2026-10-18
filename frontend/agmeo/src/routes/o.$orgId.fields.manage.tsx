import { TENURES, type BulkFieldResult, type Farm, type Field, type FieldGroup, type MergePreview, type Tenure } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowLeft, Combine, ListOrdered, Save, Tag, Tags, Trash2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShape } from '#/components/map/FieldShape'
import { FieldMap } from '#/components/map/FieldMap'
import { CropTag } from '#/components/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, Option, SearchField, Select, Switch, TextField } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/fields/manage')({ component: ManageFields })

type Edit = Partial<Pick<Field, 'name' | 'parcelNumber' | 'identifier' | 'tenure'>>

/** Field list for bulk maintenance: names, numbers, identifiers, groups, merging and archiving. */
function ManageFields() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId } = useSeason()
  const qc = useQueryClient()
  const writable = can('field.write')
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [farmId, setFarmId] = useState<string>('all')
  const [groupId, setGroupId] = useState<string>('all')
  const fields = useOrgQuery<Field[]>('/fields', { seasonId, includeArchived: showArchived || undefined }, { keepPrevious: true })
  const farms = useOrgQuery<Farm[]>('/farms')
  const groups = useOrgQuery<FieldGroup[]>('/field-groups')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<'merge' | 'archive' | 'delete' | 'group' | null>(null)

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const rows = (fields.data ?? []).filter(
    (f) =>
      (farmId === 'all' || f.farmId === farmId) &&
      (groupId === 'all' || f.groups.some((g) => g.id === groupId)) &&
      words.every((w) => [f.name, f.parcelNumber, f.identifier, f.farmName, f.currentCrop?.cropName, ...f.groups.map((g) => g.name)].some((v) => v?.toLowerCase().includes(w))),
  )
  const sel = rows.filter((r) => selected.has(r.id))
  const dirty = Object.keys(edits).filter((id) => Object.keys(edits[id]).length)
  const value = <K extends keyof Edit>(f: Field, k: K): Field[K] => (edits[f.id]?.[k] !== undefined ? (edits[f.id][k] as Field[K]) : f[k])
  const setEdit = (f: Field, patch: Edit) =>
    setEdits((e) => {
      const next = { ...e[f.id], ...patch }
      for (const k of Object.keys(next) as (keyof Edit)[]) if ((next[k] ?? null) === (f[k] ?? null)) delete next[k]
      return { ...e, [f.id]: next }
    })

  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId] })
  const saveAll = async () => {
    if (dirty.some((id) => edits[id].name !== undefined && !edits[id].name?.trim())) return toast.error(t('fieldsManage.nameRequired'))
    setSaving(true)
    const results = await Promise.allSettled(
      dirty.map((id) => {
        const e = edits[id]
        return api.patch(`/orgs/${orgId}/fields/${id}`, {
          name: e.name?.trim(),
          parcelNumber: e.parcelNumber !== undefined ? e.parcelNumber || null : undefined,
          identifier: e.identifier !== undefined ? e.identifier || null : undefined,
          tenure: e.tenure,
        })
      }),
    )
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [dirty[i]] : []))
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => failed.includes(id))))
    setSaving(false)
    await refresh()
    if (failed.length) toast.error(t('fieldsManage.saveFailed', { count: failed.length }), errorMessage((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason))
    else toast.success(t('fieldsManage.saved', { count: dirty.length }))
  }

  const bulk = useOrgMutation(
    (base, { action, body }: { action: 'restore' | 'renumber'; body: object }) => api.post<BulkFieldResult | null>(`${base}/fields/${action}`, body),
    { onSuccess: () => setSelected(new Set()) },
  )
  const removeFromGroup = useOrgMutation((base, g: string) => api.post(`${base}/field-groups/members/remove`, { groupId: g, fieldIds: sel.map((f) => f.id) }), { success: t('fieldsManage.groups.removed') })

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const selGroups = [...new Map(sel.flatMap((f) => f.groups).map((g) => [g.id, g])).values()]

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/o/$orgId/fields" params={{ orgId }} variant="quiet" size="sm"><ArrowLeft /> {t('fields.title')}</Link>}
        title={t('fieldsManage.title')}
        subtitle={t('fieldsManage.subtitle')}
      />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <SearchField aria-label={t('fieldsManage.search')} placeholder={t('fieldsManage.search')} value={search} onChange={setSearch} className="w-full sm:w-64" />
        <Select aria-label={t('fieldsManage.farm')} className="w-48" items={[{ id: 'all', name: t('fieldsManage.allFarms') }, ...(farms.data ?? []).map((f) => ({ id: f.id, name: f.name }))]} value={farmId} onChange={(v) => setFarmId(String(v ?? 'all'))}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <Select aria-label={t('fieldsManage.group')} className="w-48" items={[{ id: 'all', name: t('fieldsManage.allGroups') }, ...(groups.data ?? []).map((g) => ({ id: g.id, name: `${g.name} (${g.fieldCount})` }))]} value={groupId} onChange={(v) => setGroupId(String(v ?? 'all'))}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <Switch isSelected={showArchived} onChange={setShowArchived}>{t('fieldsManage.showArchived')}</Switch>
      </div>

      {fields.error ? <ErrorNotice error={fields.error} /> : fields.isPending ? <Loading /> : !rows.length ? (
        <EmptyState icon={Tags} title={t('fieldsManage.empty')} />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted border-b border-line">
                <tr className="text-left">
                  {writable && <th className="w-10 px-3 py-2"><Checkbox aria-label={t('fieldsManage.selectAll')} isSelected={allSelected} isIndeterminate={!allSelected && sel.length > 0} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
                  <th className="px-3 py-2 font-medium">{t('fieldsManage.col.name')}</th>
                  <th className="px-3 py-2 font-medium w-24">{t('fieldsManage.col.number')}</th>
                  <th className="px-3 py-2 font-medium w-44">{t('fieldsManage.col.identifier')}</th>
                  <th className="px-3 py-2 font-medium">{t('fieldsManage.col.farm')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('fieldsManage.col.area')}</th>
                  <th className="px-3 py-2 font-medium w-36">{t('fieldsManage.col.tenure')}</th>
                  <th className="px-3 py-2 font-medium">{t('fieldsManage.col.groups')}</th>
                  <th className="px-3 py-2 font-medium">{t('fieldsManage.col.crop')}</th>
                  <th className="px-3 py-2 font-medium">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const archived = f.status === 'archived'
                  const rowDirty = !!edits[f.id] && Object.keys(edits[f.id]).length > 0
                  const cellInput = (k: 'name' | 'parcelNumber' | 'identifier', width: string) => (
                    <input
                      aria-label={`${t(`fieldsManage.col.${k === 'parcelNumber' ? 'number' : k}`)} · ${f.name}`}
                      value={(value(f, k) as string | null) ?? ''}
                      disabled={!writable}
                      onChange={(e) => setEdit(f, { [k]: e.target.value } as Edit)}
                      className={cx('h-8 rounded-md border bg-transparent px-2 outline-none focus:border-primary focus:bg-surface', width, edits[f.id]?.[k] !== undefined ? 'border-warning bg-warning-soft/40' : 'border-transparent hover:border-line')}
                    />
                  )
                  return (
                    <tr key={f.id} className={cx('border-b border-line/60 last:border-0', selected.has(f.id) && 'bg-primary-soft/40', archived && 'opacity-60', rowDirty && 'ring-1 ring-inset ring-warning/50')}>
                      {writable && <td className="px-3 py-1.5"><Checkbox aria-label={t('fieldsManage.select', { name: f.name })} isSelected={selected.has(f.id)} onChange={() => toggle(f.id)} /></td>}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <FieldShape geometry={f.geometry} fill={f.currentCrop?.color ?? '#9aa392'} className="size-7 shrink-0 text-fg" />
                          {cellInput('name', 'w-48')}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">{cellInput('parcelNumber', 'w-20')}</td>
                      <td className="px-3 py-1.5">{cellInput('identifier', 'w-40')}</td>
                      <td className="px-3 py-1.5 text-muted whitespace-nowrap">{f.farmName}</td>
                      <td className="px-3 py-1.5 text-right tabular whitespace-nowrap">{fmt.ha(f.areaHa)}</td>
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={`${t('fieldsManage.col.tenure')} · ${f.name}`}
                          disabled={!writable}
                          value={value(f, 'tenure')}
                          onChange={(e) => setEdit(f, { tenure: e.target.value as Tenure })}
                          className={cx('h-8 rounded-md border bg-transparent px-1.5 outline-none focus:border-primary', edits[f.id]?.tenure !== undefined ? 'border-warning bg-warning-soft/40' : 'border-transparent hover:border-line')}
                        >
                          {TENURES.map((x) => <option key={x} value={x}>{t(`enum.tenure.${x}`)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {f.groups.map((g) => <span key={g.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: g.color }}>{g.name}</span>)}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">{f.currentCrop ? <CropTag name={f.currentCrop.cropName} color={f.currentCrop.color} /> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {archived ? (
                          <Badge tone="neutral">{f.mergedIntoId ? t('fieldsManage.status.merged', { date: fmt.date(f.archivedFrom) }) : t('fieldsManage.status.archived', { date: fmt.date(f.archivedFrom) })}</Badge>
                        ) : (
                          <Badge tone="success">{t('fieldsManage.status.active')}</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dirty.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-center mt-4">
          <div className="flex items-center gap-3 rounded-xl border border-warning bg-surface px-4 py-2 shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-medium">{t('fieldsManage.unsaved', { count: dirty.length })}</span>
            <Button size="sm" variant="ghost" onPress={() => setEdits({})}><Undo2 /> {t('fieldsManage.discard')}</Button>
            <Button size="sm" variant="primary" isPending={saving} onPress={() => void saveAll()}><Save /> {t('common.save')}</Button>
          </div>
        </div>
      )}

      {writable && sel.length > 0 && dirty.length === 0 && (
        <div className="sticky bottom-4 z-20 flex justify-center mt-4 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-medium px-1 tabular">{t('table.selected', { count: sel.length })}</span>
            <span className="h-5 w-px bg-line" aria-hidden />
            <Button size="sm" onPress={() => setDialog('group')}><Tag /> {t('fieldsManage.groups.add')}</Button>
            {selGroups.length > 0 && (
              <Select aria-label={t('fieldsManage.groups.remove')} placeholder={t('fieldsManage.groups.remove')} className="w-44" items={selGroups.map((g) => ({ id: g.id, name: g.name }))} value={null} onChange={(v) => v && removeFromGroup.mutate(String(v))}>
                {(o) => <Option id={o.id}>{o.name}</Option>}
              </Select>
            )}
            <Button size="sm" onPress={() => bulk.mutate({ action: 'renumber', body: { fieldIds: sel.map((f) => f.id), start: 1 } }, { onSuccess: () => toast.success(t('fieldsManage.renumbered', { count: sel.length })) })}>
              <ListOrdered /> {t('fieldsManage.renumber')}
            </Button>
            <Button size="sm" isDisabled={sel.length !== 2 || sel.some((f) => f.status !== 'active')} onPress={() => setDialog('merge')}><Combine /> {t('fieldsManage.merge.action')}</Button>
            {sel.some((f) => f.status === 'active') && <Button size="sm" onPress={() => setDialog('archive')}><Archive /> {t('fieldsManage.archive.action')}</Button>}
            {sel.some((f) => f.status === 'archived') && (
              <Button size="sm" onPress={() => bulk.mutate({ action: 'restore', body: { fieldIds: sel.filter((f) => f.status === 'archived').map((f) => f.id) } }, { onSuccess: (r) => toast.success(t('fieldsManage.restored', { count: r?.done.length ?? 0 })) })}>
                <ArchiveRestore /> {t('fieldsManage.restore')}
              </Button>
            )}
            <Button size="sm" className="text-danger" onPress={() => setDialog('delete')}><Trash2 /> {t('common.delete')}</Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('table.clearSelection')} onPress={() => setSelected(new Set())}><X /></Button>
          </div>
        </div>
      )}

      {dialog === 'group' && <AddToGroupDialog fieldIds={sel.map((f) => f.id)} groups={groups.data ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'archive' && <ArchiveDialog fields={sel.filter((f) => f.status === 'active')} onClose={() => { setDialog(null); setSelected(new Set()) }} />}
      {dialog === 'delete' && <DeleteDialog fields={sel} onClose={() => { setDialog(null); setSelected(new Set()) }} />}
      {dialog === 'merge' && sel.length === 2 && <MergeDialog fields={sel} onClose={() => { setDialog(null); setSelected(new Set()) }} />}
    </>
  )
}

function AddToGroupDialog({ fieldIds, groups, onClose }: { fieldIds: string[]; groups: FieldGroup[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const add = useOrgMutation((base, _: void) => {
    const existing = groups.find((g) => g.name.toLowerCase() === name.trim().toLowerCase())
    return api.post(`${base}/field-groups/members`, existing ? { fieldIds, groupId: existing.id } : { fieldIds, groupName: name.trim() })
  }, { success: t('fieldsManage.groups.added', { count: fieldIds.length }), onSuccess: onClose })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldsManage.groups.addTitle', { count: fieldIds.length })} size="sm"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!name.trim()} isPending={add.isPending} onPress={() => add.mutate()}>{t('fieldsManage.groups.add')}</Button>
        </>
      )}
    >
      <ComboBox label={t('fieldsManage.groups.name')} description={t('fieldsManage.groups.nameHint')} allowsCustomValue items={groups.map((g) => ({ id: g.id, name: g.name }))} inputValue={name} onInputChange={setName} autoFocus>
        {(o) => <Option id={o.id}>{o.name}</Option>}
      </ComboBox>
    </ModalDialog>
  )
}

function ArchiveDialog({ fields, onClose }: { fields: Field[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [from, setFrom] = useState<string | null>(today())
  const archive = useOrgMutation((base, _: void) => api.post<BulkFieldResult>(`${base}/fields/archive`, { fieldIds: fields.map((f) => f.id), archivedFrom: from }), {
    success: (r) => t('fieldsManage.archived', { count: r.done.length }),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldsManage.archive.title', { count: fields.length })} size="sm"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!from} isPending={archive.isPending} onPress={() => archive.mutate()}><Archive /> {t('fieldsManage.archive.action')}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-2">{t('fieldsManage.archive.message')}</p>
        <DatePicker label={t('fieldsManage.archive.from')} value={from} onChange={setFrom} isRequired />
      </div>
    </ModalDialog>
  )
}

function DeleteDialog({ fields, onClose }: { fields: Field[]; onClose: () => void }) {
  const { t } = useTranslation()
  const phrase = t('fieldsManage.delete.phrase')
  const [typed, setTyped] = useState('')
  const remove = useOrgMutation((base, _: void) => api.post<BulkFieldResult>(`${base}/fields/delete`, { fieldIds: fields.map((f) => f.id) }), {
    onSuccess: (r) => {
      if (r.done.length) toast.success(t('fieldsManage.deleted', { count: r.done.length }))
      if (r.failed.length) toast.error(t('fieldsManage.delete.kept', { count: r.failed.length }), r.failed.slice(0, 5).map((f) => f.fieldName).join(', '))
      onClose()
    },
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldsManage.delete.title', { count: fields.length })} size="sm"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="danger" isDisabled={typed.trim().toLowerCase() !== phrase.toLowerCase()} isPending={remove.isPending} onPress={() => remove.mutate()}><Trash2 /> {t('common.delete')}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Notice tone="warning">{t('fieldsManage.delete.message')}</Notice>
        <TextField label={t('fieldsManage.delete.confirm', { phrase })} value={typed} onChange={setTyped} autoFocus />
      </div>
    </ModalDialog>
  )
}

function MergeDialog({ fields, onClose }: { fields: Field[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [survivorId, setSurvivorId] = useState(fields[0].id)
  const [reason, setReason] = useState('')
  const survivor = fields.find((f) => f.id === survivorId)!
  const other = fields.find((f) => f.id !== survivorId)!
  const { orgId } = useOrg()
  const preview = useQuery({
    queryKey: ['merge-preview', orgId, survivorId, other.id],
    queryFn: () => api.post<MergePreview>(`/orgs/${orgId}/fields/merge/preview`, { survivorId, otherId: other.id }),
    retry: false,
  })
  const plan = preview.data ?? null
  const planError = preview.error
  const merge = useOrgMutation((base, _: void) => api.post<Field>(`${base}/fields/merge`, { survivorId, otherId: other.id, reason: reason.trim() || undefined }), {
    success: (f) => t('fieldsManage.merge.done', { name: f.name, area: fmt.ha(f.areaHa) }),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldsManage.merge.title')} size="lg"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!plan || plan.blockers.length > 0} isPending={merge.isPending} onPress={() => merge.mutate()}><Combine /> {t('fieldsManage.merge.action')}</Button>
        </>
      )}
    >
      <div className="grid md:grid-cols-[1fr_1.2fr] gap-5">
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">{t('fieldsManage.merge.keep')}</legend>
            {fields.map((f) => (
              <label key={f.id} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer', survivorId === f.id ? 'border-primary bg-primary-soft/40' : 'border-line')}>
                <input type="radio" name="survivor" checked={survivorId === f.id} onChange={() => setSurvivorId(f.id)} className="accent-[var(--color-primary)]" />
                <span className="flex-1 font-medium">{f.name}</span>
                <span className="text-xs text-muted tabular">{fmt.ha(f.areaHa)}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-fg-2">{t('fieldsManage.merge.explain', { survivor: survivor.name, other: other.name })}</p>
          <TextField label={t('fieldPage.boundary.reason')} value={reason} onChange={setReason} />
          {planError ? <ErrorNotice error={planError} /> : !plan ? <Loading /> : (
            <div className="space-y-2 text-sm">
              <p>{t('fieldsManage.merge.newArea', { area: fmt.ha(plan.areaHa) })}</p>
              {plan.parts > 1 && <Notice tone="warning">{t('fieldsManage.merge.islands', { count: plan.parts })}</Notice>}
              {plan.removedCropCycles > 0 && <Notice tone="warning">{t('fieldsManage.merge.removesCrops', { count: plan.removedCropCycles, name: other.name })}</Notice>}
              {plan.blockers.map((b) => <Notice key={b} tone="danger">{t(`fieldsManage.merge.blocker.${b.split(':')[0]}`, { count: Number(b.split(':')[1] ?? 0), name: b.startsWith('survivor') ? survivor.name : other.name })}</Notice>)}
            </div>
          )}
        </div>
        <FieldMap fields={[]} highlight={plan?.geometry ?? survivor.geometry} labels={false} className="h-80" />
      </div>
    </ModalDialog>
  )
}
