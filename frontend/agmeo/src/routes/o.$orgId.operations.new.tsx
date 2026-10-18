import { OPERATION_TYPES, type Farm, type Field, type Operation, type OperationType } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { OperationForm, initialState, toPayload, type OperationFormState } from '#/components/operations/OperationForm'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { EmptyState, Loading, Notice, PageHeader } from '#/ui/Layout'
import { toast } from '#/ui/Toast'

export const Route = createFileRoute('/o/$orgId/operations/new')({
  validateSearch: z.object({ fieldId: z.string().optional(), fieldIds: z.array(z.string()).optional(), type: z.enum(OPERATION_TYPES).optional() }),
  component: NewOperation,
})

function NewOperation() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { fieldId, fieldIds, type } = Route.useSearch()
  const farms = useOrgQuery<Farm[]>('/farms')
  const fields = useOrgQuery<Field[]>('/fields')
  if (!can('operation.write')) return <EmptyState title={t('operations.new.noPermission')} />
  if (!farms.data || !fields.data) return <Loading />
  const wanted = fieldIds ?? (fieldId ? [fieldId] : [])
  const picked = fields.data.filter((f) => wanted.includes(f.id))
  // An operation belongs to one farm: fields of other farms than the first one are left out.
  const farmId = picked[0]?.farmId ?? farms.data[0]?.id ?? null
  const preset = picked.filter((f) => f.farmId === farmId)
  return (
    <>
      <PageHeader eyebrow={<Link to="/o/$orgId/operations" params={{ orgId }}>{t('operations.title')}</Link>} title={t('operations.new.title')} subtitle={t('operations.new.subtitle')} />
      {preset.length < picked.length && <Notice tone="warning" className="mb-4">{t('operations.new.otherFarmsSkipped', { count: picked.length - preset.length })}</Notice>}
      <Editor farmId={farmId} fieldIds={preset.map((f) => f.id)} fields={fields.data} type={type} />
    </>
  )
}

function Editor({ farmId, fieldIds, fields, type }: { farmId: string | null; fieldIds: string[]; fields: Field[]; type?: OperationType }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [state, setState] = useState<OperationFormState>(() => initialState({ farmId, fieldIds, fields, type }))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // Created but not yet completed (e.g. stock shortage): further saves complete this one.
  const [created, setCreated] = useState<Operation | null>(null)

  useEffect(() => setError(null), [state])

  const finish = async (op: Operation) => {
    await qc.invalidateQueries({ queryKey: ['org', orgId] })
    toast.success(op.status === 'completed' ? t('operations.toast.recorded') : t('operations.toast.planned'), op.title)
    await navigate({ to: '/o/$orgId/operations/$operationId', params: { orgId, operationId: op.id } })
  }

  const complete = async (op: Operation, allowNegativeStock = false) =>
    api.post<Operation>(`/orgs/${orgId}/operations/${op.id}/complete`, {
      version: op.version,
      performedAt: toPayload(state, fields).performedAt,
      allowNegativeStock,
    })

  const submit = async (allowNegativeStock = false) => {
    setPending(true)
    setError(null)
    try {
      let op = created
        ? await api.put<Operation>(`/orgs/${orgId}/operations/${created.id}`, toPayload(state, fields, created.version))
        : await api.post<Operation>(`/orgs/${orgId}/operations`, toPayload(state, fields))
      setCreated(op)
      if (state.done) op = await complete(op, allowNegativeStock)
      await finish(op)
    } catch (e) {
      setError(e)
    } finally {
      setPending(false)
    }
  }

  return (
    <OperationForm
      value={state}
      onChange={setState}
      onSubmit={() => submit(false)}
      onForceComplete={() => submit(true)}
      isPending={pending}
      error={error}
      allowRecordDone
      submitLabel={state.done ? t('operations.new.submitDone') : t('operations.new.submitPlanned')}
      extraActions={
        created && (
          <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: created.id }} variant="secondary">
            {t('operations.new.keepPlanned')}
          </Link>
        )
      }
    />
  )
}
