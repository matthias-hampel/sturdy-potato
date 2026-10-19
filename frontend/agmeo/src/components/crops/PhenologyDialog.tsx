import type { CropPhenology } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { XYChart } from '#/components/charts'
import { cropTableKey } from '#/components/crops/cropTableMetrics'
import { api, errorMessage } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { DatePicker, NumberField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice, Stat } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

/** BBCH ranges of the reference's growth stages, with their colours. */
export const BBCH_STAGES = [
  { key: 'germination', from: 0, to: 9, color: '#8B5E3C' },
  { key: 'leafDev', from: 10, to: 19, color: '#4DC709' },
  { key: 'tillering', from: 20, to: 29, color: '#3BA507' },
  { key: 'stemElong', from: 30, to: 39, color: '#2D8005' },
  { key: 'booting', from: 40, to: 49, color: '#1F5A03' },
  { key: 'heading', from: 50, to: 59, color: '#FFB020' },
  { key: 'flowering', from: 60, to: 69, color: '#FF6B6B' },
  { key: 'grainFill', from: 70, to: 89, color: '#DAA520' },
  { key: 'maturity', from: 90, to: 99, color: '#8B6914' },
] as const
export const stageOf = (bbch: number | null | undefined) => (bbch == null ? undefined : BBCH_STAGES.find((s) => bbch >= s.from && bbch <= s.to))

const TEMP_PARAMS = ['TBD', 'TP1D', 'TP2D', 'TCD', 'TBVER', 'TP1VER', 'TP2VER', 'TCVER'] as const
const STAGE_DURATIONS = ['bdSOWEMR', 'bdEMRTIL', 'bdTILSEL', 'bdSELBOT', 'bdBOTEAR', 'bdEARANT', 'bdANTPM', 'bdPMHM'] as const
const STAGE_LABEL: Record<(typeof STAGE_DURATIONS)[number], string> = {
  bdSOWEMR: 'sowEmergence',
  bdEMRTIL: 'emergenceTiller',
  bdTILSEL: 'tillerStem',
  bdSELBOT: 'stemBoot',
  bdBOTEAR: 'bootEar',
  bdEARANT: 'earAnthesis',
  bdANTPM: 'anthesisMaturity',
  bdPMHM: 'maturityHarvest',
}

const dayNo = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86_400_000)
const dateOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10)

/**
 * BBCH development of one crop (reference PhenologyContent): model and calibrated stages,
 * temperature, vernalization and day length, the observation form and history, and the model's
 * parameters. Observations go through the crop-table's bbch-observations endpoint.
 */
