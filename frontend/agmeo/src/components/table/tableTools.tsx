import { Filter, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Button as AriaButton, CheckboxContext, Dialog as AriaDialog, DialogTrigger, Popover, type Selection, type SortDescriptor } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '#/lib/api'
import { useOrgMutation } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, SearchField } from '#/ui/Field'
import { toast } from '#/ui/Toast'
import { cx, focusRing } from '#/ui/utils'

/** How a column is filtered: free text, a choice among the values it holds, or a range. */
export type FilterKind = 'text' | 'select' | 'number' | 'date'

/** A table column that can be sorted and filtered. */
export interface ColumnDef<R> {
  id: string
  label: string
  align?: 'end'
  /** The column that names a row; a DataTable takes the first one when none is marked. */
  isRowHeader?: boolean
  className?: string
  /** Sort key; empty values sort last in both directions. Number and date filters compare against it. */
  value: (r: R) => string | number | null | undefined
  /** What the text search matches against, as shown in the cell; defaults to the value. */
  text?: (r: R) => string | null | undefined
  /** Defaults to a text search. */
  filter?: FilterKind
  /** The values a row offers to a select filter (a field can grow several crops); defaults to its text. */
  options?: (r: R) => (string | null | undefined)[]
  render: (r: R) => ReactNode
}

export type FilterValue =
  | { kind: 'text'; q: string }
  | { kind: 'select'; values: string[] }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'date'; from: string | null; to: string | null }

const isEmpty = (v: unknown) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))

export function isActive(f: FilterValue | undefined): f is FilterValue {
  if (!f) return false
  if (f.kind === 'text') return !!f.q.trim()
  if (f.kind === 'select') return f.values.length > 0
  if (f.kind === 'number') return !Number.isNaN(f.min) || !Number.isNaN(f.max)
  return !!f.from || !!f.to
}

const textOf = <R,>(c: ColumnDef<R>, r: R) => (c.text ?? c.value)(r)
const optionsOf = <R,>(c: ColumnDef<R>, r: R) => (c.options ? c.options(r) : [textOf(c, r)]).filter((v): v is string | number => !isEmpty(v)).map(String)

function matches<R>(c: ColumnDef<R>, f: FilterValue, r: R) {
  if (f.kind === 'text') {
    const s = textOf(c, r)
    return !isEmpty(s) && String(s).toLowerCase().includes(f.q.trim().toLowerCase())
  }
  if (f.kind === 'select') return optionsOf(c, r).some((o) => f.values.includes(o))
  const v = c.value(r)
  if (isEmpty(v)) return false
  if (f.kind === 'number') {
    if (typeof v !== 'number') return false
    // Compared as shown: 4.004 ha reads 4,00 ha and lies within "up to 4".
    const shown = Math.round(v * 100) / 100
    return (Number.isNaN(f.min) || shown >= f.min) && (Number.isNaN(f.max) || shown <= f.max)
  }
  const day = String(v).slice(0, 10)
  return (!f.from || day >= f.from) && (!f.to || day <= f.to)
}

export function compareBy<R>(column: ColumnDef<R>, direction: SortDescriptor['direction']) {
  const dir = direction === 'descending' ? -1 : 1
  return (a: R, b: R) => {
    const va = column.value(a)
    const vb = column.value(b)
    if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) === isEmpty(vb) ? 0 : isEmpty(va) ? 1 : -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir
  }
}

