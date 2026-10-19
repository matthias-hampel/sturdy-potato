import { OPERATION_TYPES, type Field, type FieldGroup, type Operation, type OperationStatus, type OperationType } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ClipboardList, List, Map as MapIcon, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldMap } from '#/components/map/FieldMap'
import { OperationsTable } from '#/components/operations/OperationsTable'
import { operationTypeLabel } from '#/i18n/labels'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Option, SearchField, Select } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/operations/')({ component: OperationsPage })

type StatusFilter = 'all' | 'open' | OperationStatus

/** Map fills (MapLibre needs plain colours): fields with open work, and with done work only. */
const OPEN_COLOR = '#e8a317'
const DONE_COLOR = '#3f8f3a'

function OperationsPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId, season } = useSeason()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<OperationType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [fieldId, setFieldId] = useState<string | null>(null)
  const ops = useOrgQuery<Operation[]>('/operations', { seasonId, type: type === 'all' ? undefined : type })
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const groups = useOrgQuery<FieldGroup[]>('/field-groups')
  const groupFields = useMemo(() => (groupId ? new Set((fields.data ?? []).filter((f) => f.groups.some((g) => g.id === groupId)).map((f) => f.id)) : null), [fields.data, groupId])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (ops.data ?? []).filter((o) => {
      if (fieldId && !o.fields.some((f) => f.fieldId === fieldId)) return false
      if (groupFields && !o.fields.some((f) => groupFields.has(f.fieldId))) return false
      if (status === 'open' && !(o.status === 'planned' || o.status === 'in_progress')) return false
      if (status !== 'all' && status !== 'open' && o.status !== status) return false
      if (!q) return true
      return o.title.toLowerCase().includes(q) || o.fields.some((f) => f.fieldName.toLowerCase().includes(q)) || o.inputs.some((i) => i.productName.toLowerCase().includes(q))
    })
  }, [ops.data, status, search, fieldId, groupFields])

  // Per field: open work outweighs done work on the map (reference operations map).
  const stateOf = useMemo(() => {
    const m = new Map<string, 'open' | 'done'>()
    for (const o of visible) {
      for (const f of o.fields) {
        if (o.status === 'planned' || o.status === 'in_progress') m.set(f.fieldId, 'open')
        else if (o.status === 'completed' && !m.has(f.fieldId)) m.set(f.fieldId, 'done')
      }
    }
    return m
  }, [visible])
  const mapFields = (fields.data ?? []).filter((f) => !groupFields || groupFields.has(f.id))
  const fieldName = fieldId ? fields.data?.find((f) => f.id === fieldId)?.name : null

  const counts = useMemo(() => {
    const all = ops.data ?? []
    return { open: all.filter((o) => o.status === 'planned' || o.status === 'in_progress').length, completed: all.filter((o) => o.status === 'completed').length }
  }, [ops.data])

  return (
    <>
      <PageHeader
        title={t('operations.title')}
        subtitle={season ? t('operations.subtitleSeason', { season: season.harvestYear }) : t('operations.subtitle')}
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
        <Select aria-label={t('operations.map.group')} className="w-48" items={[{ id: '__all', name: t('operations.map.allGroups') }, ...(groups.data ?? [])]} value={groupId ?? '__all'} onChange={(v) => setGroupId(v && v !== '__all' ? String(v) : null)}>
          {(item) => <Option id={item.id}>{item.name}</Option>}
        </Select>
        <SearchField placeholder={t('operations.searchPlaceholder')} value={search} onChange={setSearch} className="w-72 max-w-full" />
        {fieldName && (
          <Button size="sm" variant="quiet" onPress={() => setFieldId(null)} aria-label={t('operations.map.clearField')}>
            {fieldName} <X />
          </Button>
        )}
        <SegmentedControl
          aria-label={t('operations.map.view')}
          value={view}
          onChange={setView}
          items={[
            { id: 'list', label: <span className="inline-flex items-center gap-1"><List className="size-4" aria-hidden /> {t('operations.map.list')}</span> },
            { id: 'map', label: <span className="inline-flex items-center gap-1"><MapIcon className="size-4" aria-hidden /> {t('operations.map.map')}</span> },
          ]}
        />
      </div>
      {view === 'map' && (
        <Card padded={false} className="mb-4">
          <div className="relative h-[28rem]">
            <FieldMap
              fields={mapFields}
              selectedId={fieldId}
              onSelect={(id) => setFieldId(id)}
              colorBy={(f) => (stateOf.get(f.id) === 'open' ? OPEN_COLOR : stateOf.get(f.id) === 'done' ? DONE_COLOR : null)}
              fillOpacity={0.5}
              className="h-full"
            />
            <div className="absolute left-3 bottom-10 rounded-md bg-surface/95 p-2 text-xs shadow space-y-1">
              <p className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: OPEN_COLOR }} /> {t('operations.map.open')}</p>
              <p className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: DONE_COLOR }} /> {t('operations.map.done')}</p>
            </div>
          </div>
        </Card>
      )}
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
