import { OPERATION_TYPES, type Operation, type OperationStatus, type OperationType } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ClipboardList, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OperationsTable } from '#/components/operations/OperationsTable'
import { operationTypeLabel } from '#/i18n/labels'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link, SegmentedControl } from '#/ui/Button'
import { Option, SearchField, Select } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/operations/')({ component: OperationsPage })

type StatusFilter = 'all' | 'open' | OperationStatus

function OperationsPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId, season } = useSeason()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<OperationType | 'all'>('all')
  const [search, setSearch] = useState('')
  const ops = useOrgQuery<Operation[]>('/operations', { seasonId, type: type === 'all' ? undefined : type })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (ops.data ?? []).filter((o) => {
      if (status === 'open' && !(o.status === 'planned' || o.status === 'in_progress')) return false
      if (status !== 'all' && status !== 'open' && o.status !== status) return false
      if (!q) return true
      return o.title.toLowerCase().includes(q) || o.fields.some((f) => f.fieldName.toLowerCase().includes(q)) || o.inputs.some((i) => i.productName.toLowerCase().includes(q))
    })
  }, [ops.data, status, search])

  const counts = useMemo(() => {
    const all = ops.data ?? []
    return { open: all.filter((o) => o.status === 'planned' || o.status === 'in_progress').length, completed: all.filter((o) => o.status === 'completed').length }
  }, [ops.data])

  return (
    <>
      <PageHeader
        title={t('operations.title')}
        subtitle={season ? t('operations.subtitleSeason', { season: season.name }) : t('operations.subtitle')}
        actions={can('operation.write') && <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{}} variant="primary"><Plus /> {t('operations.newOperation')}</Link>}
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedControl
          aria-label={t('common.status')}
          value={status}
          onChange={setStatus}
          items={[
            { id: 'all', label: t('operations.filter.all') },
            { id: 'open', label: t('operations.filter.planned', { n: counts.open }) },
            { id: 'completed', label: t('operations.filter.completed', { n: counts.completed }) },
            { id: 'canceled', label: t('operations.filter.canceled') },
          ]}
        />
        <Select aria-label={t('common.type')} className="w-48" items={[{ id: 'all', name: t('operations.filter.allTypes') }, ...OPERATION_TYPES.map((ty) => ({ id: ty, name: operationTypeLabel(ty) }))]} value={type} onChange={(v) => setType((v as OperationType) ?? 'all')}>
          {(item) => <Option id={item.id}>{item.name}</Option>}
        </Select>
        <SearchField placeholder={t('operations.searchPlaceholder')} value={search} onChange={setSearch} className="w-72 max-w-full" />
      </div>
      {ops.isLoading ? (
        <Loading />
      ) : ops.error ? (
        <ErrorNotice error={ops.error} />
      ) : (ops.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title={t('operations.empty.title')} action={can('operation.write') && <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{}} variant="primary"><Plus /> {t('operations.empty.action')}</Link>}>
            {t('operations.empty.body')}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <OperationsTable operations={visible} emptyText={t('operations.noMatch')} />
        </Card>
      )}
    </>
  )
}
