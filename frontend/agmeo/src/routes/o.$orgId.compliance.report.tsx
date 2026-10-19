import {
  type AnnualTotals,
  type CropCycle,
  FEDERAL_STATE_NAMES,
  FERTILIZER_YEAR_STARTS,
  type Farm,
  type FarmRegulatory,
  type FertilizerNeedRecord,
  type FieldAnnualTotals,
  type N170Balance,
  type NutrientGroupTotals,
  type Operation,
  type SeasonNutrientBalance,
} from '@agmeo/contracts'
import { useQueries } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, FileText, Printer } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PrintLogo } from '#/components/OrgLogo'
import { z } from 'zod'
import { monthLabel, NUTRIENT_GROUPS, nutrientGroupLabel, useDefaultYear } from '#/components/compliance/shared'
import { NLedger, PkTable } from '#/components/nutrients/FertilizerNeedDialog'
import { cropRoleLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/compliance/report')({
  validateSearch: z.object({ farmId: z.string().optional(), year: z.number().int().optional() }),
  component: ReportPage,
})

/**
 * The sheet always uses the light tokens, like paper, and in print it is the only thing on the
 * page: the app is hidden and the sheet's portal copy is shown on A4.
 */
const SHEET_STYLE = `
.duev-sheet {
  --color-surface: #fff; --color-surface-2: #f3f3f1; --color-line: #d4d4d0; --color-line-strong: #a8a8a2;
  --color-fg: #111; --color-fg-2: #333; --color-muted: #666;
  --color-primary: #2f5a24; --color-primary-soft: #e8efe3; --color-success: #2f6a2c; --color-success-soft: #e3efe0;
  --color-danger: #a12d22; --color-danger-soft: #f6e0dc; --color-warning: #8a5508; --color-warning-soft: #f6ead3;
  --color-info: #2a5a80; --color-info-soft: #dfe9f1;
  background: #fff; color: #111;
}
.duev-sheet h2, .duev-sheet h3 { break-after: avoid; }
.duev-sheet table { break-inside: auto; }
.duev-sheet tr { break-inside: avoid; }
@media print {
  @page { size: A4; margin: 14mm 12mm 16mm; }
  body > :not(.agmeo-print) { display: none !important; }
  .duev-field { break-inside: avoid-page; }
  .duev-appendix { break-before: page; }
}`

const table = 'w-full border-collapse text-xs [&_th]:border [&_th]:border-line-strong [&_th]:bg-surface-2 [&_th]:px-1.5 [&_th]:py-1 [&_th]:font-medium [&_th]:text-left [&_td]:border [&_td]:border-line-strong [&_td]:px-1.5 [&_td]:py-1'
const num = 'text-right tabular whitespace-nowrap'

interface ReportData {
  farm: FarmRegulatory
  totals: AnnualTotals
  n170: N170Balance
  cycles: CropCycle[]
  balance: SeasonNutrientBalance | undefined
  records: Map<string, FertilizerNeedRecord[]>
  operations: Map<string, Operation[]>
  pending: boolean
}

function ReportPage() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasons } = useSeason()
  const search = Route.useSearch()
  const defaultYear = useDefaultYear()
  const year = search.year ?? defaultYear
  const farms = useOrgQuery<Farm[]>('/farms')
  const active = (farms.data ?? []).filter((f) => !f.archivedAt)
  const farmId = active.some((f) => f.id === search.farmId) ? search.farmId : active[0]?.id
  const data = useReportData(farmId, year, seasons.find((s) => s.harvestYear === year)?.id)
  const [printing, setPrinting] = useState(false)

  // Print once the portal copy has rendered.
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done, { once: true })
    const id = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/o/$orgId/compliance" params={{ orgId }} search={{ tab: 'annual', farmId, year: search.year }} className="inline-flex items-center gap-1 normal-case tracking-normal">
            <ArrowLeft className="size-3.5" aria-hidden /> {t('compliance.title')}
          </Link>
        }
        title={t('regulatory.report.title', { year })}
        subtitle={data.data ? data.data.farm.farmName : undefined}
        actions={
          <Button variant="primary" onPress={() => setPrinting(true)} isDisabled={!data.data || data.data.pending}>
            <Printer /> {t('fertilizerNeed.print')}
          </Button>
        }
      />
      <style>{SHEET_STYLE}</style>
      {farms.isLoading || data.isLoading ? (
        <Loading />
      ) : farms.error || data.error ? (
        <ErrorNotice error={farms.error ?? data.error} />
      ) : !farmId ? (
        <EmptyState icon={FileText} title={t('fields.new.noFarm.title')}>
          {t('regulatory.noFarm')}
        </EmptyState>
      ) : data.data ? (
        <>
          <div className="duev-sheet mx-auto max-w-[210mm] rounded-sm border border-line shadow-sm p-[12mm] text-sm">
            <DuevReport data={data.data} />
          </div>
          {createPortal(
            <div className="agmeo-print duev-sheet hidden print:block text-sm">
              <DuevReport data={data.data} />
            </div>,
            document.body,
          )}
        </>
      ) : null}
    </>
  )
}

