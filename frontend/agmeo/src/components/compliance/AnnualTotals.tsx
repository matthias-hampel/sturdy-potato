import type { AnnualTotals, FieldAnnualTotals, NutrientGroup, NutrientGroupTotals } from '@agmeo/contracts'
import { AlertTriangle, Calculator, Layers, Leaf, Printer, Sprout } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, Stat } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { GroupTriple, Kg, NUTRIENT_GROUPS, nutrientGroupLabel } from './shared'

/** Annual nutrient totals of a farm (DüV Anlage 5): farm totals by group and the per-field table. */
export function AnnualTotalsTab({ farmId, year }: { farmId: string; year: number }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const totals = useOrgQuery<AnnualTotals>('/regulatory/annual-totals', { farmId, year })
  if (totals.isLoading) return <Loading />
  if (totals.error) return <ErrorNotice error={totals.error} />
  const d = totals.data
  if (!d) return null
  const perHa = (kg: number) => (d.farm.areaHa ? kg / d.farm.areaHa : null)
  const organicN = d.farm.manure.n + d.farm.other_organic.n

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('regulatory.annual.window', { from: fmt.date(d.window.from), to: fmt.date(d.window.to) })}</p>
        <Link to="/o/$orgId/compliance/report" params={{ orgId }} search={{ farmId, year }} variant="secondary">
          <Printer /> {t('regulatory.report.open')}
        </Link>
      </div>

      {d.unknownApplications > 0 && (
        <Notice tone="warning" icon={AlertTriangle}>
          {t('regulatory.annual.unknownApplications', { count: d.unknownApplications })}
        </Notice>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={Layers} label={t('regulatory.annual.area')} value={fmt.ha(d.farm.areaHa)} hint={t('regulatory.annual.fieldCount', { count: d.fields.length })} />
        <Stat icon={Leaf} label={t('regulatory.annual.nTotal')} value={fmt.qty(d.farm.total.n, 'kg N')} hint={t('regulatory.annual.perHaHint', { value: fmt.num(perHa(d.farm.total.n)) })} />
        <Stat
          icon={Calculator}
          label={t('regulatory.annual.availableN')}
          value={fmt.qty(d.farm.total.availableN, 'kg N')}
          hint={t('regulatory.annual.perHaHint', { value: fmt.num(perHa(d.farm.total.availableN)) })}
        />
        <Stat icon={Sprout} label={t('regulatory.annual.organicN')} value={fmt.qty(organicN, 'kg N')} hint={t('regulatory.annual.perHaHint', { value: fmt.num(perHa(organicN)) })} />
      </div>

      <FarmTotalsCard totals={d} />

      <Card title={t('regulatory.annual.fields.title')} description={t('regulatory.annual.fields.description')} padded={false}>
        <FieldTotalsTable fields={d.fields} />
      </Card>
    </div>
  )
}

/** Farm totals by group, in kg and kg/ha. Also used in the printed report. */
export function FarmTotalsCard({ totals }: { totals: AnnualTotals }) {
  const { t } = useTranslation()
  const rows: { id: NutrientGroup | 'total'; value: NutrientGroupTotals }[] = [
    ...NUTRIENT_GROUPS.map((g) => ({ id: g, value: totals.farm[g] })),
    { id: 'total' as const, value: totals.farm.total },
  ]
  const perHa = (kg: number) => (totals.farm.areaHa ? kg / totals.farm.areaHa : null)
  return (
    <Card title={t('regulatory.annual.farm.title')} description={t('regulatory.annual.farm.description', { area: fmt.ha(totals.farm.areaHa) })} padded={false}>
      <Table aria-label={t('regulatory.annual.farm.title')}>
        <TableHeader>
          <Column isRowHeader>{t('regulatory.annual.col.group')}</Column>
          <Column align="end">{t('regulatory.annual.col.nKg')}</Column>
          <Column align="end">{t('regulatory.annual.col.nKgHa')}</Column>
          <Column align="end">{t('regulatory.annual.col.availableNKg')}</Column>
          <Column align="end">{t('regulatory.annual.col.availableNKgHa')}</Column>
          <Column align="end">{t('regulatory.annual.col.p2o5Kg')}</Column>
          <Column align="end">{t('regulatory.annual.col.p2o5KgHa')}</Column>
        </TableHeader>
        <TableBody items={rows}>
          {(r) => (
            <Row id={r.id} className={r.id === 'total' ? 'font-semibold' : undefined}>
              <Cell>{nutrientGroupLabel(r.id)}</Cell>
              <Cell align="end">
                <Kg value={r.value.n} />
              </Cell>
              <Cell align="end">
                <Kg value={perHa(r.value.n)} />
              </Cell>
              <Cell align="end">
                <Kg value={r.value.availableN} />
              </Cell>
              <Cell align="end">
                <Kg value={perHa(r.value.availableN)} />
              </Cell>
              <Cell align="end">
                <Kg value={r.value.p2o5} />
              </Cell>
              <Cell align="end">
                <Kg value={perHa(r.value.p2o5)} />
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

/** Per-field totals: each group as "N · N verfügbar · P₂O₅" in kg/ha, plus the N need. */
export function FieldTotalsTable({ fields }: { fields: FieldAnnualTotals[] }) {
  const { t } = useTranslation()
  return (
    <>
      <Table aria-label={t('regulatory.annual.fields.title')}>
        <TableHeader>
          <Column isRowHeader>{t('crops.plan.field')}</Column>
          <Column align="end">{t('crops.plan.area')}</Column>
          {NUTRIENT_GROUPS.map((g) => (
            <Column key={g} align="end">
              {nutrientGroupLabel(g)}
            </Column>
          ))}
          <Column align="end">{nutrientGroupLabel('total')}</Column>
          <Column align="end">{t('nutrients.col.nNeed')}</Column>
        </TableHeader>
        <TableBody
          items={fields.map((f) => ({ ...f, id: f.fieldId }))}
          renderEmptyState={() => <EmptyState icon={Layers} title={t('regulatory.annual.fields.empty')} />}
        >
          {(f) => (
            <Row id={f.id}>
              <Cell>
                <span className="font-medium">{f.fieldName}</span>
                {f.grassland && (
                  <Badge tone="success" className="ml-2">
                    {t('regulatory.annual.grassland')}
                  </Badge>
                )}
              </Cell>
              <Cell align="end">{fmt.ha(f.areaHa)}</Cell>
              {NUTRIENT_GROUPS.map((g) => (
                <Cell key={g} align="end">
                  <GroupTriple value={f.perHa[g]} />
                </Cell>
              ))}
              <Cell align="end">
                <GroupTriple value={f.total} className="font-medium" />
              </Cell>
              <Cell align="end">
                <Kg value={f.nNeed} />
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      <p className="px-4 py-3 border-t border-line text-xs text-muted">{t('regulatory.annual.fields.legend')}</p>
    </>
  )
}
