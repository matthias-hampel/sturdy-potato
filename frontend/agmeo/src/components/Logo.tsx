import { cx } from '#/ui/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#3d6b2f" />
      <path
        d="M16 25c0-6 0-9 0-13M16 15c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6zm0 4c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6z"
        stroke="#f7ecd5"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-8" />
      <span className={cx('text-lg font-semibold tracking-tight', light ? 'text-white' : 'text-fg')}>agmeo</span>
    </span>
  )
}