/** Everything the report shows: farm data, totals, 170 N, crops, need records and applications per field. */
function useReportData(farmId: string | undefined, year: number, seasonId: string | undefined) {
  const { orgId } = useOrg()
  const enabled = !!farmId
  const farm = useOrgQuery<FarmRegulatory>(farmId ? `/farms/${farmId}/regulatory` : null)
  const totals = useOrgQuery<AnnualTotals>('/regulatory/annual-totals', { farmId, year }, { enabled })
  const n170 = useOrgQuery<N170Balance>('/regulatory/n170', { farmId, year }, { enabled })
  const allCycles = useOrgQuery<CropCycle[]>('/crop-cycles', { farmId }, { enabled })
  const balance = useOrgQuery<SeasonNutrientBalance>('/nutrients/season', { seasonId }, { enabled: !!seasonId })
  const cycles = (allCycles.data ?? []).filter((c) => c.harvestYear === year)
  const period = totals.data?.window

  // Same query keys as useOrgQuery, so the cache is shared with the rest of the app.
  const records = useQueries({
    queries: cycles.map((c) => {
      const path = `/crop-cycles/${c.id}/fertilizer-need/records`
      return { queryKey: ['org', orgId, path, {}], queryFn: () => api.get<FertilizerNeedRecord[]>(`/orgs/${orgId}${path}`), staleTime: 15_000 }
    }),
  })
  const operations = useQueries({
    queries: (totals.data?.fields ?? []).map((f) => {
      const query = { fieldId: f.fieldId, type: 'fertilization', status: 'completed', from: period?.from, to: period?.to }
      return { queryKey: ['org', orgId, '/operations', query], queryFn: () => api.get<Operation[]>(`/orgs/${orgId}/operations`, query), staleTime: 15_000 }
    }),
  })

  const base = [farm, totals, n170, allCycles]
  const isLoading = base.some((q) => q.isLoading)
  const error = base.find((q) => q.error)?.error ?? null
  const data: ReportData | null =
    farm.data && totals.data && n170.data && allCycles.data
      ? {
          farm: farm.data,
          totals: totals.data,
          n170: n170.data,
          cycles,
          balance: balance.data,
          records: new Map(cycles.map((c, i) => [c.id, records[i]?.data ?? []])),
          operations: new Map(totals.data.fields.map((f, i) => [f.fieldId, operations[i]?.data ?? []])),
          pending: balance.isLoading || records.some((q) => q.isLoading) || operations.some((q) => q.isLoading),
        }
      : null
  return { data, isLoading, error }
}

