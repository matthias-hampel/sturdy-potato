import type { ReactNode } from 'react'
import type { Key, RowProps, Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '#/ui/Field'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { NoMatches, type TableView } from './tableTools'

/**
 * A table whose columns sort on a click and search or filter from the header, laid out from `useTableView`.
 * Rows without results of the column searches show a reset; without any rows at all, `empty`.
 */
export function DataTable<R extends { id: string }>({
  view,
  empty,
  actions,
  row,
  dependencies = [],
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  disabledKeys,
  ...props
}: {
  'aria-label': string
  view: TableView<R>
  empty?: ReactNode
  /** A trailing column without a heading, for a row's buttons or menu. */
  actions?: (r: R) => ReactNode
  row?: (r: R) => Pick<RowProps<R>, 'href' | 'onAction' | 'className'>
  /** Further values the cells render from besides the row, so they redraw when these change. */
  dependencies?: unknown[]
  selectionMode?: 'none' | 'multiple'
  selectedKeys?: Selection
  onSelectionChange?: (keys: Selection) => void
  disabledKeys?: Iterable<Key>
}) {
  const { t } = useTranslation()
  const { columns } = view
  const rowHeader = (columns.find((c) => c.isRowHeader) ?? columns[0])?.id
  const selectable = selectionMode === 'multiple'
  return (
    <Table
      aria-label={props['aria-label']}
      selectionMode={selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      disabledKeys={disabledKeys}
      disabledBehavior="selection"
      sortDescriptor={view.sort}
      onSortChange={view.setSort}
    >
      <TableHeader>
        {selectable && (
          <Column className="w-10">
            <Checkbox slot="selection" />
          </Column>
        )}
        {columns.map((c) => (
          <Column key={c.id} id={c.id} isRowHeader={c.id === rowHeader} align={c.align} allowsSorting>
            {view.head(c)}
          </Column>
        ))}
        {actions && <Column aria-label={t('common.actions')}> </Column>}
      </TableHeader>
      <TableBody
        items={view.shown}
        dependencies={[view, actions, row, ...dependencies]}
        renderEmptyState={() => (view.filtered ? <NoMatches onReset={view.clearFilters} /> : (empty ?? <div className="py-10 text-center text-sm text-muted">{t('table.empty')}</div>))}
      >
        {(r) => (
          <Row id={r.id} {...row?.(r)}>
            {selectable && (
              <Cell>
                <Checkbox slot="selection" />
              </Cell>
            )}
            {columns.map((c) => (
              <Cell key={c.id} align={c.align} className={c.className}>
                {c.render(r)}
              </Cell>
            ))}
            {actions && <Cell className="w-0">{actions(r)}</Cell>}
          </Row>
        )}
      </TableBody>
    </Table>
  )
}
