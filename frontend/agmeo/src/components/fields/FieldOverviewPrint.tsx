import type { CropCycle, Field, Operation, OperationType, YieldHistoryEntry } from '@agmeo/contracts'
import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { baseUnitLabel, operationTypeLabel } from '#/i18n/labels'
import { fmt } from '#/lib/format'
import { useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'

/**
 * Prints the field's overview for the selected harvest year (agmeo "field overview PDF"): master
 * data, then the completed operations by type with date, product and quantity. The browser's
 * print dialog saves it as PDF.
 */
export function FieldOverviewPrintButton({ field, cycles, operations }: { field: Field; cycles: CropCycle[]; operations: Operation[] }) {
  const { t } = useTranslation()
  const { season } = useSeason()
  const [printing, setPrinting] = useState(false)
  const history = useOrgQuery<YieldHistoryEntry[]>(printing ? `/yield-maps/fields/${field.id}/history` : null)

  useEffect(() => {
    if (!printing || history.isLoading) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done, { once: true })
    const id = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing, history.isLoading])

  const year = season?.harvestYear ?? new Date().getFullYear()
  return (
    <>
      <Button onPress={() => setPrinting(true)} isPending={printing && history.isLoading}>
        <FileText /> {t('fieldOverview.print')}
      </Button>
      {printing && !history.isLoading && (
        <OverviewSheet field={field} year={year} cycles={cycles} operations={operations} yields={history.data ?? []} />
      )}
    </>
  )
}

function OverviewSheet({
  field,
  year,
  cycles,
  operations,
  yields,
}: {
  field: Field
  year: number
  cycles: CropCycle[]
  operations: Operation[]
  yields: YieldHistoryEntry[]
}) {
  const { t } = useTranslation()
  const main = cycles.filter((c) => c.harvestYear === year && c.role === 'main')
  const cycle = main[0] ?? cycles.find((c) => c.harvestYear === year) ?? null
  // The crop sequence of the five years up to this one, oldest first.
  const rotation = [...new Set(cycles.filter((c) => c.role === 'main' && c.harvestYear <= year && c.harvestYear > year - 5).sort((a, b) => a.harvestYear - b.harvestYear).map((c) => `${c.harvestYear}: ${c.cropName}`))]
  const yieldRow = yields.find((y) => y.harvestYear === year)
  const yieldTHa = yieldRow?.documentedYieldTHa ?? yieldRow?.mapMeanTHa ?? null
  const inYear = operations
    .filter((o) => o.status === 'completed' && o.performedAt && (cycle ? o.fields.some((f) => f.cropCycleId === cycle.id) || within(o.performedAt, cycle) : o.performedAt.startsWith(String(year))))
    .sort((a, b) => (a.performedAt ?? '').localeCompare(b.performedAt ?? ''))
  const byType = new Map<OperationType, Operation[]>()
  for (const o of inYear) byType.set(o.type, [...(byType.get(o.type) ?? []), o])

  const master: [string, string][] = [
    [t('fieldOverview.area'), fmt.ha(field.areaHa)],
    [t('fieldOverview.crop'), cycle ? `${cycle.cropName}${cycle.varietyName ? ` (${cycle.varietyName})` : ''}` : '—'],
    [t('fieldOverview.template'), cycle?.templateName ?? '—'],
    [t('fieldOverview.rotation'), rotation.join(' → ') || '—'],
    [t('fieldOverview.soilType'), field.soilType ?? '—'],
    [t('fieldOverview.sowingDate'), cycle?.sowingDate ? fmt.date(cycle.sowingDate) : '—'],
    [t('fieldOverview.yield'), yieldTHa != null ? `${fmt.num(yieldTHa, 2)} t/ha` : '—'],
  ]

  return createPortal(
    <div className="agmeo-print hidden print:block bg-white text-black p-8 text-sm">
      <style>{'@media print { body > :not(.agmeo-print) { display: none !important } @page { size: A4; margin: 15mm } }'}</style>
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-semibold">
          {field.name} — {year}
        </h1>
        <span className="text-base font-semibold tracking-wide text-[#3d5a2a]">agmeo</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        {field.farmName}
        {field.identifier ? ` · ${field.identifier}` : ''}
      </p>

      <h2 className="mt-6 mb-2 font-semibold">{t('fieldOverview.masterData')}</h2>
      <table className="w-full border-collapse">
        <tbody className="[&_td]:py-0.5 [&_td:first-child]:w-48 [&_td:first-child]:font-semibold">
          {master.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-6 mb-2 font-semibold">{t('fieldOverview.operations')}</h2>
      {byType.size === 0 && <p>{t('fieldOverview.noOperations')}</p>}
      {[...byType].map(([type, ops]) => (
        <section key={type} className="mb-4 break-inside-avoid">
          <h3 className="font-semibold">{operationTypeLabel(type)}</h3>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-xs">
                <th className="w-24 py-1 font-semibold">{t('fieldOverview.date')}</th>
                <th className="py-1 font-semibold">{t('fieldOverview.product')}</th>
                <th className="w-40 py-1 text-right font-semibold">{t('fieldOverview.quantity')}</th>
              </tr>
            </thead>
            <tbody className="[&_td]:py-0.5 text-xs">
              {ops.flatMap((o) =>
                o.inputs.length
                  ? o.inputs.map((line) => (
                      <tr key={`${o.id}-${line.id}`}>
                        <td>{fmt.date(o.performedAt)}</td>
                        <td>{line.productName}</td>
                        <td className="text-right tabular-nums">
                          {line.ratePerHa != null ? `${fmt.num(line.ratePerHa, 2)} ${baseUnitLabel(line.baseUnit)}/ha` : `${fmt.num(line.totalQuantity, 2)} ${baseUnitLabel(line.baseUnit)}`}
                        </td>
                      </tr>
                    ))
                  : [
                      <tr key={o.id}>
                        <td>{fmt.date(o.performedAt)}</td>
                        <td>{o.title}</td>
                        <td className="text-right">—</td>
                      </tr>,
                    ],
              )}
            </tbody>
          </table>
        </section>
      ))}
      <p className="mt-8 text-[10px] text-neutral-500">{t('fieldOverview.generatedOn', { date: fmt.date(new Date().toISOString()) })}</p>
    </div>,
    document.body,
  )
}

const within = (performedAt: string, cycle: CropCycle) =>
  !!cycle.sowingDate && performedAt.slice(0, 10) >= cycle.sowingDate && (!cycle.expectedHarvestDate || performedAt.slice(0, 10) <= cycle.expectedHarvestDate)
