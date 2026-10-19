import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '#/ui/utils'

export type ContextAction = { id: string; label: string; icon?: LucideIcon; danger?: boolean; disabled?: boolean; onAction: () => void } | 'separator'

/**
 * Menu at the pointer for right-clicks. Arrow keys move between items, Escape or a click
 * outside closes it, and it stays inside the viewport.
 */
export function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: ContextAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[70] min-w-52 rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]"
    >
      {actions.map((a, i) =>
        a === 'separator' ? (
          <div key={`sep-${i}`} role="separator" className="my-1 border-t border-line" />
        ) : (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            disabled={a.disabled}
            onClick={() => {
              onClose()
              a.onAction()
            }}
            className={cx(
              'w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-left outline-none disabled:opacity-50 [&_svg]:size-4',
              a.danger ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-fg hover:bg-surface-2 focus:bg-surface-2 [&_svg]:text-muted',
            )}
          >
            {a.icon && <a.icon aria-hidden />}
            {a.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
