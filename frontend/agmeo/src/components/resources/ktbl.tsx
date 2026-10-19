import type { Crop, KtblAction, KtblEstimate, OperationType } from '@agmeo/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGE } from '#/i18n'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { ComboBox, NumberField, Option, Select } from '#/ui/Field'
import { ErrorNotice } from '#/ui/Layout'
import { NONE, keyOrNull } from './form'

export interface KtblValues {
  fqn: string
  name: string
  dieselLPerHa: number
  hoursPerHa: number
}

const DEFAULT_FIELD_SIZE_HA = 10
const DEFAULT_DISTANCE_KM = 5
const DEFAULT_POWER_KW = 120
const COST_KEYS = ['depreciation', 'interest', 'miscellaneous', 'repairs', 'materials', 'services'] as const

const text = (x: { de: string; en: string }) => (LANGUAGE === 'en' ? x.en : x.de)
/** Label of a KTBL action: the work and the machine variant. */
export const ktblActionLabel = (a: KtblAction) => `${text(a.group)}: ${text(a.label)}`

/**
 * Takes diesel and hours per hectare of a KTBL action (work and machine variant) into the action
 * form. Optional crop for the KTBL table values of its crop group and for the actions offered for
 * it; field size, distance and tractor power as on the farm (power from the chosen machine).
 */
export function KtblLookup({
  operationType,
  machinePowerKw,
  linked,
  onApply,
}: {
  operationType: OperationType
  machinePowerKw: number | null
  linked: string | null
  onApply: (values: KtblValues) => void
}) {
  const { t } = useTranslation()
  const [cropId, setCropId] = useState<string>(NONE)
  const [fqn, setFqn] = useState<string | null>(null)
  const [fieldSizeHa, setFieldSizeHa] = useState(DEFAULT_FIELD_SIZE_HA)
  const [distanceKm, setDistanceKm] = useState(DEFAULT_DISTANCE_KM)
  const [powerKw, setPowerKw] = useState(NaN)
  const crop = keyOrNull(cropId) ?? undefined
  const mechKw = Number.isNaN(powerKw) ? (machinePowerKw ?? DEFAULT_POWER_KW) : powerKw

  const crops = useOrgQuery<Crop[]>('/crops', undefined, { staleTime: Infinity })
  const actions = useOrgQuery<KtblAction[]>('/ktbl/actions', { operationType, crop }, { staleTime: Infinity, keepPrevious: true })
  const selected = actions.data?.find((a) => a.fqn === fqn) ?? null
  const estimate = useOrgQuery<KtblEstimate>(
    selected ? '/ktbl/estimate' : null,
    {
      fqn: selected?.fqn,
      crop,
      fieldSizeHa: Number.isNaN(fieldSizeHa) || fieldSizeHa <= 0 ? undefined : fieldSizeHa,
      distanceKm: Number.isNaN(distanceKm) ? undefined : distanceKm,
      mechKw: mechKw > 0 ? mechKw : undefined,
    },
    { staleTime: Infinity, keepPrevious: true },
  )
  const e = selected && estimate.data?.fqn === selected.fqn ? estimate.data : null
  const linkedInList = linked ? (actions.data?.find((a) => a.fqn === linked) ?? null) : null
  const linkedSearch = useOrgQuery<KtblAction[]>(linked && actions.data && !linkedInList ? '/ktbl/actions' : null, { q: linked ?? undefined }, { staleTime: Infinity })
  const linkedAction = linkedInList ?? linkedSearch.data?.find((a) => a.fqn === linked) ?? null

  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-line bg-surface-2/50 p-3 pt-2 grid sm:grid-cols-2 gap-3">
      <legend className="px-1 text-xs font-medium text-muted">{t('ktbl.title')}</legend>
      <Select
        label={t('ktbl.crop')}
        items={[{ id: NONE, name: t('ktbl.anyCrop') }, ...(crops.data ?? []).map((c) => ({ id: c.id, name: c.name }))]}
        value={cropId}
        onChange={(v) => setCropId(String(v ?? NONE))}
        description={t('ktbl.cropHint')}
      >
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </Select>
      <ComboBox
        label={t('ktbl.action')}
        items={(actions.data ?? []).map((a) => ({ id: a.fqn, action: a }))}
        value={selected?.fqn ?? null}
        onChange={(v) => setFqn(v == null ? null : String(v))}
        placeholder={actions.isLoading ? t('common.loading') : t('ktbl.chooseAction', { count: actions.data?.length ?? 0 })}
        menuTrigger="focus"
      >
        {(x) => (
          <Option id={x.id} textValue={ktblActionLabel(x.action)} description={text(x.action.group)}>
            {text(x.action.label)}
          </Option>
        )}
      </ComboBox>
      <div className="sm:col-span-2 grid grid-cols-3 gap-3">
        <NumberField label={t('ktbl.fieldSize')} unit="ha" value={fieldSizeHa} onChange={setFieldSizeHa} minValue={0.1} maxValue={10000} formatOptions={{ maximumFractionDigits: 2 }} />
        <NumberField label={t('ktbl.distance')} unit="km" value={distanceKm} onChange={setDistanceKm} minValue={0} maxValue={500} formatOptions={{ maximumFractionDigits: 1 }} />
        <NumberField
          label={t('ktbl.power')}
          unit="kW"
          value={mechKw}
          onChange={setPowerKw}
          minValue={1}
          maxValue={2000}
          formatOptions={{ maximumFractionDigits: 0 }}
        />
      </div>
      {estimate.error && <ErrorNotice className="sm:col-span-2" error={estimate.error} />}
      {selected && e && (
        <div className="sm:col-span-2 rounded-md border border-line bg-surface px-3 py-2 text-sm space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="tabular">
              <strong className="text-fg">{fmt.num(e.diesel, 2)} l/ha</strong>
              <span className="text-muted"> · </span>
              <strong className="text-fg">{fmt.num(e.hours, 3)} h/ha</strong>
              <span className="text-muted"> · {e.method === 'grid' && e.cropGroup ? t('ktbl.method.grid', { group: t(`ktbl.group.${e.cropGroup}`) }) : t('ktbl.method.formula')}</span>
            </div>
            <Button
              size="sm"
              variant="quiet"
              onPress={() => onApply({ fqn: selected.fqn, name: ktblActionLabel(selected), dieselLPerHa: e.diesel, hoursPerHa: e.hours })}
            >
              {t('ktbl.apply')}
            </Button>
          </div>
          <p className="text-xs text-muted tabular">
            {t('ktbl.costs')}: {COST_KEYS.map((k) => `${t(`ktbl.cost.${k}`)} ${fmt.money(e[k], 'EUR', 2)}`).join(' · ')}
          </p>
        </div>
      )}
      <p className="sm:col-span-2 text-xs text-muted">
        {linked && <>{t('ktbl.linked', { action: linkedAction ? ktblActionLabel(linkedAction) : linked })} </>}
        {t('ktbl.caveat')}
      </p>
    </fieldset>
  )
}
