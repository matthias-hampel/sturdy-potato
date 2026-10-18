import {
  type CropCycleStatus,
  type CropRole,
  type OperationStatus,
  type OperationType,
  type TaskPriority,
  type TaskStatus,
  type TemplateAnchor,
} from '@agmeo/contracts'
import { Droplets, Eye, Leaf, MoreHorizontal, Shovel, SprayCan, Sprout, Wheat, type LucideIcon } from 'lucide-react'
import { t } from '#/i18n'
import { cropRoleLabel, operationTypeLabel, templateAnchorLabel } from '#/i18n/labels'
import { Badge, type BadgeTone } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const OPERATION_ICONS: Record<OperationType, LucideIcon> = {
  tillage: Shovel,
  sowing: Sprout,
  fertilization: Leaf,
  crop_protection: SprayCan,
  irrigation: Droplets,
  harvest: Wheat,
  inspection: Eye,
  other: MoreHorizontal,
}

export function OperationTypeLabel({ type, className, iconOnly }: { type: OperationType; className?: string; iconOnly?: boolean }) {
  const Icon = OPERATION_ICONS[type]
  return (
    <span className={cx('inline-flex items-center gap-2 text-fg-2', className)}>
      <span className="size-7 rounded-md bg-primary-soft text-primary flex items-center justify-center shrink-0" title={iconOnly ? operationTypeLabel(type) : undefined}>
        <Icon className="size-4" aria-hidden />
      </span>
      {iconOnly ? <span className="sr-only">{operationTypeLabel(type)}</span> : operationTypeLabel(type)}
    </span>
  )
}

const OP_STATUS: Record<OperationStatus, BadgeTone> = { planned: 'info', in_progress: 'accent', completed: 'success', canceled: 'neutral' }

export function OperationStatusBadge({ status }: { status: OperationStatus }) {
  return <Badge tone={OP_STATUS[status]}>{t(`enum.operationStatus.${status}`)}</Badge>
}

const CYCLE_STATUS: Record<CropCycleStatus, BadgeTone> = { planned: 'info', active: 'success', harvested: 'accent', closed: 'neutral' }

export function CropCycleStatusBadge({ status }: { status: CropCycleStatus }) {
  return <Badge tone={CYCLE_STATUS[status]}>{t(`enum.cropCycleStatus.${status}`)}</Badge>
}

/** Catch and undersown crops are marked; the main crop is the default and needs no badge. */
export function CropRoleBadge({ role }: { role: CropRole }) {
  if (role === 'main') return null
  return <Badge tone={role === 'catch_crop' ? 'success' : 'accent'}>{cropRoleLabel(role)}</Badge>
}

/** When a template step falls: "14 Tage vor Aussaat", "Am Tag der Ernte". */
export function templateStepTiming(anchor: TemplateAnchor, offsetDays: number) {
  if (!offsetDays) return t(`templates.timing.on.${anchor}`)
  const values = { count: Math.abs(offsetDays), anchor: templateAnchorLabel(anchor) }
  return offsetDays < 0 ? t('templates.timing.before', values) : t('templates.timing.after', values)
}

const TASK_STATUS: Record<TaskStatus, BadgeTone> = { open: 'info', in_progress: 'accent', done: 'success', canceled: 'neutral' }

export function TaskStatusBadge({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="danger">{t('enum.taskStatus.overdue')}</Badge>
  return <Badge tone={TASK_STATUS[status]}>{t(`enum.taskStatus.${status}`)}</Badge>
}

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent']
/** Translated on access, so `PRIORITY_LABELS[p]` follows the UI language. */
export const PRIORITY_LABELS = Object.defineProperties(
  {} as Record<TaskPriority, string>,
  Object.fromEntries(PRIORITIES.map((p) => [p, { get: () => t(`enum.taskPriority.${p}`), enumerable: true }])),
)

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'normal' || priority === 'low') return <span className="text-xs text-muted">{PRIORITY_LABELS[priority]}</span>
  return <Badge tone={priority === 'urgent' ? 'danger' : 'warning'}>{PRIORITY_LABELS[priority]}</Badge>
}

export function CropTag({ name, color }: { name: string | null | undefined; color?: string | null }) {
  if (!name) return <span className="text-muted text-sm">{t('labels.noCrop')}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg">
      <span className="size-2.5 rounded-full shrink-0 ring-1 ring-black/10" style={{ background: color ?? '#9aa392' }} aria-hidden />
      {name}
    </span>
  )
}
