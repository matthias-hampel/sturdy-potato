import {
  OPERATION_TYPES,
  TASK_PRIORITIES,
  type Employee,
  type Farm,
  type Field,
  type Operation,
  type OperationType,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CalendarDays, CheckCircle2, Columns3, Table2, ChevronLeft, ChevronRight, ClipboardList, List, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton, Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { PRIORITY_LABELS, PriorityBadge, TaskStatusBadge } from '#/components/labels'
import { OperationsBoard } from '#/components/tasks/Board'
import { Comments } from '#/components/tasks/Comments'
import { LOCALE } from '#/i18n'
import { operationTypeLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { addDays, fmt, today } from '#/lib/format'
import { openSearch, useOpenParam } from '#/lib/openParam'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl, buttonClass } from '#/ui/Button'
import { Checkbox, DatePicker, Option, Select, TextField } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'
import { Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/tasks')({ validateSearch: openSearch, component: TasksPage })

type View = 'board' | 'table' | 'list' | 'calendar'
const VIEW_KEY = 'agmeo.tasks.view'
const readView = (): View => {
  try {
    const v = window.localStorage.getItem(VIEW_KEY)
    return v === 'table' || v === 'list' || v === 'calendar' ? v : 'board'
  } catch {
    return 'board'
  }
}
type StatusFilter = 'active' | 'done' | 'all'

function TasksPage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Not remembered without storage.
    }
  }
  const [status, setStatus] = useState<StatusFilter>('active')
  const [assignee, setAssignee] = useState<string>('all')
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const tasks = useOrgQuery<Task[]>('/tasks', { status: status === 'all' ? undefined : status, assigneeEmployeeId: assignee === 'all' ? undefined : assignee })
  const employees = useOrgQuery<Employee[]>('/employees')
  // The linked task may be done or assigned to someone else, so look it up without the filters.
  const { open } = Route.useSearch()
  const linked = useOrgQuery<Task[]>('/tasks', undefined, { enabled: !!open })
  useOpenParam(linked.data, setEditing)

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          <>
            <SegmentedControl
              aria-label={t('tasks.view')}
              value={view}
              onChange={setView}
              items={[
                { id: 'board', label: <><Columns3 aria-hidden /> {t('tasks.view.board')}</> },
                { id: 'table', label: <><Table2 aria-hidden /> {t('tasks.view.table')}</> },
                { id: 'list', label: <><List aria-hidden /> {t('tasks.view.list')}</> },
                { id: 'calendar', label: <><CalendarDays aria-hidden /> {t('tasks.view.calendar')}</> },
              ]}
            />
            {can('task.write') && <Button variant="primary" onPress={() => setEditing('new')}><Plus /> {t('tasks.newTask')}</Button>}
          </>
        }
      />
      {view === 'board' || view === 'table' ? (
        <>
          <p className="text-sm text-muted mb-3">{t('tasks.boardHint')}</p>
          <OperationsBoard view={view} />
        </>
      ) : (
      <>
      <div className="flex flex-wrap gap-3 mb-4">
        <SegmentedControl aria-label={t('common.status')} value={status} onChange={setStatus} items={[{ id: 'active', label: t('tasks.filter.open') }, { id: 'done', label: t('tasks.filter.done') }, { id: 'all', label: t('tasks.filter.all') }]} />
        <Select aria-label={t('tasks.filter.assignee')} className="w-52" items={[{ id: 'all', name: t('tasks.filter.everyone') }, ...(employees.data ?? [])]} value={assignee} onChange={(v) => setAssignee(String(v ?? 'all'))}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
      </div>
      {tasks.isLoading ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorNotice error={tasks.error} />
      ) : view === 'list' ? (
        <TaskList tasks={tasks.data ?? []} onEdit={setEditing} onNew={() => setEditing('new')} />
      ) : (
        <TaskCalendar tasks={tasks.data ?? []} onEdit={setEditing} />
      )}
      </>
      )}
      {editing && <TaskDialog task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

type Group = 'overdue' | 'today' | 'next7' | 'later' | 'noDate' | 'done'

function groupOf(t: Task): Group {
  if (t.status === 'done' || t.status === 'canceled') return 'done'
  if (t.overdue) return 'overdue'
  if (!t.dueOn) return 'noDate'
  if (t.dueOn === today()) return 'today'
  if (t.dueOn <= addDays(today(), 7)) return 'next7'
  return 'later'
}
const GROUP_ORDER: Group[] = ['overdue', 'today', 'next7', 'later', 'noDate', 'done']

function TaskList({ tasks, onEdit, onNew }: { tasks: Task[]; onEdit: (t: Task) => void; onNew: () => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const groups = useMemo(() => {
    const m = new Map<Group, Task[]>()
    for (const task of tasks) m.set(groupOf(task), [...(m.get(groupOf(task)) ?? []), task])
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const)
  }, [tasks])
  if (!tasks.length) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title={t('tasks.empty.title')} action={can('task.write') && <Button variant="primary" onPress={onNew}><Plus /> {t('tasks.newTask')}</Button>}>
          {t('tasks.empty.body')}
        </EmptyState>
      </Card>
    )
  }
  return (
    <div className="space-y-5">
      {groups.map(([group, items]) => (
        <Card key={group} title={<span className={cx(group === 'overdue' && 'text-danger')}>{t(`tasks.group.${group}`)} <span className="text-muted font-normal">· {items.length}</span></span>} padded={false}>
          <ul className="divide-y divide-line">
            {items.map((task) => <TaskRow key={task.id} task={task} onEdit={() => onEdit(task)} />)}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function TaskRow({ task, onEdit }: { task: Task; onEdit: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const navigate = useNavigate()
  const [planOpen, setPlanOpen] = useState(false)
  const setStatus = useOrgMutation((base, status: TaskStatus) => api.patch<Task>(`${base}/tasks/${task.id}`, { status }), { success: (r) => (r.status === 'done' ? t('tasks.toast.done') : t('tasks.toast.updated')) })
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/tasks/${task.id}`), { success: t('tasks.toast.deleted') })
  const done = task.status === 'done' || task.status === 'canceled'
  const writable = can('task.write')
  const linkedOpen = task.operation && task.operation.status !== 'completed' && task.operation.status !== 'canceled'
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <Checkbox
        aria-label={t('tasks.markDone', { title: task.title })}
        isSelected={done}
        isDisabled={!writable || !!linkedOpen}
        onChange={(sel) => setStatus.mutate(sel ? 'done' : 'open')}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm font-medium', done && 'line-through text-muted')}>{task.title}</div>
        <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {task.dueOn && <span className={cx(task.overdue && 'text-danger font-medium')}>{t('tasks.due', { date: fmt.date(task.dueOn), relative: fmt.relativeDays(task.dueOn) })}</span>}
          {task.field ? <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: task.field.id }} className="text-xs">{task.field.name}</Link> : <span>{task.farmName}</span>}
          {task.assignee && <span>{task.assignee.name}</span>}
          {task.operation && (
            <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: task.operation.id }} className="text-xs">
              {t('tasks.linkedOperation', { title: task.operation.title, status: t(`tasks.operationStatus.${task.operation.status}`) })}
            </Link>
          )}
        </div>
        {task.description && <p className="text-sm text-fg-2 mt-1 line-clamp-2">{task.description}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PriorityBadge priority={task.priority} />
        <TaskStatusBadge status={task.status} overdue={task.overdue} />
        {writable && (
          <MenuTrigger>
            <AriaButton aria-label={t('tasks.actionsFor', { title: task.title })} className={buttonClass('ghost', 'icon-sm')}>
              <MoreHorizontal className="size-4" />
            </AriaButton>
            <Menu
              onAction={(key) => {
                if (key === 'edit') onEdit()
                if (key === 'plan') setPlanOpen(true)
                if (key === 'progress') setStatus.mutate('in_progress')
                if (key === 'delete') remove.mutate()
                if (key === 'open-op' && task.operation) void navigate({ to: '/o/$orgId/operations/$operationId', params: { orgId, operationId: task.operation.id } })
              }}
            >
              <MenuItem id="edit"><Pencil /> {t('common.edit')}</MenuItem>
              {task.status === 'open' && <MenuItem id="progress"><CheckCircle2 /> {t('tasks.markInProgress')}</MenuItem>}
              {!task.operation && task.field && can('operation.write') && <MenuItem id="plan"><ClipboardList /> {t('tasks.planAsOperation')}</MenuItem>}
              {task.operation && <MenuItem id="open-op"><ClipboardList /> {t('tasks.openOperation')}</MenuItem>}
              <MenuSeparator />
              <MenuItem id="delete" danger><Trash2 /> {t('common.delete')}</MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      {planOpen && <PlanDialog task={task} onClose={() => setPlanOpen(false)} />}
    </li>
  )
}

function PlanDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const [type, setType] = useState<OperationType>('other')
  const plan = useOrgMutation((base, _: void) => api.post<Operation>(`${base}/tasks/${task.id}/operation`, { type }), {
    success: t('operations.toast.planned'),
    onSuccess: (op) => navigate({ to: '/o/$orgId/operations/$operationId', params: { orgId, operationId: op.id } }),
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('tasks.plan.title')} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-fg-2">{t('tasks.plan.body', { field: task.field?.name })}</p>
        <Select label={t('operations.typeLabel')} items={OPERATION_TYPES.map((ty) => ({ id: ty, name: operationTypeLabel(ty) }))} value={type} onChange={(v) => v && setType(v as OperationType)}>
          {(item) => <Option id={item.id}>{item.name}</Option>}
        </Select>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" isPending={plan.isPending} onPress={() => plan.mutate()}>{t('tasks.plan.create')}</Button>
        </div>
      </div>
    </ModalDialog>
  )
}

function TaskCalendar({ tasks, onEdit }: { tasks: Task[]; onEdit: (t: Task) => void }) {
  const { t } = useTranslation()
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const first = new Date(`${month}-01T12:00:00`)
  const startOffset = (first.getDay() + 6) % 7 // Monday first
  const gridStart = addDays(`${month}-01`, -startOffset)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const byDay = new Map<string, Task[]>()
  for (const task of tasks) if (task.dueOn) byDay.set(task.dueOn, [...(byDay.get(task.dueOn) ?? []), task])
  const shift = (n: number) => {
    const d = new Date(`${month}-15T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(d.toLocaleDateString('sv-SE').slice(0, 7))
  }
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.weekday(addDays('2026-01-05', i)))
  const noDate = tasks.filter((task) => !task.dueOn)
  return (
    <Card
      title={first.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}
      actions={
        <>
          <Button size="icon-sm" variant="ghost" aria-label={t('tasks.calendar.previousMonth')} onPress={() => shift(-1)}><ChevronLeft /></Button>
          <Button size="sm" variant="ghost" onPress={() => setMonth(today().slice(0, 7))}>{t('tasks.calendar.today')}</Button>
          <Button size="icon-sm" variant="ghost" aria-label={t('tasks.calendar.nextMonth')} onPress={() => shift(1)}><ChevronRight /></Button>
        </>
      }
      padded={false}
    >
      <div className="grid grid-cols-7 text-xs text-muted border-b border-line">
        {weekdays.map((d) => <div key={d} className="px-2 py-1.5 font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = byDay.get(d) ?? []
          const inMonth = d.startsWith(month)
          return (
            <div key={d} className={cx('min-h-24 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-surface-2/50')}>
              <div className={cx('text-xs tabular mb-1 size-6 flex items-center justify-center rounded-full', d === today() ? 'bg-primary text-primary-fg font-semibold' : inMonth ? 'text-fg-2' : 'text-muted/60')}>{Number(d.slice(8))}</div>
              <div className="space-y-1">
                {items.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onEdit(task)}
                    className={cx(
                      'w-full text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate border outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                      task.status === 'done' ? 'bg-surface-2 text-muted line-through border-line' : task.overdue ? 'bg-danger-soft text-danger border-danger/20' : 'bg-primary-soft text-primary border-primary/20',
                    )}
                    title={task.title}
                  >
                    {task.title}
                  </button>
                ))}
                {items.length > 3 && <div className="text-[11px] text-muted px-1">{t('tasks.calendar.more', { count: items.length - 3 })}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {noDate.length > 0 && <p className="text-xs text-muted px-4 py-2">{t('tasks.calendar.noDate', { count: noDate.length })}</p>}
    </Card>
  )
}

function TaskDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { t } = useTranslation()
  const farms = useOrgQuery<Farm[]>('/farms')
  const fields = useOrgQuery<Field[]>('/fields')
  const employees = useOrgQuery<Employee[]>('/employees')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [farmId, setFarmId] = useState<string | null>(task?.farmId ?? null)
  const [fieldId, setFieldId] = useState<string | null>(task?.field?.id ?? null)
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assignee?.id ?? null)
  const [dueOn, setDueOn] = useState<string | null>(task?.dueOn ?? null)
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal')
  const effectiveFarm = farmId ?? farms.data?.[0]?.id ?? null
  const farmFields = (fields.data ?? []).filter((f) => f.farmId === effectiveFarm)
  const body = { farmId: effectiveFarm, fieldId, title, description: description || null, assigneeEmployeeId: assigneeId, dueOn, priority }
  const save = useOrgMutation((base, _: void) => (task ? api.patch<Task>(`${base}/tasks/${task.id}`, body) : api.post<Task>(`${base}/tasks`, body)), {
    success: task ? t('tasks.toast.updated') : t('tasks.toast.created'),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={task ? t('tasks.dialog.editTitle') : t('tasks.newTask')}>
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="grid sm:grid-cols-2 gap-4">
        <TextField label={t('tasks.dialog.task')} isRequired autoFocus value={title} onChange={setTitle} className="sm:col-span-2" />
        {(farms.data?.length ?? 0) > 1 && (
          <Select label={t('operations.farm')} items={farms.data ?? []} value={effectiveFarm} onChange={(v) => { setFarmId(v ? String(v) : null); setFieldId(null) }}>
            {(f) => <Option id={f.id}>{f.name}</Option>}
          </Select>
        )}
        <Select label={t('tasks.dialog.field')} items={[{ id: '__none', name: t('tasks.dialog.wholeFarm') }, ...farmFields]} value={fieldId ?? '__none'} onChange={(v) => setFieldId(v && v !== '__none' ? String(v) : null)}>
          {(f) => <Option id={f.id}>{f.name}</Option>}
        </Select>
        <Select label={t('tasks.dialog.assignedTo')} items={[{ id: '__none', name: t('tasks.dialog.unassigned') }, ...(employees.data ?? []).filter((e) => e.active)]} value={assigneeId ?? '__none'} onChange={(v) => setAssigneeId(v && v !== '__none' ? String(v) : null)}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
        <DatePicker label={t('tasks.dialog.due')} value={dueOn} onChange={setDueOn} />
        <Select label={t('tasks.dialog.priority')} items={TASK_PRIORITIES.map((p) => ({ id: p, name: PRIORITY_LABELS[p] }))} value={priority} onChange={(v) => v && setPriority(v as TaskPriority)}>
          {(p) => <Option id={p.id}>{p.name}</Option>}
        </Select>
        <TextField label={t('common.description')} multiline value={description} onChange={setDescription} className="sm:col-span-2" />
        <div className="sm:col-span-2 flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending} isDisabled={!effectiveFarm}>{task ? t('common.save') : t('tasks.dialog.create')}</Button>
        </div>
      </Form>
      {task && (
        <div className="mt-6 pt-4 border-t border-line">
          <Comments entityType="task" entityId={task.id} />
        </div>
      )}
    </ModalDialog>
  )
}
