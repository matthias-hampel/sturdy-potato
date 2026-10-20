import { type Equipment, type Field, MAP_THEMES, type MapKpis, type MapSoil, type MapTheme, type MapTrafficability, type SoilParameter } from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NO_DATA_COLOR, paramLabel, paramUnit, paramValue, STAGE_COLORS } from '#/components/soil/soilLabels'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Option, Select } from '#/ui/Field'

/**
 * Thematic layers of the organization map (agmeo `_components/mapLayers`): fields coloured by DB I
 * per hectare (EconomicChoroplethLayer), yield relative to the crop (HarvestYieldLayer), CO2e and N
 * per hectare, soil zones by a parameter and its content class (FieldChoroplethLayer) and the
 * trafficability of a machine (TrafficabilityLayer).
 */

export interface ThemeState {
  theme: MapTheme
  soilParameter: SoilParameter
  equipmentId: string | null
  day: number
}

/** Red → yellow → green (RdYlGn) at t ∈ [0, 1]. */
const RAMP = ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850']
const ramp = (t: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(Math.max(0, Math.min(1, t)) * (RAMP.length - 1))))]
const gradient = (stops: string[]) => `linear-gradient(to right, ${stops.join(', ')})`
const BLUES = ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c']
const blues = (t: number) => BLUES[Math.max(0, Math.min(BLUES.length - 1, Math.round(Math.max(0, Math.min(1, t)) * (BLUES.length - 1))))]

/** DB I per hectare: −500 → red, 0 → yellow, ≥ 1000 → green (the reference's CM1 scale). */
export const marginColor = (v: number) => (v < 0 ? ramp(0.45 * (1 - Math.min(1, -v / 500))) : ramp(0.45 + 0.55 * Math.min(1, v / 1000)))

export const TRAFFICABILITY_COLORS: Record<string, string> = { good: '#1a9850', caution: '#fee08b', risk: '#f46d43', unsafe: '#a50026' }

/** The machine shown first: one with tyre data for the compaction index, else any. */
const defaultMachine = (equipment: Equipment[] | undefined) => {
  const machines = (equipment ?? []).filter((e) => e.class === 'machine')
  return machines.find((m) => m.sciReady)?.id ?? machines[0]?.id ?? null
}

const range = (values: number[]): [number, number] => (values.length ? [Math.min(...values), Math.max(...values)] : [0, 0])
const scaled = ([lo, hi]: [number, number], v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5)

export interface ThematicLayer {
  colorBy: (f: Field) => string | null
  overlay: FeatureCollection | null
  legend: ReactNode
  /** Value of a field for the list and the popup, formatted. */
  valueOf: (fieldId: string) => string | null
  /** Extra lines for the field popup (e.g. soil zones). */
  details: (fieldId: string) => { label: string; value: ReactNode }[]
  isLoading: boolean
  notice: string | null
}

