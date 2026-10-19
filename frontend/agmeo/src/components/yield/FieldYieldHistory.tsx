import type { Field, YieldHistoryEntry } from '@agmeo/contracts'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColumnChart } from '#/components/charts'
import { CropTag } from '#/components/labels'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { fmtYield } from './shared'

/** The field's yield over the years: the merged map's mean next to the documented yield. */
export function FieldYieldHistory({ field }: { field: Field }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const history = useOrgQuery<YieldHistoryEntry[]>(`/yield-maps/fields/${field.id}/history`)
  if (history.isLoading) return <Loading />
  if (history.error) return <ErrorNotice error={history.error} />
  const rows = history.data ?? []
  if (!rows.length) {
    return (
      <Card>
        <EmptyState title={t('yield.history.empty.title')}>{t('yield.history.empty.description')}</EmptyState>
      </Card>
    )
  }
  const chronological = [...rows].reverse()
  return (
    <div className="space-y-6">
      <Card title={t('yield.history.title')} description={t('yield.history.description')}>
        <ColumnChart
          ariaLabel={t('yield.history.title')}
          series={[
            { name: t('yield.history.map'), color: 'var(--color-series-1)' },
            { name: t('yield.history.documented'), color: 'var(--color-series-2)' },
          ]}
          format={(v) => fmtYield(v)}
          data={chronological.map((r) => ({
            key: r.cropCycleId,
            label: `${r.harvestYear}`,
            values: [r.mapMeanTHa, r.documentedYieldTHa],
            tooltip: (
              <span>
                {r.harvestYear} · {r.cropName}: {fmtYield(r.mapMeanTHa)} / {fmtYield(r.documentedYieldTHa)}
              </span>
            ),
          }))}
        />
      </Card>
      <Card padded={false}>
        <Table aria-label={t('yield.history.title')}>
          <TableHeader>
            <Column isRowHeader>{t('yield.history.year')}</Column>
            <Column>{t('yield.overview.crop')}</Column>
            <Column align="end">{t('yield.history.map')}</Column>
            <Column align="end">{t('yield.history.documented')}</Column>
            <Column>{''}</Column>
          </TableHeader>
          <TableBody items={rows.map((r) => ({ ...r, id: r.cropCycleId }))}>
            {(r) => (
              <Row id={r.cropCycleId}>
                <Cell className="tabular">{r.harvestYear}</Cell>
                <Cell>
                  <CropTag name={r.cropName} />
                </Cell>
                <Cell align="end">{fmtYield(r.mapMeanTHa, 2)}</Cell>
                <Cell align="end">{fmtYield(r.documentedYieldTHa, 2)}</Cell>
                <Cell>
                  <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: r.cropCycleId }} search={{ tab: 'yield' }} variant="ghost" size="sm" aria-label={t('yield.overview.open')}>
                    <ChevronRight />
                  </Link>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
