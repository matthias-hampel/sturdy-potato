import type { Operation } from '@agmeo/contracts'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { OperationStatusBadge, OperationTypeLabel } from '../labels'

export function OperationsTable({ operations, showFields = true, emptyText }: { operations: Operation[]; showFields?: boolean; emptyText?: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  return (
    <Table aria-label={t('operations.title')}>
      <TableHeader>
        <Column isRowHeader>{t('operations.operation')}</Column>
        <Column>{t('common.type')}</Column>
        <Column>{t('common.date')}</Column>
        {showFields ? <Column>{t('operations.fields')}</Column> : <Column>{t('operations.table.area')}</Column>}
        <Column>{t('operations.products')}</Column>
        <Column>{t('common.status')}</Column>
      </TableHeader>
      <TableBody items={operations} renderEmptyState={() => <div className="py-10 text-center text-sm text-muted">{emptyText ?? t('operations.table.empty')}</div>}>
        {(op) => (
          <Row id={op.id} href={`/o/${orgId}/operations/${op.id}`}>
            <Cell>
              <div className="font-medium">{op.title}</div>
              {op.responsibleEmployee && <div className="text-xs text-muted">{op.responsibleEmployee.name}</div>}
            </Cell>
            <Cell>
              <OperationTypeLabel type={op.type} className="text-sm whitespace-nowrap" />
            </Cell>
            <Cell className="whitespace-nowrap tabular">
              {op.performedAt ? fmt.date(op.performedAt) : <span className="text-muted">{t('operations.table.plannedOn', { date: fmt.date(op.plannedOn) })}</span>}
            </Cell>
            {showFields ? (
              <Cell>
                <div className="max-w-56 truncate">{op.fields.map((f) => f.fieldName).join(', ')}</div>
                <div className="text-xs text-muted tabular">{fmt.ha(op.totalAreaHa)}</div>
              </Cell>
            ) : (
              <Cell className="tabular whitespace-nowrap">{fmt.ha(op.totalAreaHa)}</Cell>
            )}
            <Cell>
              <div className="max-w-56 truncate text-fg-2">
                {op.inputs.length ? op.inputs.map((i) => `${i.productName} (${fmt.qty(i.ratePerHa, i.baseUnit)}/ha)`).join(', ') : <span className="text-muted">—</span>}
              </div>
            </Cell>
            <Cell>
              <OperationStatusBadge status={op.status} />
            </Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  )
}
