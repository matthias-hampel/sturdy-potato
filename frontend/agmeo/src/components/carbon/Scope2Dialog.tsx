import { SCOPE2_ELECTRICITY_KINDS, SCOPE2_HEATING_KINDS, SCOPE2_KINDS, type Scope2, type Scope2Input, type Scope2Kind } from '@agmeo/contracts'
import { Info, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField } from '#/ui/Field'
import { ErrorNotice, Loading } from '#/ui/Layout'
import { DialogTrigger, Dialog, Tooltip } from '#/ui/Overlay'

/** Scope 2: purchased electricity and heat of a harvest year (agmeo overview Scope2Button). */
export function Scope2Button({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      <Button>
        <Zap /> {t('carbon.scope2.title')}
      </Button>
      <Dialog title={t('carbon.scope2.title')} description={t('carbon.scope2.description', { year: harvestYear })} size="lg">
        {(close) => <Scope2Form harvestYear={harvestYear} onDone={close} />}
      </Dialog>
    </DialogTrigger>
  )
}

function Scope2Form({ harvestYear, onDone }: { harvestYear: number; onDone: () => void }) {
  const q = useOrgQuery<Scope2>('/carbon/scope2', { harvestYear })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorNotice error={q.error} />
  return <Scope2Editor data={q.data} harvestYear={harvestYear} onDone={onDone} />
}

function Scope2Editor({ data, harvestYear, onDone }: { data: Scope2; harvestYear: number; onDone: () => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const initial = Object.fromEntries(SCOPE2_KINDS.map((k) => [k, data.entries.find((e) => e.kind === k)?.kwh ?? NaN])) as Record<Scope2Kind, number>
  const [kwh, setKwh] = useState(initial)
  const dirty = SCOPE2_KINDS.some((k) => !(Number.isNaN(kwh[k]) && Number.isNaN(initial[k])) && kwh[k] !== initial[k])
  const save = useOrgMutation((base, input: Scope2Input) => api.put<Scope2>(`${base}/carbon/scope2`, input), { success: t('carbon.scope2.saved'), onSuccess: onDone })
  const kg = (k: Scope2Kind) => (kwh[k] > 0 ? kwh[k] * data.parameters[k].value : 0)
  const totalKg = SCOPE2_KINDS.reduce((s, k) => s + kg(k), 0)
  const sections = [
    { title: t('carbon.scope2.electricity'), kinds: SCOPE2_ELECTRICITY_KINDS, hint: null },
    { title: t('carbon.scope2.heating'), kinds: SCOPE2_HEATING_KINDS, hint: t('carbon.scope2.heatingHint') },
  ]
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">{s.title}</h3>
            {s.hint && <span className="text-xs text-muted">{s.hint}</span>}
          </div>
          {s.kinds.map((k) => {
            const p = data.parameters[k]
            return (
              <div key={k} className="grid grid-cols-[1fr_10rem_8rem_auto] items-center gap-3">
                <span className="text-sm">{t(`carbon.scope2.kind.${k}`)}</span>
                <NumberField aria-label={t(`carbon.scope2.kind.${k}`)} unit="kWh" minValue={0} step={100} value={kwh[k]} onChange={(v) => setKwh((prev) => ({ ...prev, [k]: v }))} isDisabled={!can('farm.write')} />
                <span className="text-right text-xs text-fg-2 tabular">{kg(k) > 0 ? `${fmt.num(kg(k))} kg CO₂e` : '—'}</span>
                <Tooltip
                  content={
                    <div className="space-y-1 max-w-xs text-xs">
                      <div className="font-semibold">{t('carbon.scope2.factor')}</div>
                      <div>{p.name}</div>
                      <div>
                        {fmt.num(p.value, 6)} {p.unit}
                      </div>
                      <div className="text-muted">
                        {t('carbon.source')}: {p.source}
                      </div>
                    </div>
                  }
                >
                  <Button variant="ghost" size="icon-xs" aria-label={t('carbon.scope2.factor')}>
                    <Info />
                  </Button>
                </Tooltip>
              </div>
            )
          })}
        </section>
      ))}
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-sm font-medium">{t('carbon.scope2.total')}</span>
        <span className="text-lg font-semibold tabular">{fmt.num(totalKg)} kg CO₂e</span>
      </div>
      <div className="flex justify-end gap-2">
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        {can('farm.write') && (
          <Button
            variant="primary"
            isDisabled={!dirty}
            isPending={save.isPending}
            onPress={() => save.mutate({ harvestYear, entries: SCOPE2_KINDS.filter((k) => kwh[k] > 0).map((k) => ({ kind: k, kwh: kwh[k] })) })}
          >
            {t('common.save')}
          </Button>
        )}
      </div>
    </div>
  )
}
