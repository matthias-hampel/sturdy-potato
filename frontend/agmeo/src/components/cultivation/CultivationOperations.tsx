import type { CropCycle, CultivationTemplate, Field, Operation, TemplateStep } from '@agmeo/contracts'
import { ListChecks, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApplyTemplateDialog } from '#/components/crops/CycleDialogs'
import { OperationStatusBadge, OperationTypeLabel, templateStepTiming } from '#/components/labels'
import { OperationsTable } from '#/components/operations/OperationsTable'
import { fmt, addDays } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Card, EmptyState, Loading, Stat } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

type View = 'plan' | 'actual'

/** Maßnahmen: the crop's template (Soll) and its recorded operations (Ist). */
export function CultivationOperations({
  cycle,
  field,
  operations,
  isLoading,
  view,
  onView,
}: {
  cycle: CropCycle
  field: Field
  operations: Operation[]
  isLoading: boolean
  view: View
  onView: (v: View) => void
}) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [applyOpen, setApplyOpen] = useState(false)
  const count = (status: Operation['status']) => operations.filter((o) => o.status === status).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label={t('cultivation.ops.view')}
          items={[
            { id: 'plan', label: t('cultivation.ops.plan') },
            { id: 'actual', label: t('cultivation.ops.actual') },
          ]}
          value={view}
          onChange={onView}
        />
        <span className="text-sm text-muted inline-flex items-center gap-1.5">
          <ListChecks className="size-4" aria-hidden />
          {cycle.templateName ?? t('cultivation.ops.noTemplate')}
        </span>
        <div className="ml-auto flex gap-2">
          {can('operation.write') && (
            <Button size="sm" onPress={() => setApplyOpen(true)}>
              <ListChecks /> {cycle.templateId ? t('cultivation.ops.changeTemplate') : t('templates.apply.action')}
            </Button>
          )}
          {can('operation.write') && (
            <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{ fieldId: field.id }} variant="primary" size="sm">
              <Plus /> {t('fieldPage.operations.record')}
            </Link>
          )}
        </div>
      </div>

      {view === 'plan' ? (
        <PlanView cycle={cycle} operations={operations} onApply={can('operation.write') ? () => setApplyOpen(true) : undefined} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Stat label={t('enum.operationStatus.planned')} value={fmt.num(count('planned'))} />
            <Stat label={t('enum.operationStatus.in_progress')} value={fmt.num(count('in_progress'))} />
            <Stat label={t('enum.operationStatus.completed')} value={fmt.num(count('completed'))} tone="success" />
          </div>
          <Card padded={false} title={t('cultivation.ops.actualTitle')} description={t('cultivation.ops.actualDescription')}>
            {isLoading ? <div className="p-4"><Loading /></div> : <OperationsTable operations={operations} showFields={false} emptyText={t('cultivation.ops.actualEmpty')} />}
          </Card>
        </>
      )}

      {applyOpen && <ApplyTemplateDialog cycle={cycle} onClose={() => setApplyOpen(false)} />}
    </div>
  )
}

/** Target date of a template step for this crop, or null while its anchor date is unknown. */
function targetDate(step: TemplateStep, cycle: CropCycle, seasonStart: string | null) {
  const anchor = step.anchor === 'sowing' ? cycle.sowingDate : step.anchor === 'harvest' ? cycle.expectedHarvestDate : seasonStart
  return anchor ? addDays(anchor, step.offsetDays) : null
}

function PlanView({ cycle, operations, onApply }: { cycle: CropCycle; operations: Operation[]; onApply?: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasons } = useSeason()
  const template = useOrgQuery<CultivationTemplate>(cycle.templateId ? `/templates/${cycle.templateId}` : null)
  const seasonStart = seasons.find((s) => s.id === cycle.seasonId)?.startDate ?? null

  if (!cycle.templateId) {
    return (
      <Card>
        <EmptyState icon={ListChecks} title={t('cultivation.ops.planEmpty.title')} action={onApply && <Button variant="primary" onPress={onApply}><ListChecks /> {t('templates.apply.action')}</Button>}>
          {t('cultivation.ops.planEmpty.description')}
        </EmptyState>
      </Card>
    )
  }
  if (template.isLoading) return <Loading />
  const steps = template.data?.steps ?? []
  const byStep = new Map(operations.filter((o) => o.templateStepId).map((o) => [o.templateStepId!, o]))
  const realized = steps.filter((s) => byStep.get(s.id)?.status === 'completed').length

  return (
    <Card
      padded={false}
      title={t('cultivation.ops.planTitle', { name: template.data?.name ?? cycle.templateName })}
      description={t('cultivation.ops.planProgress', { done: realized, count: steps.length })}
    >
      <Table aria-label={t('cultivation.ops.plan')}>
        <TableHeader>
          <Column isRowHeader>{t('cultivation.ops.step')}</Column>
          <Column>{t('cultivation.ops.targetDate')}</Column>
          <Column>{t('operations.products')}</Column>
          <Column>{t('cultivation.ops.realization')}</Column>
        </TableHeader>
        <TableBody items={steps} renderEmptyState={() => <div className="py-10 text-center text-sm text-muted">{t('cultivation.ops.planNoSteps')}</div>}>
          {(s) => {
            const op = byStep.get(s.id)
            const date = targetDate(s, cycle, seasonStart)
            return (
              <Row id={s.id} href={op ? `/o/${orgId}/operations/${op.id}` : undefined}>
                <Cell>
                  <div className="flex items-center gap-2.5">
                    <OperationTypeLabel type={s.type} iconOnly />
                    <div className="min-w-0">
                      <div className="font-medium">{s.title}</div>
                      {s.bbchStage && <div className="text-xs text-muted">BBCH {s.bbchStage}</div>}
                    </div>
                  </div>
                </Cell>
                <Cell className="whitespace-nowrap">
                  <div className="tabular">{date ? fmt.date(date) : <span className="text-muted" title={t('cultivation.ops.anchorMissing')}>—</span>}</div>
                  <div className="text-xs text-muted">{templateStepTiming(s.anchor, s.offsetDays)}</div>
                </Cell>
                <Cell>
                  {s.inputs.length ? (
                    <div className="space-y-0.5 text-fg-2">
                      {s.inputs.map((i) => (
                        <div key={i.productId} className="min-w-40">{i.productName} <span className="text-muted tabular whitespace-nowrap">· {fmt.qty(i.ratePerHa, i.baseUnit)}/ha</span></div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Cell>
                <Cell>
                  {op ? (
                    <div className="space-y-0.5">
                      <OperationStatusBadge status={op.status} />
                      <div className="text-xs text-muted tabular">{op.performedAt ? fmt.date(op.performedAt) : fmt.date(op.plannedOn)}</div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted">{t('cultivation.ops.notPlanned')}</span>
                  )}
                </Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
    </Card>
  )
}