function DuevReport({ data }: { data: ReportData }) {
  const { t } = useTranslation()
  const { farm, totals } = data
  const contact = farm.contact
  const person = [contact.vorname, contact.nachname].filter(Boolean).join(' ')
  const place = [contact.plz, contact.ort].filter(Boolean).join(' ')
  const master: [ReactNode, ReactNode][] = [
    [t('regulatory.report.farm'), farm.farmName],
    [t('regulatory.farm.holdingNumber'), farm.holdingNumber],
    [t('regulatory.farm.federalState'), farm.federalState ? FEDERAL_STATE_NAMES[farm.federalState] : null],
    [t('regulatory.farm.fertilizerYearStart'), monthLabel(FERTILIZER_YEAR_STARTS.indexOf(farm.fertilizerYearStart))],
    [t('regulatory.farm.organicCertified'), farm.organicCertified ? t('common.yes') : t('common.no')],
    [t('regulatory.report.area'), fmt.ha(totals.farm.areaHa)],
    ...(farm.enni.soilClimateArea ? ([[t('regulatory.farm.enni.soilClimateArea'), farm.enni.soilClimateArea.replace('_', ' ')]] as [ReactNode, ReactNode][]) : []),
    ...(farm.endo.naturalRegion ? ([[t('regulatory.farm.endo.naturalRegion'), farm.endo.naturalRegion]] as [ReactNode, ReactNode][]) : []),
    [
      t('regulatory.farm.contact.title'),
      [contact.firma, person, contact.strasse, place, contact.telefonnummer, contact.email].filter(Boolean).join(' · ') || null,
    ],
  ]
  const fields = [...totals.fields].sort((a, b) => a.fieldName.localeCompare(b.fieldName))

  return (
    <div className="text-fg">
      <header className="border-b-2 border-fg pb-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('regulatory.report.title', { year: totals.year })}</h1>
          <p className="text-xs text-muted mt-0.5">
            {t('regulatory.report.meta', { from: fmt.date(totals.window.from), to: fmt.date(totals.window.to), date: fmt.dateTime(new Date().toISOString()) })}
          </p>
        </div>
        <PrintLogo />
      </header>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {master.map(([label, value], i) => (
          <div key={i} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {fields.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{t('regulatory.annual.fields.empty')}</p>
      ) : (
        fields.map((f) => <FieldSection key={f.fieldId} field={f} data={data} />)
      )}

      <section className="duev-appendix mt-10">
        <h2 className="text-base font-semibold border-b border-fg pb-1">{t('regulatory.report.appendix')}</h2>
        <h3 className="font-semibold mt-4 mb-1.5 text-sm">{t('regulatory.annual.farm.title')}</h3>
        <FarmTotalsTable totals={totals} />
        {totals.unknownApplications > 0 && <p className="mt-1.5 text-xs">{t('regulatory.annual.unknownApplications', { count: totals.unknownApplications })}</p>}
        <h3 className="font-semibold mt-6 mb-1.5 text-sm">{t('regulatory.n170.title')}</h3>
        <N170Table balance={data.n170} />
      </section>

      <div className="mt-16 grid grid-cols-2 gap-12 text-xs text-muted">
        <div className="border-t border-line-strong pt-1">{t('fertilizerNeed.printPlaceDate')}</div>
        <div className="border-t border-line-strong pt-1">{t('fertilizerNeed.printSignature')}</div>
      </div>
    </div>
  )
}

function FieldSection({ field, data }: { field: FieldAnnualTotals; data: ReportData }) {
  const { t } = useTranslation()
  const cycles = data.cycles.filter((c) => c.fieldId === field.fieldId)
  const ops = (data.operations.get(field.fieldId) ?? []).slice().sort((a, b) => (a.performedAt ?? '').localeCompare(b.performedAt ?? ''))
  const lines = ops.flatMap((op) => op.inputs.filter((i) => i.category === 'fertilizer' || i.nutrients).map((i) => ({ op, input: i })))
  const balanceOf = (cycleId: string) => data.balance?.rows.find((r) => r.cropCycleId === cycleId)

  return (
    <section className="duev-field mt-8">
      <h2 className="text-base font-semibold border-b border-fg pb-1 flex items-baseline gap-2">
        {field.fieldName}
        <span className="text-xs font-normal text-muted">
          {fmt.ha(field.areaHa)}
          {field.grassland && ` · ${t('regulatory.annual.grassland')}`}
        </span>
      </h2>

      <h3 className="font-semibold mt-3 mb-1.5 text-sm">{t('regulatory.report.crops')}</h3>
      {cycles.length === 0 ? (
        <p className="text-xs text-muted">{t('regulatory.report.noCrops')}</p>
      ) : (
        <table className={table}>
          <thead>
            <tr>
              <th>{t('crops.plan.crop')}</th>
              <th>{t('regulatory.report.role')}</th>
              <th>{t('crops.plan.sown')}</th>
              <th className={num}>{t('crops.plan.area')}</th>
              <th className={num}>{t('nutrients.col.nNeed')}</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => {
              const b = balanceOf(c.id)
              return (
                <tr key={c.id}>
                  <td>
                    {c.cropName}
                    {c.fieldPartName && <span className="text-muted"> · {c.fieldPartName}</span>}
                  </td>
                  <td>{cropRoleLabel(c.role)}</td>
                  <td className="tabular">{fmt.date(c.sowingDate)}</td>
                  <td className={num}>{fmt.ha(c.areaHa)}</td>
                  <td className={num}>{b?.nNeed != null ? `${fmt.num(b.nNeed)} kg N/ha` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {cycles.map((c) => (
        <NeedRecord key={c.id} cycle={c} records={data.records.get(c.id) ?? []} />
      ))}

      <h3 className="font-semibold mt-4 mb-1.5 text-sm">{t('regulatory.report.applications')}</h3>
      {lines.length === 0 ? (
        <p className="text-xs text-muted">{t('regulatory.report.noApplications')}</p>
      ) : (
        <table className={table}>
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('operations.product')}</th>
              <th className={num}>{t('operations.rate')}</th>
              <th className={num}>N kg/ha</th>
              <th className={num}>NH₄-N kg/ha</th>
              <th className={num}>P₂O₅ kg/ha</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ op, input }) => (
              <tr key={input.id}>
                <td className="tabular whitespace-nowrap">{fmt.date(op.performedAt)}</td>
                <td>
                  {input.productName}
                  {input.densityAssumed && <span className="text-muted"> ({t('regulatory.report.densityAssumed')})</span>}
                </td>
                <td className={num}>{input.ratePerHa != null ? `${fmt.qty(input.ratePerHa, input.baseUnit)}/ha` : '—'}</td>
                <td className={num}>{fmt.num(input.nutrients?.n, 1)}</td>
                <td className={num}>{fmt.num(input.nutrients?.nh4N, 1)}</td>
                <td className={num}>{fmt.num(input.nutrients?.p2o5, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="font-semibold mt-4 mb-1.5 text-sm">{t('regulatory.report.fieldTotals')}</h3>
      <GroupTable rows={[...NUTRIENT_GROUPS.map((g) => ({ label: nutrientGroupLabel(g), value: field.perHa[g] })), { label: nutrientGroupLabel('total'), value: field.total, strong: true }]} unit="kg/ha" />
      <p className="mt-1 text-xs">
        {t('nutrients.col.nNeed')}: {field.nNeed != null ? `${fmt.num(field.nNeed)} kg N/ha` : '—'}
      </p>
    </section>
  )
}

/** The latest saved fertilizer need of a crop: the N ledger and the P/K need. */
function NeedRecord({ cycle, records }: { cycle: CropCycle; records: FertilizerNeedRecord[] }) {
  const { t } = useTranslation()
  // Records come newest first.
  const nRecord = records.find((r) => r.result.n)
  const pkRecord = records.find((r) => r.result.pk.length > 0)
  const meta = (title: string, record: FertilizerNeedRecord | undefined) =>
    record ? `${title} · ${t('regulatory.report.recordMeta', { date: fmt.date(record.createdAt), name: record.createdBy ?? t('common.unknown'), ruleset: record.ruleset })}` : title
  return (
    <div className="mt-4">
      <h3 className="font-semibold mb-1.5 text-sm">{t('regulatory.report.need', { crop: cycle.cropName })}</h3>
      {!nRecord && !pkRecord ? (
        <p className="text-xs text-muted">{t('regulatory.report.noNeedRecord')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-xs text-muted mb-1">{meta(t('fertilizerNeed.n.title'), nRecord)}</div>
            {nRecord?.result.n ? (
              <div className="border border-line-strong text-xs">
                <NLedger n={nRecord.result.n} need={nRecord} />
              </div>
            ) : (
              <p className="text-xs text-muted">{t('fertilizerNeed.n.none')}</p>
            )}
          </div>
          <div>
            <div className="text-xs text-muted mb-1">{meta(t('fertilizerNeed.pk.title'), pkRecord)}</div>
            {pkRecord ? (
              <div className="border border-line-strong text-xs">
                <PkTable rows={pkRecord.result.pk} />
              </div>
            ) : (
              <p className="text-xs text-muted">{t('fertilizerNeed.pk.none')}</p>
            )}
          </div>
        </div>
      )}
      {nRecord?.note && <p className="mt-1 text-xs">{nRecord.note}</p>}
    </div>
  )
}

function GroupTable({ rows, unit }: { rows: { label: string; value: NutrientGroupTotals; strong?: boolean }[]; unit: string }) {
  const { t } = useTranslation()
  return (
    <table className={table}>
      <thead>
        <tr>
          <th>{t('regulatory.annual.col.group')}</th>
          <th className={num}>{t('regulatory.report.nTotal', { unit })}</th>
          <th className={num}>{t('regulatory.report.availableN', { unit })}</th>
          <th className={num}>{t('regulatory.report.p2o5', { unit })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={cx(r.strong && 'font-semibold')}>
            <td>{r.label}</td>
            <td className={num}>{fmt.num(r.value.n)}</td>
            <td className={num}>{fmt.num(r.value.availableN)}</td>
            <td className={num}>{fmt.num(r.value.p2o5)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FarmTotalsTable({ totals }: { totals: AnnualTotals }) {
  const { t } = useTranslation()
  const perHa = (kg: number) => (totals.farm.areaHa ? kg / totals.farm.areaHa : null)
  const rows = [...NUTRIENT_GROUPS.map((g) => ({ id: g, value: totals.farm[g] })), { id: 'total' as const, value: totals.farm.total }]
  return (
    <table className={table}>
      <thead>
        <tr>
          <th>{t('regulatory.annual.col.group')}</th>
          <th className={num}>{t('regulatory.annual.col.nKg')}</th>
          <th className={num}>{t('regulatory.annual.col.nKgHa')}</th>
          <th className={num}>{t('regulatory.annual.col.availableNKg')}</th>
          <th className={num}>{t('regulatory.annual.col.availableNKgHa')}</th>
          <th className={num}>{t('regulatory.annual.col.p2o5Kg')}</th>
          <th className={num}>{t('regulatory.annual.col.p2o5KgHa')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={cx(r.id === 'total' && 'font-semibold')}>
            <td>{nutrientGroupLabel(r.id)}</td>
            <td className={num}>{fmt.num(r.value.n)}</td>
            <td className={num}>{fmt.num(perHa(r.value.n))}</td>
            <td className={num}>{fmt.num(r.value.availableN)}</td>
            <td className={num}>{fmt.num(perHa(r.value.availableN))}</td>
            <td className={num}>{fmt.num(r.value.p2o5)}</td>
            <td className={num}>{fmt.num(perHa(r.value.p2o5))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function N170Table({ balance }: { balance: N170Balance }) {
  const { t } = useTranslation()
  const d = balance.data
  return (
    <>
      <table className={table}>
        <tbody>
          <tr>
            <td>{t('regulatory.n170.applied')}</td>
            <td className={num}>{fmt.qty(balance.appliedOrganicN, 'kg N')}</td>
          </tr>
          <tr>
            <td>{t('regulatory.n170.livestock')}</td>
            <td className={num}>{fmt.qty(balance.livestockN, 'kg N')}</td>
          </tr>
          <tr>
            <td>{t('regulatory.n170.intake')}</td>
            <td className={num}>{fmt.qty(balance.intakeN, 'kg N')}</td>
          </tr>
          <tr>
            <td>{t('regulatory.n170.delivery')}</td>
            <td className={num}>{fmt.qty(balance.deliveryN, 'kg N')}</td>
          </tr>
          <tr>
            <td>{t('regulatory.report.area')}</td>
            <td className={num}>{fmt.ha(balance.areaHa)}</td>
          </tr>
          <tr className="font-semibold">
            <td>{t('regulatory.n170.perHa')}</td>
            <td className={num}>
              {fmt.num(balance.perHa, 1)} / {balance.limit} kg N/ha · {balance.exceeded ? t('regulatory.n170.exceeded') : t('regulatory.n170.within')}
            </td>
          </tr>
        </tbody>
      </table>
      {d.livestock.length > 0 && (
        <table className={cx(table, 'mt-3')}>
          <thead>
            <tr>
              <th>{t('regulatory.n170.livestock.name')}</th>
              <th className={num}>{t('regulatory.n170.livestock.animals')}</th>
              <th className={num}>{t('regulatory.n170.livestock.nPerAnimal')}</th>
              <th className={num}>{t('regulatory.n170.livestock.grazingDays')}</th>
            </tr>
          </thead>
          <tbody>
            {d.livestock.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className={num}>{fmt.num(l.animals, 1)}</td>
                <td className={num}>{fmt.num(l.nPerAnimalYear, 1)} kg N</td>
                <td className={num}>{fmt.num(l.grazingDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(['intake', 'delivery'] as const).map((kind) =>
        d[kind].length > 0 ? (
          <table key={kind} className={cx(table, 'mt-3')}>
            <thead>
              <tr>
                <th>{t(`regulatory.n170.${kind}.title`)}</th>
                <th>{t('common.date')}</th>
                <th>{t(`regulatory.n170.transfer.${kind === 'intake' ? 'from' : 'to'}`)}</th>
                <th className={num}>{t('regulatory.n170.transfer.quantity')}</th>
                <th className={num}>{t('regulatory.n170.transfer.nPerUnit')}</th>
                <th className={num}>{t('common.total')}</th>
              </tr>
            </thead>
            <tbody>
              {d[kind].map((x, i) => (
                <tr key={i}>
                  <td>{x.name}</td>
                  <td className="tabular">{fmt.date(x.date)}</td>
                  <td>{('from' in x ? x.from : 'to' in x ? x.to : null) ?? '—'}</td>
                  <td className={num}>{fmt.num(x.quantity, 2)}</td>
                  <td className={num}>{fmt.num(x.nPerUnit, 2)} kg N</td>
                  <td className={num}>{fmt.qty(x.quantity * x.nPerUnit, 'kg N')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null,
      )}
      {d.onFarmBiogasPlant && <p className="mt-1.5 text-xs">{t('regulatory.n170.biogas')}</p>}
    </>
  )
}
