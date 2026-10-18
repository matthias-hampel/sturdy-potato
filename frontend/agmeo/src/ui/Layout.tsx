import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tab as AriaTab, TabList as AriaTabList, TabPanel as AriaTabPanel, Tabs as AriaTabs, type TabsProps, type TabProps, type TabListProps, type TabPanelProps } from 'react-aria-components'
import { composeClass, cx, focusRing } from './utils'
import { t } from '#/i18n'
import { errorMessage } from '#/lib/api'

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-medium uppercase tracking-wider text-muted mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className, padded = true, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; description?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-xs min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line/70">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, icon: Icon, tone = 'default' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: 'default' | 'warning' | 'danger' | 'success' }) {
  const toneClass = { default: 'text-primary bg-primary-soft', warning: 'text-warning bg-warning-soft', danger: 'text-danger bg-danger-soft', success: 'text-success bg-success-soft' }[tone]
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs flex gap-3 items-start min-w-0">
      {Icon && (
        <span className={cx('size-9 rounded-lg flex items-center justify-center shrink-0', toneClass)}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className="text-xl font-semibold text-fg tabular mt-0.5 truncate">{value}</div>
        {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
      </div>
    </div>
  )
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

export function Badge({ children, tone = 'neutral', className, dot }: { children: ReactNode; tone?: BadgeTone; className?: string; dot?: string }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-surface-2 text-fg-2 border-line',
    primary: 'bg-primary-soft text-primary border-primary/20',
    success: 'bg-success-soft text-success border-success/20',
    warning: 'bg-warning-soft text-warning border-warning/20',
    danger: 'bg-danger-soft text-danger border-danger/20',
    info: 'bg-info-soft text-info border-info/20',
    accent: 'bg-accent-soft text-accent border-accent/20',
  }
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-2 rounded-full shrink-0" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {Icon && (
        <span className="size-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center mb-4">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {children && <div className="text-sm text-muted mt-1.5 max-w-md">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-surface-3/70', className)} aria-hidden />
}

export function Loading({ label = t('common.loading') }: { label?: string }) {
  return (
    <div className="space-y-3 py-2" role="status" aria-label={label}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  const message = errorMessage(error)
  return (
    <div role="alert" className={cx('rounded-lg border border-danger/30 bg-danger-soft text-danger text-sm px-3 py-2.5', className)}>
      {message}
    </div>
  )
}

export function Notice({ tone = 'info', children, className, icon: Icon }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; className?: string; icon?: LucideIcon }) {
  const tones = {
    info: 'border-info/25 bg-info-soft text-info',
    warning: 'border-warning/25 bg-warning-soft text-warning',
    danger: 'border-danger/25 bg-danger-soft text-danger',
    success: 'border-success/25 bg-success-soft text-success',
  }
  return (
    <div className={cx('rounded-lg border text-sm px-3 py-2.5 flex gap-2.5 items-start', tones[tone], className)}>
      {Icon && <Icon className="size-4 mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 text-fg-2 [&_strong]:text-fg">{children}</div>
    </div>
  )
}

export function DescriptionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="text-fg min-w-0 break-words">{item.value ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Tabs(props: TabsProps) {
  return <AriaTabs {...props} className={composeClass(props.className, 'flex flex-col')} />
}

export function TabList<T extends object>(props: TabListProps<T>) {
  return <AriaTabList {...props} className={composeClass(props.className, 'flex gap-1 border-b border-line overflow-x-auto overflow-y-hidden')} />
}

export function Tab(props: TabProps) {
  return (
    <AriaTab
      {...props}
      className={composeClass(
        props.className,
        cx(
          'relative px-3 py-2 text-sm font-medium text-muted cursor-pointer whitespace-nowrap rounded-t-md hover:text-fg selected:text-primary',
          'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full selected:after:bg-primary',
          focusRing,
        ),
      )}
    />
  )
}

export function TabPanel(props: TabPanelProps) {
  return <AriaTabPanel {...props} className={composeClass(props.className, 'outline-none pt-5')} />
}