export function useThematicLayer(enabled: boolean, s: ThemeState, seasonId: string | null): ThematicLayer {
  const { t } = useTranslation()
  const equipment = useOrgQuery<Equipment[]>(enabled && s.theme === 'trafficability' ? '/equipment' : null)
  const equipmentId = s.equipmentId ?? defaultMachine(equipment.data)
  const kpiTheme = s.theme === 'margin' || s.theme === 'yield' || s.theme === 'co2e' || s.theme === 'nitrogen'
  const kpis = useOrgQuery<MapKpis>(enabled && kpiTheme ? '/map/kpis' : null, { seasonId: seasonId ?? undefined }, { keepPrevious: true })
  const soil = useOrgQuery<MapSoil>(enabled && s.theme === 'soil' ? '/map/soil' : null, { parameter: s.soilParameter }, { keepPrevious: true })
  const traffic = useOrgQuery<MapTrafficability>(enabled && s.theme === 'trafficability' && equipmentId ? '/map/trafficability' : null, { equipmentId: equipmentId ?? undefined, day: s.day }, { keepPrevious: true, staleTime: 600_000 })

  return useMemo<ThematicLayer>(() => {
    const none = () => null
    const base: ThematicLayer = { colorBy: () => NO_DATA_COLOR, overlay: null, legend: null, valueOf: none, details: () => [], isLoading: false, notice: null }
    if (!enabled) return base
    const box = (title: string, body: ReactNode) => (
      <div className="absolute bottom-8 left-3 z-10 w-60 rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-[var(--shadow-overlay)]">
        <div className="mb-1.5 font-medium text-fg">{title}</div>
        {body}
      </div>
    )
    const noData = (
      <div className="mt-1.5 flex items-center gap-1.5 text-fg-2">
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: NO_DATA_COLOR }} aria-hidden />
        {t('mapThemes.noData')}
      </div>
    )

    if (kpiTheme) {
      const rows = new Map((kpis.data?.fields ?? []).map((f) => [f.fieldId, f]))
      const pick = (fieldId: string) => {
        const f = rows.get(fieldId)
        if (!f) return null
        return s.theme === 'margin' ? f.db1PerHa : s.theme === 'yield' ? f.yieldTHa : s.theme === 'co2e' ? f.co2eKgPerHa : f.nKgPerHa
      }
      const currency = kpis.data?.currency ?? 'EUR'
      const format = (v: number) =>
        s.theme === 'margin' ? `${fmt.money(v, currency)}/ha` : s.theme === 'yield' ? `${fmt.num(v, 1)} t/ha` : s.theme === 'co2e' ? `${fmt.num(v)} kg CO₂e/ha` : `${fmt.num(v)} kg N/ha`
      // Yield is relative to the crop: one ramp across wheat and silage maize would say nothing.
      const byCrop = new Map<string, number[]>()
      if (s.theme === 'yield') for (const f of rows.values()) if (f.yieldTHa != null && f.cropName) byCrop.set(f.cropName, [...(byCrop.get(f.cropName) ?? []), f.yieldTHa])
      const all = [...rows.keys()].map(pick).filter((v): v is number => v != null)
      const span = range(all)
      const color = (fieldId: string) => {
        const v = pick(fieldId)
        if (v == null) return NO_DATA_COLOR
        if (s.theme === 'margin') return marginColor(v)
        if (s.theme === 'yield') return ramp(scaled(range(byCrop.get(rows.get(fieldId)!.cropName ?? '') ?? [v]), v))
        if (s.theme === 'co2e') return ramp(1 - scaled(span, v))
        return blues(scaled(span, v))
      }
      const legendBody =
        s.theme === 'margin' ? (
          <>
            <div className="h-2.5 rounded-full" style={{ background: gradient(RAMP) }} aria-hidden />
            <div className="mt-1 flex justify-between text-muted">
              <span>{fmt.money(-500, currency)}</span>
              <span>0</span>
              <span>≥ {fmt.money(1000, currency)}</span>
            </div>
          </>
        ) : s.theme === 'yield' ? (
          <>
            <div className="h-2.5 rounded-full" style={{ background: gradient(RAMP) }} aria-hidden />
            <div className="mt-1 flex justify-between text-muted">
              <span>{t('mapThemes.lowerInCrop')}</span>
              <span>{t('mapThemes.higherInCrop')}</span>
            </div>
          </>
        ) : (
          <>
            <div className="h-2.5 rounded-full" style={{ background: gradient(s.theme === 'co2e' ? [...RAMP].reverse() : BLUES) }} aria-hidden />
            <div className="mt-1 flex justify-between text-muted">
              <span>{all.length ? format(span[0]) : '—'}</span>
              <span>{all.length ? format(span[1]) : '—'}</span>
            </div>
          </>
        )
      return {
        ...base,
        colorBy: (f) => color(f.id),
        valueOf: (id) => {
          const v = pick(id)
          return v == null ? null : format(v)
        },
        legend: box(t(`mapThemes.theme.${s.theme}`), (
          <>
            {legendBody}
            {noData}
          </>
        )),
        isLoading: kpis.isLoading,
        notice: s.theme === 'margin' && kpis.data && !kpis.data.finance ? t('mapThemes.noFinance') : kpis.data && !kpis.data.seasonId ? t('mapThemes.noSeason') : null,
      }
    }

    if (s.theme === 'soil') {
      const zones = soil.data?.zones ?? []
      const values = zones.map((z) => z.value).filter((v): v is number => v != null)
      const span = range(values)
      const zoneColor = (z: (typeof zones)[number]) => (z.value == null ? NO_DATA_COLOR : z.contentClass ? STAGE_COLORS[z.contentClass] : blues(scaled(span, z.value)))
      const byField = new Map<string, typeof zones>()
      for (const z of zones) byField.set(z.fieldId, [...(byField.get(z.fieldId) ?? []), z])
      const hasClasses = zones.some((z) => z.contentClass)
      const unit = paramUnit(s.soilParameter)
      return {
        ...base,
        colorBy: (f) => (byField.has(f.id) ? 'transparent' : NO_DATA_COLOR),
        overlay: zones.length ? { type: 'FeatureCollection', features: zones.map((z) => ({ type: 'Feature', geometry: z.geometry, properties: { color: zoneColor(z) } })) } : null,
        valueOf: (id) => {
          const list = (byField.get(id) ?? []).filter((z) => z.value != null)
          const area = list.reduce((a, z) => a + z.areaHa, 0)
          return area ? `${paramValue(s.soilParameter, list.reduce((a, z) => a + z.value! * z.areaHa, 0) / area)} ${unit}`.trim() : null
        },
        details: (id) =>
          (byField.get(id) ?? []).map((z) => ({
            label: z.label,
            value: (
              <span className="tabular">
                {z.value != null ? `${paramValue(s.soilParameter, z.value)} ${unit}`.trim() : '—'}
                {z.contentClass && <span className="ml-1.5 rounded px-1 text-white" style={{ background: STAGE_COLORS[z.contentClass] }}>{z.contentClass}</span>}
              </span>
            ),
          })),
        legend: box(
          `${paramLabel(s.soilParameter)}${unit ? ` (${unit})` : ''}`,
          <>
            {hasClasses ? (
              <div className="flex gap-1">
                {Object.entries(STAGE_COLORS).map(([k, c]) => (
                  <span key={k} className="flex-1 rounded text-center text-white" style={{ background: c }}>
                    {k}
                  </span>
                ))}
              </div>
            ) : (
              <>
                <div className="h-2.5 rounded-full" style={{ background: gradient(BLUES) }} aria-hidden />
                <div className="mt-1 flex justify-between text-muted">
                  <span>{values.length ? paramValue(s.soilParameter, span[0]) : '—'}</span>
                  <span>{values.length ? paramValue(s.soilParameter, span[1]) : '—'}</span>
                </div>
              </>
            )}
            {hasClasses && <div className="mt-1 text-muted">{t('mapThemes.contentClasses')}</div>}
            {noData}
          </>,
        ),
        isLoading: soil.isLoading,
        notice: soil.data && !zones.length ? t('mapThemes.noSoil') : null,
      }
    }

    // Trafficability
    const rows = new Map((traffic.data?.fields ?? []).map((f) => [f.fieldId, f]))
    const skipped = new Map((traffic.data?.skipped ?? []).map((f) => [f.fieldId, f.reason]))
    return {
      ...base,
      colorBy: (f) => {
        const r = rows.get(f.id)
        return r?.band ? (TRAFFICABILITY_COLORS[r.band] ?? NO_DATA_COLOR) : NO_DATA_COLOR
      },
      valueOf: (id) => {
        const r = rows.get(id)
        if (r?.band) return `${t(`conditions.traffic.band.${r.band}`)}${r.sci != null ? ` · SCI ${fmt.fixed(r.sci, 2)}` : ''}`
        const why = skipped.get(id)
        return why ? t(`mapThemes.skipped.${why}`) : null
      },
      legend: box(
        traffic.data?.date ? t('mapThemes.trafficabilityOn', { date: fmt.date(traffic.data.date) }) : t('mapThemes.theme.trafficability'),
        <>
          {Object.entries(TRAFFICABILITY_COLORS).map(([band, c]) => (
            <div key={band} className="flex items-center gap-1.5 text-fg-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: c }} aria-hidden />
              {t(`conditions.traffic.band.${band}`)}
            </div>
          ))}
          {noData}
        </>,
      ),
      isLoading: traffic.isLoading || equipment.isLoading,
      notice: !equipmentId && !equipment.isLoading ? t('mapThemes.noMachine') : traffic.data && !traffic.data.fields.length ? t('mapThemes.noTrafficability') : null,
    }
  }, [enabled, s, kpiTheme, kpis.data, kpis.isLoading, soil.data, soil.isLoading, traffic.data, traffic.isLoading, equipmentId, equipment.isLoading, t])
}

