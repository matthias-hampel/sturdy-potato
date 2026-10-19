import type { SoilHistoryState, SoilLabImport } from '@agmeo/contracts'
import { Download, History } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

/**
 * Zone-map history of several fields (reference: HistoryCompareModal): past states by run or by
 * end of day, compared with today's zone maps, and restored together.
 */
export function HistoryStatesDialog({ fieldIds, isOpen, onOpenChange }: { fieldIds: string[]; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const [grouping, setGrouping] = useState<'day' | 'batch'>('day')
  const [target, setTarget] = useState<SoilHistoryState | null>(null)
  const states = useOrgQuery<SoilHistoryState[]>(isOpen && fieldIds.length ? '/soil/history/states' : null, { fieldIds: fieldIds.join(',') })
  const restore = useOrgMutation((base, ids: string[]) => api.post<{ restored: number }>(`${base}/soil/history/restore`, { zonationIds: ids }), {
    success: (r) => t('soil.history.bulk.restored', { count: r.restored }),
    onSuccess: () => setTarget(null),
  })
  const shown = (states.data ?? []).filter((s) => s.kind === grouping)

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setTarget(null)
        onOpenChange(open)
      }}
      size="lg"
      title={target ? t('soil.history.bulk.confirmTitle') : t('soil.history.bulk.title')}
      footer={(close) =>
        target ? (
          <>
            <Button onPress={() => setTarget(null)}>{t('common.back')}</Button>
            <Button variant="primary" isPending={restore.isPending} onPress={() => restore.mutate(target.fields.map((f) => f.zonationId))}>
              {t('soil.history.bulk.restore')}
            </Button>
          </>
        ) : (
          <Button onPress={close}>{t('common.close')}</Button>
        )
      }
    >
      {target ? (
        <div className="space-y-2 text-sm">
          <p>{t('soil.history.bulk.confirmBody')}</p>
          <p className="font-medium">
            {fmt.dateTime(target.at)} — {t('soil.history.bulk.willChange', { count: target.willChange })}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <SegmentedControl
            aria-label={t('soil.history.bulk.groupBy')}
            value={grouping}
            onChange={setGrouping}
            items={[
              { id: 'day', label: t('soil.history.bulk.groupByDay') },
              { id: 'batch', label: t('soil.history.bulk.groupByBatch') },
            ]}
          />
          {states.isLoading ? (
            <Loading />
          ) : states.error ? (
            <ErrorNotice error={states.error} />
          ) : !shown.length ? (
            <Notice tone="info">{t('soil.history.bulk.noBatches')}</Notice>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {shown.map((s) => (
                <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{grouping === 'day' ? fmt.date(s.at.slice(0, 10)) : fmt.dateTime(s.at)}</span>
                    <span className="block text-xs text-muted">
                      {t('soil.history.bulk.willChange', { count: s.willChange })} · {t('soil.history.bulk.unchanged', { count: s.unchanged })} · {t('soil.history.bulk.noZonation', { count: s.noZonation })}
                    </span>
                  </div>
                  <Button size="sm" isDisabled={!s.willChange} onPress={() => setTarget(s)}>
                    {t('soil.history.bulk.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ModalDialog>
  )
}

/** Lab imports with their archived files (reference: lab upload history). */
export function LabImports() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const imports = useOrgQuery<SoilLabImport[]>('/soil/lab-imports')
  if (imports.isLoading) return <Loading />
  if (imports.error) return <ErrorNotice error={imports.error} />
  if (!imports.data?.length)
    return (
      <Card>
        <EmptyState icon={History} title={t('soil.imports.empty')}>
          {t('soil.imports.emptyBody')}
        </EmptyState>
      </Card>
    )
  return (
    <Card padded={false}>
      <Table aria-label={t('soil.imports.title')}>
        <TableHeader>
          <Column isRowHeader>{t('soil.imports.date')}</Column>
          <Column>{t('soil.imports.files')}</Column>
          <Column>{t('soil.imports.fields')}</Column>
          <Column align="end">{t('soil.imports.zones')}</Column>
          <Column>{t('soil.page.col.sampledOn')}</Column>
        </TableHeader>
        <TableBody items={imports.data}>
          {(i) => (
            <Row id={i.id}>
              <Cell>
                {fmt.dateTime(i.createdAt)}
                {i.createdByName && <span className="block text-xs text-muted">{i.createdByName}</span>}
              </Cell>
              <Cell>
                <div className="flex flex-col items-start gap-1">
                  {i.files.length
                    ? i.files.map((f) => (
                        <Button key={f.id} size="sm" variant="quiet" onPress={() => api.download(`/orgs/${orgId}/files/${f.id}/content`, undefined, f.name)}>
                          <Download /> {f.name}
                        </Button>
                      ))
                    : i.fileNames.join(', ')}
                </div>
              </Cell>
              <Cell>{i.fields.map((f) => f.name).join(', ')}</Cell>
              <Cell align="end">{i.zoneCount}</Cell>
              <Cell>{fmt.date(i.sampledOn)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
