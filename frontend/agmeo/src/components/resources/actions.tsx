import { OPERATION_TYPES, type Employee, type Equipment, type OperationAction, type OperationActionInput, type OperationType } from '@agmeo/contracts'
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { operationTypeLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { FormActions, NONE, keyOrNull, textOrNull } from './form'
import { KtblLookup } from './ktbl'

/**
 * The organization's actions (Maßnahmenkatalog): named passes with diesel and hours per hectare
 * and a default machine, implement and operator. Operations planned from an action take them over.
 */
export function ActionCatalogue() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const canWrite = can('machinery.write')
  const actions = useOrgQuery<OperationAction[]>('/operation-actions')
  const [editing, setEditing] = useState<OperationAction | 'new' | null>(null)
  const remove = useOrgMutation((base, a: OperationAction) => api.delete<{ archived: boolean }>(`${base}/operation-actions/${a.id}`), {
    success: (r) => (r.archived ? t('actions.archived') : t('actions.deleted')),
  })

  if (actions.isLoading) return <Loading />
  if (actions.error) return <ErrorNotice error={actions.error} />
  const rows = actions.data ?? []
  const add = canWrite && (
    <Button variant="primary" onPress={() => setEditing('new')}>
      <Plus /> {t('actions.add')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted max-w-2xl">{t('actions.description')}</p>
        {rows.length > 0 && add}
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ListChecks} title={t('actions.empty.title')} action={add}>
            {t('actions.empty.text')}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <Table aria-label={t('actions.title')}>
            <TableHeader>
              <Column isRowHeader>{t('common.name')}</Column>
              <Column>{t('actions.operationType')}</Column>
              <Column align="end">{t('actions.dieselPerHa')}</Column>
              <Column align="end">{t('actions.hoursPerHa')}</Column>
              <Column>{t('actions.machine')}</Column>
              <Column>{t('actions.implement')}</Column>
              <Column>{t('actions.operator')}</Column>
              <Column align="end">{t('actions.usage')}</Column>
              {canWrite && (
                <Column>
                  <span className="sr-only">{t('common.actions')}</span>
                </Column>
              )}
            </TableHeader>
            <TableBody items={rows} dependencies={[canWrite]}>
              {(a) => (
                <Row id={a.id}>
                  <Cell className="font-medium">
                    {a.name}
                    {a.ktblFqn && (
                      <Badge tone="info" className="ml-2">
                        {t('ktbl.badge')}
                      </Badge>
                    )}
                  </Cell>
                  <Cell className="whitespace-nowrap">{operationTypeLabel(a.operationType)}</Cell>
                  <Cell align="end" className="tabular">{a.dieselLPerHa != null ? `${fmt.num(a.dieselLPerHa, 1)} l` : <span className="text-muted">—</span>}</Cell>
                  <Cell align="end" className="tabular">{a.hoursPerHa != null ? `${fmt.num(a.hoursPerHa, 2)} h` : <span className="text-muted">—</span>}</Cell>
                  <Cell>{a.machineName ?? <span className="text-muted">—</span>}</Cell>
                  <Cell>{a.implementName ?? <span className="text-muted">—</span>}</Cell>
                  <Cell>{a.employeeName ?? <span className="text-muted">—</span>}</Cell>
                  <Cell align="end" className="tabular">{fmt.num(a.usageCount)}</Cell>
                  {canWrite && (
                    <Cell className="w-0 whitespace-nowrap">
                      <Button variant="ghost" size="icon-sm" aria-label={t('actions.editNamed', { name: a.name })} onPress={() => setEditing(a)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={a.usageCount ? t('actions.archiveNamed', { name: a.name }) : t('actions.deleteNamed', { name: a.name })}
                        onPress={() => remove.mutate(a)}
                      >
                        <Trash2 />
                      </Button>
                    </Cell>
                  )}
                </Row>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      <ModalDialog
        isOpen={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing && editing !== 'new' ? t('actions.editNamed', { name: editing.name }) : t('actions.add')}
        size="lg"
      >
        {(close) => <ActionForm action={editing && editing !== 'new' ? editing : undefined} close={close} />}
      </ModalDialog>
    </div>
  )
}

function ActionForm({ action: a, close }: { action?: OperationAction; close: () => void }) {
  const { t } = useTranslation()
  const equipment = useOrgQuery<Equipment[]>('/equipment')
  const employees = useOrgQuery<Employee[]>('/employees')
  const [name, setName] = useState(a?.name ?? '')
  const [operationType, setOperationType] = useState<OperationType>(a?.operationType ?? 'tillage')
  const [dieselLPerHa, setDieselLPerHa] = useState(a?.dieselLPerHa ?? NaN)
  const [hoursPerHa, setHoursPerHa] = useState(a?.hoursPerHa ?? NaN)
  const [machineId, setMachineId] = useState<string>(a?.machineId ?? NONE)
  const [implementId, setImplementId] = useState<string>(a?.implementId ?? NONE)
  const [employeeId, setEmployeeId] = useState<string>(a?.employeeId ?? NONE)
  const [notes, setNotes] = useState(a?.notes ?? '')
  const [ktblFqn, setKtblFqn] = useState<string | null>(a?.ktblFqn ?? null)
  const all = equipment.data ?? []
  const none = { id: NONE, name: t('actions.none') }
  const machines = [none, ...all.filter((e) => e.class === 'machine')]
  const implementsList = [none, ...all.filter((e) => e.class === 'implement')]
  const people = [none, ...(employees.data ?? []).filter((x) => x.active || x.id === a?.employeeId)]

  const save = useOrgMutation(
    (base, input: OperationActionInput) => (a ? api.put<OperationAction>(`${base}/operation-actions/${a.id}`, input) : api.post<OperationAction>(`${base}/operation-actions`, input)),
    { success: a ? t('actions.updated') : t('actions.created'), onSuccess: close },
  )

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          name: name.trim(),
          operationType,
          dieselLPerHa: num(dieselLPerHa),
          hoursPerHa: num(hoursPerHa),
          machineId: keyOrNull(machineId),
          implementId: keyOrNull(implementId),
          employeeId: keyOrNull(employeeId),
          notes: textOrNull(notes),
          ktblFqn,
        })
      }}
    >
      <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('actions.namePlaceholder')} />
      <Select
        label={t('actions.operationType')}
        items={OPERATION_TYPES.map((id) => ({ id, name: operationTypeLabel(id) }))}
        value={operationType}
        onChange={(v) => v && setOperationType(v as OperationType)}
      >
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </Select>
      <KtblLookup
        operationType={operationType}
        machinePowerKw={all.find((m) => m.id === machineId)?.powerKw ?? null}
        linked={ktblFqn}
        onApply={(v) => {
          if (!name.trim()) setName(v.name)
          setDieselLPerHa(v.dieselLPerHa)
          setHoursPerHa(v.hoursPerHa)
          setKtblFqn(v.fqn)
        }}
      />
      <NumberField label={t('actions.dieselPerHa')} unit="l/ha" value={dieselLPerHa} onChange={setDieselLPerHa} minValue={0} maxValue={1000} formatOptions={{ maximumFractionDigits: 2 }} description={t('actions.dieselHint')} />
      <NumberField label={t('actions.hoursPerHa')} unit="h/ha" value={hoursPerHa} onChange={setHoursPerHa} minValue={0} maxValue={100} formatOptions={{ maximumFractionDigits: 3 }} description={t('actions.hoursHint')} />
      <Select label={t('actions.machine')} items={machines} value={machineId} onChange={(v) => setMachineId(String(v ?? NONE))}>
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </Select>
      <Select label={t('actions.implement')} items={implementsList} value={implementId} onChange={(v) => setImplementId(String(v ?? NONE))}>
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </Select>
      <Select label={t('actions.operator')} items={people} value={employeeId} onChange={(v) => setEmployeeId(String(v ?? NONE))}>
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </Select>
      <TextField label={t('common.notes')} value={notes} onChange={setNotes} />
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={a ? t('common.saveChanges') : t('actions.add')} />
      </div>
    </Form>
  )
}
