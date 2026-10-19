import {
  OPERATION_TYPES,
  TASK_PRIORITIES,
  type BoardCard,
  type Crop,
  type Employee,
  type Field,
  type OperationBoard,
  type OperationType,
  type StockShortage,
  type TaskPriority,
} from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronDown, ExternalLink, Filter, MessageSquare, Play, RotateCcw, SquareCheck, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PRIORITY_LABELS, PriorityBadge } from '#/components/labels'
import { operationTypeLabel } from '#/i18n/labels'
import { ApiRequestError, api, errorMessage } from '#/lib/api'
import { addDays, fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, Option, Select, TextField } from '#/ui/Field'
import { EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx, focusRing } from '#/ui/utils'
import { Comments } from './Comments'

// ---------------------------------------------------------------------------
// Filters (shared by board and table)
// ---------------------------------------------------------------------------

type Preset = 'today' | 'week' | 'fortnight' | 'custom'
export interface BoardFilters {
  preset: Preset | null
  from: string | null
  to: string | null
  type: OperationType | null
  cropId: string | null
  fieldId: string | null
  /** Employee id, `unassigned`, or null for everyone. */
  assignee: string | null
}
export const NO_FILTERS: BoardFilters = { preset: null, from: null, to: null, type: null, cropId: null, fieldId: null, assignee: null }

const range = (p: Preset): [string, string] | null =>
  p === 'today' ? [today(), today()] : p === 'week' ? [addDays(today(), -7), addDays(today(), 7)] : p === 'fortnight' ? [addDays(today(), -14), addDays(today(), 14)] : null

function activeCount(f: BoardFilters) {
  return [f.preset, f.type, f.cropId, f.fieldId, f.assignee].filter(Boolean).length
}

export function useBoard(filters: BoardFilters) {
  const { seasonId } = useSeason()
  const dates = filters.preset && filters.preset !== 'custom' ? range(filters.preset) : filters.preset === 'custom' ? [filters.from, filters.to] : null
  return useOrgQuery<OperationBoard>(
    '/board',
    {
      seasonId: dates ? undefined : seasonId,
      from: dates?.[0] ?? undefined,
      to: dates?.[1] ?? undefined,
      type: filters.type ?? undefined,
      cropId: filters.cropId ?? undefined,
      fieldId: filters.fieldId ?? undefined,
      assigneeEmployeeId: filters.assignee && filters.assignee !== 'unassigned' ? filters.assignee : undefined,
      unassigned: filters.assignee === 'unassigned' ? true : undefined,
    },
    { keepPrevious: true },
  )
}

