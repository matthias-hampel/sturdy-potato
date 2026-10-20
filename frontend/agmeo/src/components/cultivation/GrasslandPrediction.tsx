import type { CropGrasslandPrediction } from '@agmeo/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart } from '#/components/charts'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { NumberField } from '#/ui/Field'
import { Card, DescriptionList, ErrorNotice, Loading, Notice } from '#/ui/Layout'

/**
 * Grassland growth since the last cut from grassland-api (the reference's grassland predictions):
 * dry and fresh matter today and the dry-matter curve, for grassland crops only.
 */
export function GrasslandPrediction({ cycleId }: { cycleId: string }) {
  const { t } = useTranslation()
  const [dmcPct, setDmcPct] = useState(35)
  const dmc = Number.isFinite(dmcPct) && dmcPct > 0 && dmcPct <= 100 ? dmcPct / 100 : 0.35
  const q = useOrgQuery<CropGrasslandPrediction>(`/crop-cycles/${cycleId}/grassland-prediction`, { targetDMC: dmc }, { staleTime: 30 * 60_000, keepPrevious: true })
  if (q.data && !q.data.applicable) return null
  if (!q.data && !q.error) return q.isLoading ? <Loading /> : null
  const p = q.data?.prediction
  return (
    <Card title={t('cultivation.grassland.title')} description={t('cultivation.grassland.description')}>
      {q.error ? (
        <ErrorNotice error={q.error} />
      ) : !q.data!.configured ? (
        <Notice tone="info">{t('cultivation.grassland.notConfigured')}</Notice>
      ) : !p || p.timeseries.keys.length === 0 ? (
        <Notice tone="info">{t('cultivation.grassland.noData')}</Notice>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-[1fr_12rem] gap-4 items-start">
            <DescriptionList
              items={[
                { label: t('cultivation.grassland.today'), value: fmt.date(p.today.date) },
                { label: t('cultivation.grassland.lastCut'), value: p.today.lastHarvest?.length ? fmt.date(p.today.lastHarvest.toSorted().at(-1)!) : '—' },
                { label: t('cultivation.grassland.yieldDM'), value: `${fmt.fixed(p.today.yieldDM.perArea, 2)} t/ha · ${fmt.fixed(p.today.yieldDM.total, 1)} t` },
                { label: t('cultivation.grassland.yieldFM', { dmc: fmt.num(dmcPct) }), value: `${fmt.fixed(p.today.yieldFM_targetDMC.perArea, 2)} t/ha · ${fmt.fixed(p.today.yieldFM_targetDMC.total, 1)} t` },
              ]}
            />
            <NumberField label={t('cultivation.grassland.targetDmc')} unit="%" minValue={1} maxValue={100} value={dmcPct} onChange={setDmcPct} />
          </div>
          <LineChart
            ariaLabel={t('cultivation.grassland.chart')}
            points={p.timeseries.keys.map((date, i) => ({ date, value: p.timeseries.yieldDM[i] ?? null }))}
            format={(v) => `${fmt.fixed(v, 1)} t`}
            height={200}
          />
          <p className="text-xs text-muted">{t('cultivation.grassland.chart')}</p>
        </div>
      )}
    </Card>
  )
}