export function PhenologyDialog({ cropCycleId, fieldName, initialDate, onClose }: { cropCycleId: string; fieldName: string; initialDate?: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const phen = useOrgQuery<CropPhenology>(`/crop-cycles/${cropCycleId}/phenology`)
  const [date, setDate] = useState<string | null>(initialDate && initialDate <= today() ? initialDate : today())
  const [bbch, setBbch] = useState(NaN)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: cropTableKey(orgId) })
    void phen.refetch()
  }
  const save = useOrgMutation((base, v: { date: string; bbch: number }) => api.post(`${base}/crop-cycles/${cropCycleId}/bbch-observations`, v), { success: t('protection.phenology.calibrate.saved'), onSuccess: refresh })
  const remove = useOrgMutation((base, d: string) => api.delete(`${base}/crop-cycles/${cropCycleId}/bbch-observations/${d}`), { success: t('cropTable.bbch.cleared'), onSuccess: refresh })

  const p = phen.data
  const days = p?.days ?? []
  const stage = stageOf(p?.currentBbch)
  const lastVern = days.length ? days[Math.min(days.findIndex((d) => d.date >= today()) >>> 0, days.length - 1)].vernalization : null
  const fmtX = (n: number) => fmt.shortDate(dateOf(n))
  const writable = can('crop.write')

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('protection.phenology.title', { field: fieldName })} description={p?.cropName} size="xl">
      {phen.isLoading ? (
        <Loading label={t('protection.phenology.loading')} />
      ) : phen.error ? (
        <ErrorNotice error={phen.error} />
      ) : !p?.supported ? (
        <Notice tone="info">{t('protection.phenology.notAvailable')}</Notice>
      ) : !days.length ? (
        <Notice tone="info">{p.sowingDate && p.sowingDate > today() ? t('protection.phenology.futureSowing') : t('protection.bbch.info.seedingDateDesc')}</Notice>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={t('protection.bbchCurrent')} value={p.currentBbch ?? '—'} hint={p.bbchOffset != null ? t('protection.phenology.calibratedHint') : t('protection.phenology.modelHint')} />
            <Stat label={t('protection.phenology.growthStage')} value={stage ? <span style={{ color: stage.color }}>{t(`protection.phenology.stage.${stage.key}`)}</span> : '—'} />
            <Stat label={t('protection.phenology.vernalization')} value={lastVern != null ? fmt.num(lastVern, 1) : '—'} />
            <Stat label={t('protection.phenology.sowing')} value={p.sowingDate ? fmt.date(p.sowingDate) : '—'} hint={p.sowingSource ? t(`protection.phenology.sowingSource.${p.sowingSource}`) : undefined} />
          </div>

          <Card title={t('protection.phenology.chart.title')}>
            <XYChart
              ariaLabel={t('protection.phenology.chart.title')}
              height={280}
              formatX={fmtX}
              formatY={(v) => fmt.num(v)}
              series={[
                ...(p.observations.length ? [{ name: t('protection.phenology.chart.calibrated'), color: 'var(--color-success)', points: days.map((d) => ({ x: dayNo(d.date), y: d.bbch })) }] : []),
                { name: t('protection.phenology.chart.model'), color: 'var(--color-muted)', dashed: p.observations.length > 0, points: days.map((d) => ({ x: dayNo(d.date), y: d.modelBbch })) },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {BBCH_STAGES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.from}–{s.to} {t(`protection.phenology.stage.${s.key}`)}
                </span>
              ))}
            </div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title={t('protection.phenology.chart.temperature')}>
              <XYChart ariaLabel={t('protection.phenology.chart.temperature')} height={180} formatX={fmtX} formatY={(v) => `${fmt.num(v)}`} series={[
                { name: t('protection.phenology.chart.temperature'), color: 'var(--color-danger)', points: days.map((d) => ({ x: dayNo(d.date), y: d.tempMean })) },
                { name: t('protection.phenology.chart.vernalization'), color: 'var(--color-series-1)', points: days.map((d) => ({ x: dayNo(d.date), y: d.vernalization })) },
              ]} />
            </Card>
            <Card title={t('protection.phenology.chart.photoperiod')}>
              <XYChart ariaLabel={t('protection.phenology.chart.photoperiod')} height={180} formatX={fmtX} formatY={(v) => `${fmt.num(v, 1)} h`} series={[{ name: t('protection.phenology.chart.photoperiod'), color: 'var(--color-warning)', dashed: true, points: days.map((d) => ({ x: dayNo(d.date), y: d.photoperiod })) }]} />
            </Card>
          </div>
          <Notice tone="warning">{t('protection.bbch.modelDisclaimer')}</Notice>

          <Card title={t('protection.phenology.calibrate.title')} description={t('protection.phenology.calibrate.description')}>
            {writable && (
              <Form
                className="flex flex-wrap items-end gap-3 mb-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (date && !Number.isNaN(bbch)) save.mutate({ date, bbch }, { onSuccess: () => setBbch(NaN) })
                }}
              >
                <DatePicker label={t('protection.phenology.calibrate.date')} value={date} onChange={setDate} minValue={days[0].date} maxValue={today()} isRequired />
                <NumberField label={t('protection.phenology.calibrate.observed')} className="w-40" minValue={0} maxValue={99} step={1} value={bbch} onChange={setBbch} isRequired />
                <Button type="submit" variant="primary" isDisabled={!date || Number.isNaN(bbch)} isPending={save.isPending}>
                  {t('protection.phenology.calibrate.save')}
                </Button>
                {save.error && <p className="w-full text-sm text-danger">{errorMessage(save.error)}</p>}
              </Form>
            )}
            <h4 className="text-sm font-semibold text-fg mb-2">{t('protection.phenology.calibrate.history')}</h4>
            {p.observations.length === 0 ? (
              <p className="text-sm text-muted">{t('protection.phenology.calibrate.history.empty')}</p>
            ) : (
              <Table aria-label={t('protection.phenology.calibrate.history')}>
                <TableHeader>
                  <Column isRowHeader>{t('protection.phenology.calibrate.history.col.date')}</Column>
                  <Column align="end">{t('protection.phenology.calibrate.history.col.observed')}</Column>
                  <Column align="end">{t('protection.phenology.calibrate.history.col.model')}</Column>
                  <Column align="end">{t('protection.phenology.calibrate.history.col.offset')}</Column>
                  <Column className="w-10">{''}</Column>
                </TableHeader>
                <TableBody items={p.observations.map((o, i) => ({ ...o, id: o.observedOn, active: i === 0 }))}>
                  {(o) => (
                    <Row id={o.id}>
                      <Cell>
                        {fmt.date(o.observedOn)} {o.active && <span className="ml-1 text-xs text-success">{t('protection.phenology.calibrate.history.active')}</span>}
                      </Cell>
                      <Cell align="end" className="tabular">{o.observedBbch}</Cell>
                      <Cell align="end" className="tabular">{o.modelBbch ?? '—'}</Cell>
                      <Cell align="end" className="tabular">{`${o.bdOffset >= 0 ? '+' : ''}${fmt.num(o.bdOffset, 1)}`}</Cell>
                      <Cell>
                        {writable && (
                          <Button size="icon-xs" variant="ghost" aria-label={t('protection.phenology.calibrate.history.delete')} isPending={remove.isPending && remove.variables === o.observedOn} onPress={() => remove.mutate(o.observedOn)}>
                            <Trash2 />
                          </Button>
                        )}
                      </Cell>
                    </Row>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>

          {p.params && p.stageDurations && (
            <details className="rounded-md border border-line p-3 text-sm">
              <summary className="cursor-pointer font-medium text-fg">{t('protection.phenology.modelParams')} — {p.cropName}</summary>
              <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                {TEMP_PARAMS.map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{t(`protection.phenology.param.${k.toLowerCase()}`)}</dt>
                    <dd className="tabular">{fmt.measure(p.params![k], 'temperature', { digits: 0 })}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-muted">{t('protection.phenology.param.vdsat')}</dt>
                  <dd className="tabular">{fmt.num(p.params.VDSAT)} d</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('protection.phenology.param.vsen')}</dt>
                  <dd className="tabular">{p.params.vsen}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('protection.phenology.param.cpp')}</dt>
                  <dd className="tabular">{fmt.num(p.params.cpp, 1)} h</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('protection.phenology.param.ppsen')}</dt>
                  <dd className="tabular">{p.params.ppsen}</dd>
                </div>
                {STAGE_DURATIONS.map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{t(`protection.phenology.gs.${STAGE_LABEL[k]}`)}</dt>
                    <dd className="tabular">{fmt.num(p.stageDurations![k], 1)} bd</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted">{t('protection.phenology.modelRefs')}</p>
            </details>
          )}
        </div>
      )}
    </ModalDialog>
  )
}
