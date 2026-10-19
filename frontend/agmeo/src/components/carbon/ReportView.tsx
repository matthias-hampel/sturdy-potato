import { type CarbonAnalysis, type CarbonRecommendations, type CarbonReport, type CarbonReportCrop, type CarbonReportNotes, type CarbonReportNotesInput, type CarbonReportRow, OPERATION_TYPES } from '@agmeo/contracts'
import { FileText, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { flattenMeasures, measureLabel } from './Savings'
import { opTypeLabel } from './shared'

/** The generated summary (reference generateDescriptionPdfSummary). */
export function generatedSummary(year: number, crops: { cropName: string }[]): string {
  if (!crops.length) return t('carbon.report.summary.noCrops')
  return [
    t('carbon.report.summary.sentence1', { year }),
    t('carbon.report.summary.sentence2', { crops: crops.map((c) => c.cropName).join(', ') }),
    t('carbon.report.summary.sentence3'),
  ].join(' ')
}

/**
 * The analysis' third view (agmeo analysis/[year] "report"): summary text (generated, editable)
 * and notes per harvest year, saved with the organization, and the report printed as PDF through
 * the browser's print dialog.
 */
export function ReportView({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const report = useOrgQuery<CarbonReport>('/carbon/report', { harvestYear }, { keepPrevious: true })
  const analysis = useOrgQuery<CarbonAnalysis>('/carbon/analysis', { level: 'crop' })
  const rec = useOrgQuery<CarbonRecommendations>('/carbon/recommendations', { harvestYear })
  const [summary, setSummary] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const save = useOrgMutation((base, input: CarbonReportNotesInput) => api.put<CarbonReportNotes>(`${base}/carbon/report/notes`, input), { success: t('carbon.report.saved') })

  // Edits belong to one year.
  useEffect(() => {
    setSummary(null)
    setNotes(null)
  }, [harvestYear])

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

  if (report.isLoading || analysis.isLoading) return <Loading />
  if (report.error || !report.data) return <ErrorNotice error={report.error} />
  const data = report.data
  const generated = generatedSummary(harvestYear, data.crops)
  const summaryText = summary ?? data.notes.summary ?? generated
  const notesText = notes ?? data.notes.notes
  const empty = data.crops.length === 0
  const dirty = (summary != null && summary !== (data.notes.summary ?? generated)) || (notes != null && notes !== data.notes.notes)
  const input = (): CarbonReportNotesInput => ({ harvestYear, summary: summaryText === generated ? null : summaryText, notes: notesText })

  return (
    <Card
      title={t('carbon.report.title', { year: harvestYear })}
      description={t('carbon.report.description')}
      actions={
        <div className="flex gap-2">
          {can('farm.write') && (
            <Button onPress={() => save.mutate(input())} isPending={save.isPending} isDisabled={!dirty}>
              <Save /> {t('carbon.report.save')}
            </Button>
          )}
          <Button
            variant="primary"
            isDisabled={empty}
            onPress={() => {
              if (dirty && can('farm.write')) save.mutate(input())
              setPrinting(true)
            }}
          >
            <FileText /> {t('carbon.report.print')}
          </Button>
        </div>
      }
    >
      {empty && <Notice tone="warning" className="mb-3">{generated}</Notice>}
      <Tabs>
        <TabList aria-label={t('carbon.report.title', { year: harvestYear })}>
          <Tab id="summary">{t('carbon.report.summaryTab')}</Tab>
          <Tab id="notes">{t('carbon.report.notesTab')}</Tab>
        </TabList>
        <TabPanel id="summary">
          <TextField aria-label={t('carbon.report.summaryTab')} multiline rows={8} value={empty ? '' : summaryText} onChange={setSummary} isDisabled={empty || !can('farm.write')} placeholder={t('carbon.report.summaryPlaceholder')} />
          {data.notes.summary != null && can('farm.write') && (
            <Button variant="quiet" size="sm" className="mt-1" onPress={() => setSummary(generated)}>
              {t('carbon.report.resetSummary')}
            </Button>
          )}
        </TabPanel>
        <TabPanel id="notes">
          <TextField aria-label={t('carbon.report.notesTab')} multiline rows={6} value={notesText} onChange={setNotes} isDisabled={!can('farm.write')} placeholder={t('carbon.report.notesPlaceholder')} />
        </TabPanel>
      </Tabs>
      {printing && (
        <ReportSheet
          year={harvestYear}
          crops={data.crops}
          rows={(analysis.data?.rows ?? []).filter((r) => r.year <= harvestYear)}
          scope2Kg={analysis.data?.scope2.find((s) => s.harvestYear === harvestYear)?.totalKg ?? 0}
          summary={summaryText}
          notes={notesText}
          recommendations={rec.data ?? null}
        />
      )}
    </Card>
  )
}

const t1 = (v: number | null | undefined, digits = 2) => fmt.fixed(v, digits)

function ReportSheet({
  year,
  crops,
  rows,
  scope2Kg,
  summary,
  notes,
  recommendations,
}: {
  year: number
  crops: CarbonReportCrop[]
  rows: CarbonReportRow[]
  scope2Kg: number
  summary: string
  notes: string
  recommendations: CarbonRecommendations | null
}) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const own = rows.filter((r) => r.year === year)
  const rowOf = (c: CarbonReportCrop) => own.find((r) => r.cropId === c.cropId)
  const total = own.reduce((s, r) => s + r.total, 0)
  const area = own.reduce((s, r) => s + r.areaHa, 0)
  const measures = recommendations ? flattenMeasures(recommendations).sort((a, b) => b.savedKg - a.savedKg) : []

  return createPortal(
    <div className="agmeo-print hidden print:block bg-white text-black p-8 text-sm leading-relaxed">
      <style>{'@media print { body > :not(.agmeo-print) { display: none !important } @page { size: A4; margin: 15mm } }'}</style>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('carbon.report.sheetTitle')}</h1>
          <p className="text-base">
            {org.name} · {t('carbon.report.harvestYear', { year })}
          </p>
        </div>
        <span className="text-base font-semibold tracking-wide text-[#3d5a2a]">agmeo</span>
      </div>

      <h2 className="mt-6 mb-1 text-lg font-semibold">{t('carbon.report.introTitle')}</h2>
      <p>{t('carbon.report.intro')}</p>

      <h2 className="mt-6 mb-1 text-lg font-semibold">{t('carbon.report.summaryTab')}</h2>
      <p className="whitespace-pre-wrap">{summary}</p>
      <table className="mt-3 w-full border-collapse text-xs">
        <caption className="mb-1 text-left font-semibold">{t('carbon.report.cropTableCaption')}</caption>
        <thead>
          <tr className="border-y border-neutral-500 text-right [&_th:first-child]:text-left">
            <th className="py-1">{t('carbon.report.col.crop')}</th>
            <th>{t('carbon.report.col.area')}</th>
            <th>{t('carbon.report.col.yield')}</th>
            <th>{t('carbon.report.col.dm')}</th>
            <th>{t('carbon.report.col.total')}</th>
            <th>{t('carbon.report.col.perArea')}</th>
            <th>{t('carbon.report.col.perYieldDm')}</th>
          </tr>
          <tr className="border-b border-neutral-400 text-right text-[10px] text-neutral-600 [&_th:first-child]:text-left">
            <th className="font-normal">{t('carbon.report.col.unit')}</th>
            <th className="font-normal">ha</th>
            <th className="font-normal">t</th>
            <th className="font-normal">%</th>
            <th className="font-normal">t CO₂e</th>
            <th className="font-normal">t CO₂e/ha</th>
            <th className="font-normal">t CO₂e/t TM</th>
          </tr>
        </thead>
        <tbody className="text-right tabular-nums [&_td:first-child]:text-left [&_td]:py-0.5">
          {crops.map((c) => {
            const r = rowOf(c)
            return (
              <tr key={c.cropId}>
                <td>{c.cropName}</td>
                <td>{t1(c.areaHa)}</td>
                <td>{t1(c.yieldT)}</td>
                <td>{c.dryMatterPct != null ? fmt.num(c.dryMatterPct, 1) : '—'}</td>
                <td>{t1((r?.total ?? 0) / 1000)}</td>
                <td>{c.areaHa ? t1((r?.total ?? 0) / c.areaHa / 1000) : '—'}</td>
                <td>{r?.yieldTDm ? t1(r.total / r.yieldTDm / 1000) : '—'}</td>
              </tr>
            )
          })}
          <tr className="border-t border-neutral-500 font-semibold">
            <td>{t('carbon.report.total')}</td>
            <td>{t1(area)}</td>
            <td />
            <td />
            <td>{t1(total / 1000)}</td>
            <td>{area ? t1(total / area / 1000) : '—'}</td>
            <td />
          </tr>
        </tbody>
      </table>

      {crops.map((c) => (
        <CropChapter key={c.cropId} crop={c} year={year} row={rowOf(c)} history={rows.filter((r) => r.cropId === c.cropId)} />
      ))}

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-1 text-lg font-semibold">{t('carbon.report.scope2Title')}</h2>
        <p>{scope2Kg ? t('carbon.report.scope2Text', { value: t1(scope2Kg / 1000) }) : t('carbon.report.scope2None')}</p>
      </section>

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-1 text-lg font-semibold">{t('carbon.savings.potential')}</h2>
        {measures.length ? (
          <>
            <p>{t('carbon.report.savingsText', { value: fmt.num(recommendations!.savingsKg) })}</p>
            <ul className="ml-5 list-disc">
              {measures.map((m) => (
                <li key={m.key}>
                  {measureLabel(m)}: {m.cycle.cropName}, {m.cycle.fieldName} ({fmt.num(m.savedKg)} kg CO₂e, {fmt.num(m.savedKgPerHa, 1)} kg CO₂e/ha)
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t('carbon.savings.noMeasures')}</p>
        )}
      </section>

      {notes.trim() && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="mb-1 text-lg font-semibold">{t('carbon.report.notesTab')}</h2>
          <p className="whitespace-pre-wrap">{notes}</p>
        </section>
      )}
      <p className="mt-8 text-[10px] text-neutral-500">{t('carbon.report.createdOn', { date: fmt.date(new Date().toISOString()) })}</p>
    </div>,
    document.body,
  )
}

function CropChapter({ crop, year, row, history }: { crop: CarbonReportCrop; year: number; row: CarbonReportRow | undefined; history: CarbonReportRow[] }) {
  const { t } = useTranslation()
  const total = row?.total ?? 0
  const perHa = crop.areaHa ? total / crop.areaHa : null
  const perFm = row?.yieldT ? total / row.yieldT : null
  const perDm = row?.yieldTDm ? total / row.yieldTDm : null
  const mgmt: [string, string, string][] = [
    [t('carbon.report.mgmt.area'), 'ha', t1(crop.areaHa)],
    [t('carbon.report.mgmt.yield'), 't FM/ha', t1(crop.yieldTHa)],
    [t('carbon.report.mgmt.dm'), '%', crop.dryMatterPct != null ? fmt.num(crop.dryMatterPct, 1) : '—'],
    [t('carbon.report.mgmt.mineralN'), 'kg N/ha', fmt.num(crop.mineralNKgHa, 1)],
    [t('carbon.report.mgmt.organicN'), 'kg N/ha', fmt.num(crop.organicNKgHa, 1)],
    [t('carbon.report.mgmt.incorporated'), '%', crop.incorporated1hPct != null ? fmt.num(crop.incorporated1hPct) : '—'],
    [t('carbon.report.mgmt.previousN'), 'kg N/ha', fmt.num(crop.previousYearNKgHa, 1)],
    [t('carbon.report.mgmt.protection'), 'kg + l/ha', fmt.num(crop.protectionKgLHa, 2)],
    [t('carbon.report.mgmt.byproductRatio'), '', crop.byproductRatio != null ? fmt.num(crop.byproductRatio, 2) : '—'],
  ]
  const byType = OPERATION_TYPES.map((type) => [type, row?.byOperationType[type] ?? 0] as const).filter(([, v]) => v)
  const years = history.filter((h) => h.yieldTDm > 0).sort((a, b) => a.year - b.year)
  return (
    <section className="mt-8 break-before-page">
      <h2 className="mb-1 text-lg font-semibold">{t('carbon.report.cropTitle', { crop: crop.cropName, area: t1(crop.areaHa) })}</h2>
      {!crop.hasModelData && <p className="italic">{t('carbon.report.noModelData')}</p>}
      <table className="mt-2 w-full border-collapse text-xs">
        <caption className="mb-1 text-left font-semibold">{t('carbon.report.mgmtCaption', { crop: crop.cropName, year })}</caption>
        <tbody className="[&_td]:py-0.5 [&_td:nth-child(2)]:text-neutral-600 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums">
          {mgmt.map(([label, unit, value]) => (
            <tr key={label} className="border-b border-neutral-200">
              <td>{label}</td>
              <td>{unit}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {byType.length > 0 && (
        <table className="mt-3 w-full border-collapse text-xs break-inside-avoid">
          <caption className="mb-1 text-left font-semibold">{t('carbon.report.byOperationCaption', { crop: crop.cropName, year })}</caption>
          <tbody className="[&_td]:py-0.5 [&_td:not(:first-child)]:text-right [&_td]:tabular-nums">
            {byType.map(([type, v]) => (
              <tr key={type} className="border-b border-neutral-200">
                <td>{opTypeLabel(type)}</td>
                <td>{fmt.num(v)} kg CO₂e</td>
                <td>{row?.yieldTDm ? `${fmt.num(v / row.yieldTDm)} kg CO₂e/t TM` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <table className="mt-3 w-full border-collapse text-xs break-inside-avoid">
        <caption className="mb-1 text-left font-semibold">{t('carbon.report.footprintCaption', { crop: crop.cropName, year })}</caption>
        <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums">
          <tr className="border-b border-neutral-200"><td>{t('carbon.report.footprint.total')}</td><td>t CO₂e</td><td>{t1(total / 1000)}</td></tr>
          <tr className="border-b border-neutral-200"><td>{t('carbon.report.footprint.perArea')}</td><td>t CO₂e/ha</td><td>{perHa != null ? t1(perHa / 1000) : '—'}</td></tr>
          <tr className="border-b border-neutral-200"><td>{t('carbon.report.footprint.perFm')}</td><td>t CO₂e/t FM</td><td>{perFm != null ? t1(perFm / 1000, 3) : '—'}</td></tr>
          <tr className="border-b border-neutral-200"><td>{t('carbon.report.footprint.perDm')}</td><td>t CO₂e/t TM</td><td>{perDm != null ? t1(perDm / 1000, 3) : '—'}</td></tr>
        </tbody>
      </table>

      <p className="mt-3">
        {t('carbon.report.cropText', {
          crop: crop.cropName,
          year,
          perHa: perHa != null ? t1(perHa / 1000) : '—',
          perFm: perFm != null ? t1(perFm / 1000, 3) : '—',
          perDm: perDm != null ? t1(perDm / 1000, 3) : '—',
          total: t1(total / 1000),
          area: t1(crop.areaHa),
          yieldHa: t1(crop.yieldTHa),
          dm: crop.dryMatterPct != null ? fmt.num(crop.dryMatterPct, 1) : '—',
          mineralN: fmt.num(crop.mineralNKgHa, 1),
          protection: fmt.num(crop.protectionKgLHa, 2),
        })}{' '}
        {crop.organicNKgHa > 0
          ? t('carbon.report.organicText', { amount: `${fmt.num(crop.organicNKgHa, 1)} kg N/ha`, incorporated: crop.incorporated1hPct != null ? `${fmt.num(crop.incorporated1hPct)} %` : '—' })
          : t('carbon.report.noOrganic')}{' '}
        {crop.previousYearNKgHa > 0 ? t('carbon.report.previousNText', { amount: `${fmt.num(crop.previousYearNKgHa, 1)} kg N/ha` }) : t('carbon.report.noPreviousN')}
      </p>

      {years.length > 1 && (
        <table className="mt-3 w-full border-collapse text-xs break-inside-avoid">
          <caption className="mb-1 text-left font-semibold">{t('carbon.report.yearsCaption', { crop: crop.cropName })}</caption>
          <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums">
            {years.map((h) => (
              <tr key={h.year} className="border-b border-neutral-200">
                <td>{h.year}</td>
                <td>{fmt.num(h.total / h.yieldTDm)} kg CO₂e/t TM</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
