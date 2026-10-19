import { OPERATION_STATUSES, type Operation } from '@agmeo/contracts'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable } from '#/components/table/DataTable'
import { useTableView, type ColumnDef } from '#/components/table/tableTools'
import { operationTypeLabel } from '#/i18n/labels'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { OperationStatusBadge, OperationTypeLabel } from '../labels'

export function OperationsTable({ operations, showFields = true, emptyText }: { operations: Operation[]; showFields?: boolean; emptyText?: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const columns = useMemo<ColumnDef<Operation>[]>(
    () => [
      {
        id: 'operation',
        label: t('operations.operation'),
        value: (op) => op.title,
        text: (op) => [op.title, op.responsibleEmployee?.name].filter(Boolean).join(' '),
        render: (op) => (
          <>
            <div className="font-medium">{op.title}</div>
            {op.responsibleEmployee && <div className="text-xs text-muted">{op.responsibleEmployee.name}</div>}
          </>
        ),
      },
      { id: 'type', label: t('common.type'), filter: 'select', value: (op) => operationTypeLabel(op.type), render: (op) => <OperationTypeLabel type={op.type} className="text-sm whitespace-nowrap" /> },
      {
        id: 'date',
        label: t('common.date'),
        filter: 'date',
        className: 'whitespace-nowrap tabular',
        value: (op) => op.performedAt ?? op.plannedOn,
        render: (op) => (op.performedAt ? fmt.date(op.performedAt) : <span className="text-muted">{t('operations.table.plannedOn', { date: fmt.date(op.plannedOn) })}</span>),
      },
      showFields
        ? {
            id: 'fields',
            label: t('operations.fields'),
            filter: 'select',
            value: (op) => op.fields.map((f) => f.fieldName).join(', '),
            options: (op) => op.fields.map((f) => f.fieldName),
            render: (op) => (
              <>
                <div className="max-w-56 truncate">{op.fields.map((f) => f.fieldName).join(', ')}</div>
                <div className="text-xs text-muted tabular">{fmt.ha(op.totalAreaHa)}</div>
              </>
            ),
          }
        : { id: 'area', label: t('operations.table.area'), align: 'end', filter: 'number', value: (op) => op.totalAreaHa, render: (op) => fmt.ha(op.totalAreaHa) },
      {
        id: 'products',
        label: t('operations.products'),
        filter: 'select',
        value: (op) => op.inputs.map((i) => i.productName).join(', '),
        options: (op) => op.inputs.map((i) => i.productName),
        render: (op) => (
          <div className="max-w-56 truncate text-fg-2">
            {op.inputs.length ? op.inputs.map((i) => `${i.productName} (${fmt.qty(i.ratePerHa, i.baseUnit)}/ha)`).join(', ') : <span className="text-muted">—</span>}
          </div>
        ),
      },
      {
        id: 'status',
        label: t('common.status'),
        filter: 'select',
        value: (op) => OPERATION_STATUSES.indexOf(op.status),
        text: (op) => t(`enum.operationStatus.${op.status}`),
        render: (op) => <OperationStatusBadge status={op.status} />,
      },
    ],
    [t, showFields],
  )
  const view = useTableView(columns, operations)
  return (
    <DataTable
      aria-label={t('operations.title')}
      view={view}
      row={(op) => ({ href: `/o/${orgId}/operations/${op.id}` })}
      empty={<div className="py-10 text-center text-sm text-muted">{emptyText ?? t('operations.table.empty')}</div>}
    />
  )
}