export function BoardFilterBar({ value, onChange }: { value: BoardFilters; onChange: (f: BoardFilters) => void }) {
  const { t } = useTranslation()
  const { seasonId } = useSeason()
  const [open, setOpen] = useState(false)
  const crops = useOrgQuery<Crop[]>('/crops')
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const employees = useOrgQuery<Employee[]>('/employees')
  const count = activeCount(value)
  const set = (patch: Partial<BoardFilters>) => onChange({ ...value, ...patch })
  const chip = (active: boolean, label: string, onPress: () => void) => (
    <button key={label} type="button" onClick={onPress} aria-pressed={active} className={cx('rounded-full border px-3 py-1 text-xs', active ? 'bg-primary text-primary-fg border-primary' : 'border-line text-fg-2 hover:bg-surface-2', focusRing)}>
      {label}
    </button>
  )
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button size="sm" variant="ghost" onPress={() => setOpen((o) => !o)} aria-expanded={open}>
          <Filter /> {t('board.filters.title')}
          {count > 0 && <span className="rounded-full bg-primary text-primary-fg px-1.5 text-xs tabular">{count}</span>}
          <ChevronDown className={cx('transition-transform', open && 'rotate-180')} />
        </Button>
        {count > 0 && <Button size="sm" variant="quiet" onPress={() => onChange(NO_FILTERS)}><X /> {t('board.filters.reset')}</Button>}
      </div>
      {open && (
        <div className="border-t border-line px-3 py-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-xs text-muted">{t('board.filters.dates')}</span>
            {(['fortnight', 'week', 'today', 'custom'] as const).map((p) => chip(value.preset === p, t(`board.filters.preset.${p}`), () => set({ preset: value.preset === p ? null : p })))}
            {value.preset === 'custom' && (
              <>
                <DatePicker aria-label={t('table.from')} value={value.from} onChange={(from) => set({ from })} />
                <DatePicker aria-label={t('table.to')} value={value.to} onChange={(to) => set({ to })} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-xs text-muted">{t('board.filters.category')}</span>
            {OPERATION_TYPES.map((ty) => chip(value.type === ty, operationTypeLabel(ty), () => set({ type: value.type === ty ? null : ty })))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Select label={t('board.filters.crop')} className="w-48" items={[{ id: 'all', name: t('board.filters.all') }, ...(crops.data ?? []).map((c) => ({ id: c.id, name: c.name }))]} value={value.cropId ?? 'all'} onChange={(v) => set({ cropId: v && v !== 'all' ? String(v) : null })}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
            <ComboBox label={t('board.filters.field')} className="w-56" items={[{ id: 'all', name: t('board.filters.all') }, ...(fields.data ?? []).map((f) => ({ id: f.id, name: f.name }))]} value={value.fieldId ?? 'all'} onChange={(v) => set({ fieldId: v && v !== 'all' ? String(v) : null })}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </ComboBox>
            <Select label={t('board.filters.assignee')} className="w-52" items={[{ id: 'all', name: t('tasks.filter.everyone') }, { id: 'unassigned', name: t('tasks.dialog.unassigned') }, ...(employees.data ?? []).map((e) => ({ id: e.id, name: e.name }))]} value={value.assignee ?? 'all'} onChange={(v) => set({ assignee: v && v !== 'all' ? String(v) : null })}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status moves: start, complete (books stock and costs), reopen (with a reason)
// ---------------------------------------------------------------------------

type Target = 'planned' | 'in_progress' | 'completed'

/** Moves cards between columns with the right endpoint for each transition. */
export function useMoves() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const [reopen, setReopen] = useState<{ card: BoardCard; to: Target } | null>(null)
  const [shortage, setShortage] = useState<{ card: BoardCard; items: StockShortage[] } | null>(null)
  const base = `/orgs/${orgId}`
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId] })

  const complete = async (card: BoardCard, allowNegativeStock = false) => {
    try {
      await api.post(`${base}/operations/${card.id}/complete`, { version: card.version, allowNegativeStock })
      toast.success(t('board.toast.completed', { title: card.title }))
      setShortage(null)
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'insufficient_stock') setShortage({ card, items: e.details as StockShortage[] })
      else toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      await refresh()
    }
  }

  const move = async (card: BoardCard, to: Target) => {
    if (card.status === to) return
    if (card.status === 'completed') return setReopen({ card, to })
    if (to === 'completed') return complete(card)
    try {
      await api.post(`${base}/board/${card.id}/status`, { status: to, version: card.version })
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      await refresh()
    }
  }

  const doReopen = async (reason: string) => {
    if (!reopen) return
    const { card, to } = reopen
    try {
      const op = await api.post<{ version: number }>(`${base}/operations/${card.id}/reopen`, { version: card.version, reason })
      if (to === 'planned') await api.post(`${base}/board/${card.id}/status`, { status: 'planned', version: op.version })
      toast.success(t('board.toast.reopened', { title: card.title }))
      setReopen(null)
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      await refresh()
    }
  }

  const dialogs = (
    <>
      {reopen && <ReopenDialog card={reopen.card} onCancel={() => setReopen(null)} onConfirm={doReopen} />}
      {shortage && (
        <ModalDialog isOpen onOpenChange={(o) => !o && setShortage(null)} title={t('board.shortage.title')} size="sm"
          footer={(close) => (
            <>
              <Button onPress={close}>{t('common.cancel')}</Button>
              {can('inventory.write') && <Button variant="danger" onPress={() => void complete(shortage.card, true)}>{t('board.shortage.override')}</Button>}
            </>
          )}
        >
          <div className="space-y-2 text-sm">
            <p>{t('board.shortage.body')}</p>
            <ul className="list-disc pl-5">
              {shortage.items.map((s) => <li key={s.productId}>{s.productName}: {fmt.num(s.required, 1)} / {fmt.num(s.available, 1)} {s.baseUnit}</li>)}
            </ul>
          </div>
        </ModalDialog>
      )}
    </>
  )
  return { move, complete, dialogs }
}

function ReopenDialog({ card, onCancel, onConfirm }: { card: BoardCard; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onCancel()} title={t('board.reopen.title', { title: card.title })} size="sm"
      footer={() => (
        <>
          <Button onPress={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={reason.trim().length < 3} isPending={pending} onPress={async () => { setPending(true); try { await onConfirm(reason.trim()) } finally { setPending(false) } }}><RotateCcw /> {t('board.reopen.confirm')}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-2">{t('board.reopen.body')}</p>
        <TextField label={t('board.reopen.reason')} isRequired value={reason} onChange={setReason} autoFocus />
      </div>
    </ModalDialog>
  )
}

// ---------------------------------------------------------------------------
// Board view
// ---------------------------------------------------------------------------

const COLUMNS: { id: Target; label: string }[] = [
  { id: 'planned', label: 'board.column.planned' },
  { id: 'in_progress', label: 'board.column.in_progress' },
  { id: 'completed', label: 'board.column.completed' },
]
const DRAG = 'application/x-agmeo-operation'

export function BoardView({ board, onOpen }: { board: OperationBoard; onOpen: (c: BoardCard) => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const { move, dialogs } = useMoves()
  const [over, setOver] = useState<Target | null>(null)
  const draggable = can('operation.write')
  const all = [...board.planned, ...board.in_progress, ...board.completed]
  return (
    <>
      <div className="grid md:grid-cols-3 gap-4 items-start">
        {COLUMNS.map((col) => {
          const cards = board[col.id]
          return (
            <section
              key={col.id}
              aria-label={t(col.label)}
              onDragOver={(e) => {
                if (!draggable || !e.dataTransfer.types.includes(DRAG)) return
                e.preventDefault()
                setOver(col.id)
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const card = all.find((c) => c.id === e.dataTransfer.getData(DRAG))
                if (card) void move(card, col.id)
              }}
              className={cx('rounded-xl bg-surface-2/60 border p-2 min-h-60', over === col.id ? 'border-primary bg-primary-soft/40' : 'border-transparent')}
            >
              <h3 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">
                {t(col.label)} <span className="rounded-full bg-surface px-2 text-xs tabular text-muted">{cards.length}</span>
              </h3>
              {col.id === 'completed' && <p className="px-2 pb-1 text-xs text-muted">{t('board.column.completedHint')}</p>}
              <ul className="space-y-2">
                {cards.map((c) => (
                  <li key={c.id}>
                    <TaskCard card={c} draggable={draggable} onOpen={() => onOpen(c)} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {dialogs}
    </>
  )
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
function avatarColor(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 45% 42%)`
}

function TaskCard({ card, draggable, onOpen }: { card: BoardCard; draggable: boolean; onOpen: () => void }) {
  const { t } = useTranslation()
  const date = card.status === 'completed' ? card.completedAt : card.performedAt ?? card.plannedOn
  const overdue = card.status !== 'completed' && card.dueOn != null && card.dueOn < today()
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, card.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="rounded-lg border border-line bg-surface p-3 shadow-sm hover:border-primary/50 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className={cx('flex-1 min-w-0 text-left', focusRing)}>
          <div className="text-xs text-muted">{operationTypeLabel(card.type)}</div>
          <div className="font-medium text-sm leading-snug">{card.title}</div>
        </button>
        <PriorityBadge priority={card.priority} />
      </div>
      {card.crops.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.crops.map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
              <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden /> {c.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-xs text-fg-2 line-clamp-2">{card.fields.map((f) => f.name).join(', ')} · {fmt.ha(card.totalAreaHa)}</div>
      {card.inputs.length > 0 && <div className="mt-1 text-xs text-muted line-clamp-1">{card.inputs.join(', ')}</div>}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        {date && <span className="tabular">{fmt.shortDate(date)}</span>}
        {card.dueOn && card.status !== 'completed' && (
          <span className={cx('inline-flex items-center gap-1 tabular', overdue && 'text-danger font-medium')}><CalendarClock className="size-3.5" /> {fmt.shortDate(card.dueOn)}</span>
        )}
        {card.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" /> {card.commentCount}</span>}
        <span className="flex-1" />
        <AssigneeAvatar card={card} />
      </div>
      <span className="sr-only">{t('board.dragHint')}</span>
    </article>
  )
}

/** Avatar with a quick-assign menu. */
function AssigneeAvatar({ card }: { card: BoardCard }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const employees = useOrgQuery<Employee[]>('/employees')
  const assign = async (id: string | null) => {
    try {
      await api.patch(`/orgs/${orgId}/board/${card.id}`, { responsibleEmployeeId: id })
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    }
    await qc.invalidateQueries({ queryKey: ['org', orgId] })
  }
  const face = card.assignee ? (
    <span className="size-7 rounded-full text-white text-[11px] font-semibold flex items-center justify-center" style={{ background: avatarColor(card.assignee.id) }} title={card.assignee.name}>{initials(card.assignee.name)}</span>
  ) : (
    <span className="size-7 rounded-full border border-dashed border-line flex items-center justify-center" title={t('tasks.dialog.unassigned')}><UserRound className="size-3.5" /></span>
  )
  if (!can('task.write')) return face
  return (
    <MenuTrigger>
      <Button variant="ghost" size="icon-sm" aria-label={t('board.assign', { title: card.title })}>{face}</Button>
      <Menu onAction={(k) => void assign(k === 'none' ? null : String(k))}>
        <MenuItem id="none">{t('tasks.dialog.unassigned')}</MenuItem>
        <MenuSeparator />
        {(employees.data ?? []).filter((e) => e.active).map((e) => <MenuItem key={e.id} id={e.id}>{e.name}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  )
}

// ---------------------------------------------------------------------------
// Card dialog: board metadata, status, comments
// ---------------------------------------------------------------------------

export function CardDialog({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const employees = useOrgQuery<Employee[]>('/employees')
  const { move, dialogs } = useMoves()
  const [title, setTitle] = useState(card.title)
  const [priority, setPriority] = useState<TaskPriority>(card.priority)
  const [dueOn, setDueOn] = useState<string | null>(card.dueOn)
  const [assignee, setAssignee] = useState<string | null>(card.assignee?.id ?? null)
  const [saving, setSaving] = useState(false)
  const writable = can('task.write')
  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/orgs/${orgId}/board/${card.id}`, { title: title.trim(), priority, dueOn, responsibleEmployeeId: assignee })
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
      toast.success(t('board.toast.saved'))
      onClose()
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const act = async (to: Target) => {
    await move(card, to)
    if (card.status !== 'completed') onClose()
  }
  return (
    <>
      <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={card.title} description={`${operationTypeLabel(card.type)} · ${t(`board.column.${card.status as Target}`)}`} size="lg"
        footer={(close) => (
          <>
            <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: card.id }} variant="quiet"><ExternalLink /> {t('board.openOperation')}</Link>
            <div className="flex-1" />
            <Button onPress={close}>{t('common.close')}</Button>
            {writable && <Button variant="primary" isDisabled={!title.trim()} isPending={saving} onPress={() => void save()}>{t('common.save')}</Button>}
          </>
        )}
      >
        <div className="grid md:grid-cols-[1fr_1fr] gap-6">
          <div className="space-y-4">
            <TextField label={t('board.card.title')} isDisabled={!writable} value={title} onChange={setTitle} />
            <div className="grid grid-cols-2 gap-3">
              <Select label={t('tasks.dialog.priority')} isDisabled={!writable} items={TASK_PRIORITIES.map((p) => ({ id: p, name: PRIORITY_LABELS[p] }))} value={priority} onChange={(v) => v && setPriority(v as TaskPriority)}>
                {(o) => <Option id={o.id}>{o.name}</Option>}
              </Select>
              <DatePicker label={t('tasks.dialog.due')} isDisabled={!writable} value={dueOn} onChange={setDueOn} />
            </div>
            <Select label={t('tasks.dialog.assignedTo')} isDisabled={!writable} items={[{ id: 'none', name: t('tasks.dialog.unassigned') }, ...(employees.data ?? []).filter((e) => e.active || e.id === assignee).map((e) => ({ id: e.id, name: e.name }))]} value={assignee ?? 'none'} onChange={(v) => setAssignee(v && v !== 'none' ? String(v) : null)}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
            <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">{t('board.card.fields')}</dt><dd>{card.fields.map((f) => f.name).join(', ')} ({fmt.ha(card.totalAreaHa)})</dd>
              {card.inputs.length > 0 && <><dt className="text-muted">{t('board.card.inputs')}</dt><dd>{card.inputs.join(', ')}</dd></>}
              {card.equipment.length > 0 && <><dt className="text-muted">{t('board.card.equipment')}</dt><dd>{card.equipment.join(', ')}</dd></>}
              {card.plannedOn && <><dt className="text-muted">{t('board.card.planned')}</dt><dd className="tabular">{fmt.date(card.plannedOn)}</dd></>}
            </dl>
            {can('operation.write') && (
              <div className="flex flex-wrap gap-2">
                {card.status === 'planned' && <Button onPress={() => void act('in_progress')}><Play /> {t('board.action.start')}</Button>}
                {card.status === 'in_progress' && <Button onPress={() => void act('planned')}><RotateCcw /> {t('board.action.unstart')}</Button>}
                {card.status !== 'completed' && <Button variant="primary" onPress={() => void act('completed')}><SquareCheck /> {t('board.action.complete')}</Button>}
                {card.status === 'completed' && <Button onPress={() => void act('in_progress')}><RotateCcw /> {t('board.action.reopen')}</Button>}
              </div>
            )}
          </div>
          <Comments entityType="operation" entityId={card.id} />
        </div>
      </ModalDialog>
      {dialogs}
    </>
  )
}

// ---------------------------------------------------------------------------
// Table view with bulk edits
// ---------------------------------------------------------------------------

export function BoardTable({ board, onOpen }: { board: OperationBoard; onOpen: (c: BoardCard) => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const employees = useOrgQuery<Employee[]>('/employees')
  const { move, dialogs } = useMoves()
  const rows = [...board.planned, ...board.in_progress, ...board.completed]
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDone, setConfirmDone] = useState(false)
  const sel = rows.filter((r) => selected.has(r.id))
  const writable = can('task.write')
  const bulk = async (patch: Record<string, unknown>) => {
    try {
      await api.post(`/orgs/${orgId}/board/meta`, { operationIds: sel.map((r) => r.id), ...patch })
      toast.success(t('board.toast.bulk', { count: sel.length }))
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    }
    await qc.invalidateQueries({ queryKey: ['org', orgId] })
  }
  const completeAll = async () => {
    for (const r of sel.filter((x) => x.status !== 'completed')) await move(r, 'completed')
    setSelected(new Set())
    setConfirmDone(false)
  }
  if (!rows.length) return <EmptyState icon={SquareCheck} title={t('board.empty')} />
  const allSel = rows.every((r) => selected.has(r.id))
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted border-b border-line">
            <tr className="text-left">
              {writable && <th className="w-10 px-3 py-2"><Checkbox aria-label={t('fieldsManage.selectAll')} isSelected={allSel} isIndeterminate={!allSel && sel.length > 0} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              <th className="px-3 py-2 font-medium">{t('board.col.operation')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.crops')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.fields')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.inputs')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.equipment')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.date')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.assignee')}</th>
              <th className="px-3 py-2 font-medium">{t('board.col.priority')}</th>
              <th className="px-3 py-2 font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cx('border-b border-line/60 last:border-0', selected.has(r.id) && 'bg-primary-soft/40')}>
                {writable && <td className="px-3 py-2"><Checkbox aria-label={t('fieldsManage.select', { name: r.title })} isSelected={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} /></td>}
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onOpen(r)} className={cx('text-left', focusRing)}>
                    <div className="font-medium hover:underline">{r.title}</div>
                    <div className="text-xs text-muted">{operationTypeLabel(r.type)}</div>
                  </button>
                </td>
                <td className="px-3 py-2">{r.crops.map((c) => c.name).join(', ')}</td>
                <td className="px-3 py-2 max-w-56 truncate" title={r.fields.map((f) => f.name).join(', ')}>{r.fields.map((f) => f.name).join(', ')}</td>
                <td className="px-3 py-2 max-w-56 truncate text-muted">{r.inputs.join(', ')}</td>
                <td className="px-3 py-2 max-w-40 truncate text-muted">{r.equipment.join(', ')}</td>
                <td className="px-3 py-2 tabular whitespace-nowrap">{fmt.date(r.status === 'completed' ? r.completedAt : r.performedAt ?? r.plannedOn)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.assignee?.name ?? <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2"><PriorityBadge priority={r.priority} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{t(`board.column.${r.status as Target}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {writable && sel.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-center mt-4 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-medium px-1 tabular">{t('table.selected', { count: sel.length })}</span>
            <Select aria-label={t('board.col.priority')} placeholder={t('board.bulk.priority')} className="w-40" items={TASK_PRIORITIES.map((p) => ({ id: p, name: PRIORITY_LABELS[p] }))} value={null} onChange={(v) => v && void bulk({ priority: v })}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
            <Select aria-label={t('board.col.assignee')} placeholder={t('board.bulk.assignee')} className="w-44" items={[{ id: 'none', name: t('tasks.dialog.unassigned') }, ...(employees.data ?? []).filter((e) => e.active).map((e) => ({ id: e.id, name: e.name }))]} value={null} onChange={(v) => v && void bulk({ responsibleEmployeeId: v === 'none' ? null : v })}>
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
            <DatePicker aria-label={t('board.bulk.due')} value={null} onChange={(d) => d && void bulk({ dueOn: d })} />
            {can('operation.write') && sel.some((r) => r.status !== 'completed') && <Button size="sm" variant="primary" onPress={() => setConfirmDone(true)}><SquareCheck /> {t('board.action.complete')}</Button>}
            <Button size="icon-sm" variant="ghost" aria-label={t('table.clearSelection')} onPress={() => setSelected(new Set())}><X /></Button>
          </div>
        </div>
      )}
      {confirmDone && (
        <ModalDialog isOpen onOpenChange={(o) => !o && setConfirmDone(false)} title={t('board.bulk.confirmDoneTitle', { count: sel.filter((r) => r.status !== 'completed').length })} size="sm"
          footer={(close) => (
            <>
              <Button onPress={close}>{t('common.cancel')}</Button>
              <Button variant="primary" onPress={() => void completeAll()}>{t('board.action.complete')}</Button>
            </>
          )}
        >
          <Notice tone="info">{t('board.bulk.confirmDoneBody')}</Notice>
        </ModalDialog>
      )}
      {dialogs}
    </>
  )
}

/** Board or table of operations with the shared filters. */
export function OperationsBoard({ view }: { view: 'board' | 'table' }) {
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS)
  const board = useBoard(filters)
  const [open, setOpen] = useState<BoardCard | null>(null)
  const current = open && board.data ? [...board.data.planned, ...board.data.in_progress, ...board.data.completed].find((c) => c.id === open.id) ?? open : open
  return (
    <>
      <BoardFilterBar value={filters} onChange={setFilters} />
      {board.error ? <ErrorNotice error={board.error} /> : !board.data ? <Loading /> : view === 'board' ? <BoardView board={board.data} onOpen={setOpen} /> : <BoardTable board={board.data} onOpen={setOpen} />}
      {current && <CardDialog key={current.id} card={current} onClose={() => setOpen(null)} />}
    </>
  )
}