/** Sort order and per-column filters of a table; `rows` provide the choices of the select filters. */
export function useTableView<R>(columns: ColumnDef<R>[], rows: R[]) {
  const [sort, setSort] = useState<SortDescriptor | undefined>()
  const [filters, setFilters] = useState<Record<string, FilterValue>>({})
  return useMemo(() => {
    const active = columns.flatMap((c) => (isActive(filters[c.id]) ? [{ c, f: filters[c.id] }] : []))
    const column = sort && columns.find((c) => c.id === sort.column)
    const compare = column ? compareBy(column, sort.direction) : null
    const shown = rows.filter((r) => active.every(({ c, f }) => matches(c, f, r)))
    if (compare) shown.sort(compare)
    const choices = (c: ColumnDef<R>) => [...new Set(rows.flatMap((r) => optionsOf(c, r)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    return {
      columns,
      /** The rows that pass the filters, in sort order. */
      shown,
      sort,
      setSort,
      filters,
      setFilter: (id: string, v: FilterValue | undefined) => setFilters((f) => ({ ...f, [id]: v }) as Record<string, FilterValue>),
      clearFilters: () => setFilters({}),
      filtered: active.length > 0,
      matches: (r: R) => active.every(({ c, f }) => matches(c, f, r)),
      compare,
      /** Header content of a column: its label and the filter button. */
      head: (c: ColumnDef<R>) => <ColumnHead label={c.label} kind={c.filter ?? 'text'} choices={c.filter === 'select' ? () => choices(c) : undefined} value={filters[c.id]} onChange={(v) => setFilters((f) => ({ ...f, [c.id]: v }) as Record<string, FilterValue>)} />,
    }
  }, [columns, rows, sort, filters])
}

export type TableView<R> = ReturnType<typeof useTableView<R>>

function ColumnHead({ label, kind, choices, value, onChange }: { label: string; kind: FilterKind; choices?: () => string[]; value: FilterValue | undefined; onChange: (v: FilterValue | undefined) => void }) {
  const { t } = useTranslation()
  const Icon = kind === 'text' ? Search : Filter
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <DialogTrigger>
        <AriaButton
          aria-label={t('table.filterColumn', { column: label })}
          className={cx(
            'size-5 rounded inline-flex items-center justify-center cursor-pointer hover:bg-surface-3 hover:text-fg',
            isActive(value) ? 'text-primary bg-primary-soft' : 'text-muted/70',
            focusRing,
          )}
        >
          <Icon className="size-3" aria-hidden />
        </AriaButton>
        <Popover placement="bottom start" offset={6} className="rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-overlay)] normal-case tracking-normal font-normal text-fg">
          <AriaDialog aria-label={t('table.filterColumn', { column: label })} className="outline-none p-3 w-72 space-y-3">
            {/* The table's selection checkboxes reach in here through context; these are plain ones. */}
            <CheckboxContext.Provider value={null}>
              {kind === 'text' && <SearchField autoFocus value={value?.kind === 'text' ? value.q : ''} onChange={(q) => onChange({ kind: 'text', q })} placeholder={t('table.searchIn', { column: label })} />}
              {kind === 'select' && <SelectFilter choices={choices?.() ?? []} values={value?.kind === 'select' ? value.values : []} onChange={(values) => onChange({ kind: 'select', values })} />}
              {kind === 'number' && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label={t('table.from')} autoFocus value={value?.kind === 'number' ? value.min : NaN} formatOptions={{ maximumFractionDigits: 3 }} onChange={(min) => onChange({ kind: 'number', min, max: value?.kind === 'number' ? value.max : NaN })} />
                  <NumberField label={t('table.to')} value={value?.kind === 'number' ? value.max : NaN} formatOptions={{ maximumFractionDigits: 3 }} onChange={(max) => onChange({ kind: 'number', min: value?.kind === 'number' ? value.min : NaN, max })} />
                </div>
              )}
              {kind === 'date' && (
                <div className="space-y-2">
                  <DatePicker label={t('table.from')} value={value?.kind === 'date' ? value.from : null} onChange={(from) => onChange({ kind: 'date', from, to: value?.kind === 'date' ? value.to : null })} />
                  <DatePicker label={t('table.to')} value={value?.kind === 'date' ? value.to : null} onChange={(to) => onChange({ kind: 'date', from: value?.kind === 'date' ? value.from : null, to })} />
                </div>
              )}
              {kind !== 'text' && (
                <div className="flex justify-end">
                  <Button size="sm" variant="quiet" isDisabled={!isActive(value)} onPress={() => onChange(undefined)}>{t('table.resetFilter')}</Button>
                </div>
              )}
            </CheckboxContext.Provider>
          </AriaDialog>
        </Popover>
      </DialogTrigger>
    </span>
  )
}

/** Tick the values to show; the search narrows a long list. */
function SelectFilter({ choices, values, onChange }: { choices: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const visible = choices.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="space-y-2">
      {choices.length > 6 && <SearchField autoFocus value={q} onChange={setQ} placeholder={t('table.searchValues')} />}
      <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-0.5">
        {visible.map((c) => (
          <div key={c} className="rounded-md px-1.5 py-1 hover:bg-surface-2">
            <Checkbox isSelected={values.includes(c)} onChange={(on) => onChange(on ? [...values, c] : values.filter((v) => v !== c))} className="w-full">
              <span className="truncate">{c}</span>
            </Checkbox>
          </div>
        ))}
        {!visible.length && <p className="text-sm text-muted px-1.5 py-1">{t('table.noValues')}</p>}
      </div>
    </div>
  )
}

/** Row keys of a table selection, with "all" resolved against the rows shown. */
export function selectedIds(selection: Selection, shown: { id: string }[]): Set<string> {
  return selection === 'all' ? new Set(shown.map((r) => r.id)) : new Set([...selection].map(String))
}

/** Floats at the bottom of the screen while rows are selected. */
export function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  if (!count) return null
  return (
    <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none mt-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-overlay)]">
        <span className="text-sm font-medium text-fg px-1 tabular">{t('table.selected', { count })}</span>
        <span className="h-5 w-px bg-line" aria-hidden />
        {children}
        <Button size="icon-sm" variant="ghost" aria-label={t('table.clearSelection')} onPress={onClear}>
          <X />
        </Button>
      </div>
    </div>
  )
}

/** Shown in place of rows when the column searches leave nothing. */
export function NoMatches({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="py-10 text-center text-sm text-muted space-y-2">
      <p>{t('table.noMatches')}</p>
      <Button size="sm" variant="quiet" onPress={onReset}>{t('table.resetSearch')}</Button>
    </div>
  )
}

/** Runs one request per item; reports how many succeeded and why the others failed. */
export function useBulkMutation<T>(fn: (orgPath: string, item: T) => Promise<unknown>, opts: { label: (item: T) => string; success: (count: number) => string; onDone?: () => void }) {
  const { t } = useTranslation()
  return useOrgMutation(
    async (base, items: T[]) => {
      const results = await Promise.allSettled(items.map((i) => fn(base, i)))
      const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${opts.label(items[i])}: ${errorMessage(r.reason)}`] : []))
      return { ok: items.length - failed.length, failed }
    },
    {
      onSuccess: (r) => {
        if (r.ok) toast.success(opts.success(r.ok))
        if (r.failed.length) toast.error(t('table.bulkFailed', { count: r.failed.length }), r.failed.slice(0, 3).join('\n'))
        opts.onDone?.()
      },
    },
  )
}
