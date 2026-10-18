import { ArrowUp } from 'lucide-react'
import {
  Cell as AriaCell,
  type CellProps,
  Column as AriaColumn,
  type ColumnProps,
  Row as AriaRow,
  type RowProps,
  Table as AriaTable,
  TableBody as AriaTableBody,
  type TableBodyProps,
  TableHeader as AriaTableHeader,
  type TableHeaderProps,
  type TableProps,
  composeRenderProps,
} from 'react-aria-components'
import { composeClass, cx } from './utils'

export function Table({ className, ...props }: TableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <AriaTable {...props} className={composeClass(className, 'w-full text-sm border-separate border-spacing-0')} />
    </div>
  )
}

export function TableHeader<T extends object>(props: TableHeaderProps<T>) {
  return <AriaTableHeader {...props} className="text-left" />
}

export function Column({ className, children, align, ...props }: ColumnProps & { align?: 'start' | 'end' }) {
  return (
    <AriaColumn
      {...props}
      className={composeClass(
        className,
        cx(
          'group px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted border-b border-line whitespace-nowrap outline-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 allows-sorting:cursor-default allows-sorting:hover:text-fg',
          align === 'end' && 'text-right',
        ),
      )}
    >
      {composeRenderProps(children, (children, { allowsSorting, sortDirection }) => (
        <span className={cx('inline-flex items-center gap-1', align === 'end' && 'flex-row-reverse')}>
          {children}
          {allowsSorting && (
            <ArrowUp
              aria-hidden
              className={cx('size-3.5 transition-transform', !sortDirection && 'invisible', sortDirection === 'descending' && 'rotate-180')}
            />
          )}
        </span>
      ))}
    </AriaColumn>
  )
}

export function TableBody<T extends object>(props: TableBodyProps<T>) {
  return <AriaTableBody {...props} />
}

export function Row<T extends object>({ className, ...props }: RowProps<T>) {
  return (
    <AriaRow
      {...props}
      className={composeClass(
        className,
        cx(
          'group outline-none text-fg',
          props.href || props.onAction ? 'cursor-pointer hover:bg-surface-2/70' : 'hover:bg-surface-2/40',
          'focus-visible:bg-primary-soft selected:bg-primary-soft',
        ),
      )}
    />
  )
}

export function Cell({ className, align, ...props }: CellProps & { align?: 'start' | 'end' }) {
  return (
    <AriaCell
      {...props}
      className={composeClass(className, cx('px-3 py-2.5 border-b border-line align-middle', align === 'end' && 'text-right tabular whitespace-nowrap'))}
    />
  )
}
