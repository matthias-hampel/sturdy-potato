import type { SearchResults } from '@agmeo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { CalendarCheck2, Loader2, Map, Package, Search, Tractor, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Autocomplete,
  Button as AriaButton,
  Dialog,
  Header,
  Input,
  Menu,
  MenuItem,
  MenuSection,
  Modal,
  ModalOverlay,
  SearchField,
} from 'react-aria-components'
import { equipmentKindLabel, productCategoryLabel } from '#/i18n/labels'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { cx, focusRing } from '#/ui/utils'

const MIN_LENGTH = 2

interface Section {
  key: keyof SearchResults
  label: string
  icon: LucideIcon
  items: { id: string; title: string; detail: string | null }[]
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Header search over fields, employees, products, machinery and tasks; opens with ⌘K / Ctrl+K. */
export function GlobalSearch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <AriaButton
        onPress={() => setOpen(true)}
        aria-label={t('search.title')}
        className={cx(
          'flex items-center gap-2 h-9.5 rounded-[var(--radius-control)] text-sm text-muted transition-colors',
          'sm:w-full sm:border sm:border-line-strong sm:bg-surface sm:px-3 sm:hover:border-primary/50',
          'max-sm:size-9.5 max-sm:justify-center max-sm:hover:bg-surface-2',
          focusRing,
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:block flex-1 text-left truncate">{t('search.trigger')}</span>
        <kbd className="hidden sm:block font-sans text-xs text-muted border border-line rounded px-1.5 py-0.5">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </AriaButton>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-start justify-center p-4 pt-[8vh]"
      >
        <Modal className="w-full max-w-xl rounded-2xl bg-surface shadow-[var(--shadow-overlay)] border border-line overflow-hidden">
          <Dialog aria-label={t('search.title')} className="outline-none">
            <SearchPalette onClose={() => setOpen(false)} />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // The dialog moves focus to itself when it mounts, which can win over autoFocus.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 200)
    return () => clearTimeout(id)
  }, [input])

  const enabled = query.length >= MIN_LENGTH
  const results = useOrgQuery<SearchResults>('/search', { q: query }, { enabled, keepPrevious: true, staleTime: 30_000 })
  const data = enabled ? results.data : undefined
  const loading = enabled && results.isFetching

  const go = (key: string) => {
    const [type, id] = key.split(':') as [keyof SearchResults, string]
    onClose()
    const params = { orgId }
    if (type === 'fields') void navigate({ to: '/o/$orgId/fields/$fieldId', params: { ...params, fieldId: id } })
    else if (type === 'equipment') void navigate({ to: '/o/$orgId/machinery/$equipmentId', params: { ...params, equipmentId: id } })
    else if (type === 'employees') void navigate({ to: '/o/$orgId/team', params, search: { open: id } })
    else if (type === 'products') void navigate({ to: '/o/$orgId/inventory', params, search: { open: id } })
    else void navigate({ to: '/o/$orgId/tasks', params, search: { open: id } })
  }

  const all: Section[] = data
    ? [
        {
          key: 'fields',
          label: t('search.section.fields'),
          icon: Map,
          items: data.fields.map((f) => ({ id: f.id, title: f.title, detail: join(f.identifier, f.detail) })),
        },
        {
          key: 'tasks',
          label: t('search.section.tasks'),
          icon: CalendarCheck2,
          items: data.tasks.map((x) => ({ id: x.id, title: x.title, detail: join(t(`enum.taskStatus.${x.status}`), x.dueOn && fmt.date(x.dueOn), x.detail) })),
        },
        {
          key: 'employees',
          label: t('search.section.employees'),
          icon: Users,
          items: data.employees.map((e) => ({ id: e.id, title: e.title, detail: join(e.detail, !e.active && t('search.inactive')) })),
        },
        {
          key: 'products',
          label: t('search.section.products'),
          icon: Package,
          items: data.products.map((p) => ({ id: p.id, title: p.title, detail: join(productCategoryLabel(p.category), p.detail) })),
        },
        {
          key: 'equipment',
          label: t('search.section.equipment'),
          icon: Tractor,
          items: data.equipment.map((m) => ({ id: m.id, title: m.title, detail: join(equipmentKindLabel(m.kind), m.detail) })),
        },
      ]
    : []
  const sections = all.filter((s) => s.items.length > 0)

  return (
    <Autocomplete inputValue={input} onInputChange={setInput}>
      <SearchField autoFocus aria-label={t('search.title')} className="flex items-center gap-2 px-4 h-13 border-b border-line">
        <Search className="size-4.5 text-muted shrink-0" aria-hidden />
        <Input
          ref={inputRef}
          placeholder={t('search.placeholder')}
          className="flex-1 min-w-0 bg-transparent h-full outline-none text-base text-fg placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {loading && <Loader2 className="size-4 text-muted animate-spin shrink-0" aria-hidden />}
      </SearchField>
      <Menu
        aria-label={t('search.title')}
        onAction={(key) => go(String(key))}
        className="outline-none p-2 max-h-[min(60dvh,28rem)] overflow-y-auto"
        renderEmptyState={() => (
          <p className="px-3 py-8 text-center text-sm text-muted">
            {!enabled ? t('search.hint') : results.data == null || loading ? t('search.loading') : t('search.empty', { query })}
          </p>
        )}
      >
        {sections.map((s) => (
          <MenuSection key={s.key} id={s.key} className="not-first:mt-2">
            <Header className="px-2.5 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.label}</Header>
            {s.items.map((item) => (
              <MenuItem
                key={item.id}
                id={`${s.key}:${item.id}`}
                textValue={item.title}
                className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-fg outline-none cursor-default focus:bg-surface-2"
              >
                <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  {item.detail && <span className="block truncate text-xs text-muted">{item.detail}</span>}
                </span>
              </MenuItem>
            ))}
          </MenuSection>
        ))}
      </Menu>
    </Autocomplete>
  )
}

const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null