/** Pickers for the thematic layer: theme, soil parameter, machine and day. */
export function ThemeControls({ value, onChange }: { value: ThemeState; onChange: (patch: Partial<ThemeState>) => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const equipment = useOrgQuery<Equipment[]>(value.theme === 'trafficability' ? '/equipment' : null)
  const soil = useOrgQuery<MapSoil>(value.theme === 'soil' ? '/map/soil' : null, { parameter: value.soilParameter }, { keepPrevious: true })
  const machines = (equipment.data ?? []).filter((e) => e.class === 'machine')
  const themes = MAP_THEMES.filter((th) => th !== 'margin' || can('finance.read'))
  const machineId = value.equipmentId ?? defaultMachine(equipment.data)
  const parameters = soil.data?.available.length ? soil.data.available : (['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as SoilParameter[])
  return (
    <>
      <Select aria-label={t('mapThemes.label')} className="w-48" items={themes.map((id) => ({ id, name: t(`mapThemes.theme.${id}`) }))} value={value.theme} onChange={(v) => v && onChange({ theme: v as MapTheme })}>
        {(o) => <Option id={o.id}>{o.name}</Option>}
      </Select>
      {value.theme === 'soil' && (
        <Select aria-label={t('mapThemes.parameter')} className="w-44" items={parameters.map((id) => ({ id, name: paramLabel(id) }))} value={value.soilParameter} onChange={(v) => v && onChange({ soilParameter: v as SoilParameter })}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
      )}
      {value.theme === 'trafficability' && (
        <>
          <Select aria-label={t('mapThemes.machine')} placeholder={t('mapThemes.machine')} className="w-52" items={machines} value={machineId} onChange={(v) => v && onChange({ equipmentId: String(v) })}>
            {(m) => <Option id={m.id}>{m.name}</Option>}
          </Select>
          <Select aria-label={t('mapThemes.day')} className="w-36" items={Array.from({ length: 8 }, (_, i) => ({ id: i, name: i === 0 ? t('mapThemes.today') : fmt.weekday(new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10)) + ` +${i}` }))} value={value.day} onChange={(v) => v != null && onChange({ day: Number(v) })}>
            {(o) => <Option id={o.id}>{o.name}</Option>}
          </Select>
        </>
      )}
    </>
  )
}
