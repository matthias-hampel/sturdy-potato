import { zoneColor, type CropCycle, type Field, type FieldPart, type Operation, type ProductivityState, type VraMapSummary, type Zoning } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ExternalLink, Pencil } from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CultivationInfo } from '#/components/cultivation/CultivationInfo'
import { CultivationOperations } from '#/components/cultivation/CultivationOperations'
import { GrasslandPrediction } from '#/components/cultivation/GrasslandPrediction'
import { ZoneOptimization, type ZoneFocus } from '#/components/cultivation/ZoneOptimization'
import { OPT_CATEGORIES } from '#/components/cultivation/zoneMath'
import { EditCycleDialog } from '#/components/crops/CycleDialogs'
import { CropCycleYield } from '#/components/yield/CropCycleYield'
import { CropCycleStatusBadge, CropRoleBadge, CropTag } from '#/components/labels'
import { FieldMap } from '#/components/map/FieldMap'
import { zoneName } from '#/components/monitoring/ProductivityZones'
import { cropRoleLabel } from '#/i18n/labels'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'

const TABS = ['info', 'operations', 'zones', 'yield'] as const
type CultivationTab = (typeof TABS)[number]

export const Route = createFileRoute('/o/$orgId/crops/$cropCycleId')({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    /** Maßnahmen: the template (Soll) or the recorded operations (Ist). */
    view: z.enum(['plan', 'actual']).optional(),
    category: z.enum(OPT_CATEGORIES).optional(),
  }),
  component: CultivationPage,
})

/**
 * A crop on a field in its season, as the field page of the original agmeo: field info,
 * operations (Soll/Ist) and the zone-specific optimization, beside a map of the field.
 */
function CultivationPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { cropCycleId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  // The same query as the planning table, so the page opens from its cache.
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles')
  const cycle = cycles.data?.find((c) => c.id === cropCycleId)
  const field = useOrgQuery<Field>(cycle ? `/fields/${cycle.fieldId}` : null)
  const parts = useOrgQuery<FieldPart[]>(cycle?.fieldPartId ? `/fields/${cycle.fieldId}/parts` : null, { seasonId: cycle?.seasonId })
  const allOperations = useOrgQuery<Operation[]>(cycle ? '/operations' : null, { fieldId: cycle?.fieldId })
  // A crop on a part gets the zones clipped to the part: areas, totals, map and saved VRA maps cover the part only.
  const productivity = useOrgQuery<ProductivityState>(cycle ? `/fields/${cycle.fieldId}/productivity` : null, cycle?.fieldPartId ? { fieldPartId: cycle.fieldPartId } : undefined, {
    refetchInterval: (s) => (s?.pending ? 5_000 : false),
  })
  const maps = useOrgQuery<VraMapSummary[]>(cycle ? `/fields/${cycle.fieldId}/vra-maps` : null)
  const [editOpen, setEditOpen] = useState(false)
  const [zoningId, setZoningId] = useState<string | null>(null)
  const [focus, setFocus] = useState<ZoneFocus | null>(null)

  const operations = useMemo(
    () => (allOperations.data ?? []).filter((op) => op.fields.some((f) => f.cropCycleId === cropCycleId)),
    [allOperations.data, cropCycleId],
  )
  const siblings = useMemo(
    () => (cycle ? (cycles.data ?? []).filter((c) => c.fieldId === cycle.fieldId && c.seasonId === cycle.seasonId && c.fieldPartId === cycle.fieldPartId) : []),
    [cycles.data, cycle],
  )
  const zonings = useMemo(() => [...(productivity.data?.analysis?.zonings ?? [])].sort((a, b) => a.zoneCount - b.zoneCount || Number(a.isCustom) - Number(b.isCustom)), [productivity.data])
  // Default: the zoning the crop's zone rates were set on, else three zones.
  const zoning = useMemo<Zoning | null>(() => {
    const opIds = new Set(operations.map((o) => o.id))
    const used = (maps.data ?? []).find((m) => m.operationId && opIds.has(m.operationId))?.zoningId
    return zonings.find((z) => z.id === zoningId) ?? zonings.find((z) => z.id === used) ?? zonings.find((z) => z.zoneCount === 3 && !z.isCustom) ?? zonings[0] ?? null
  }, [zonings, zoningId, maps.data, operations])

  if (cycles.isLoading || field.isLoading) return <Loading />
  if (cycles.error) return <ErrorNotice error={cycles.error} />
  if (!cycle) {
    return (
      <Card>
        <EmptyState title={t('cultivation.notFound.title')} action={<Link to="/o/$orgId/crops" params={{ orgId }} variant="primary">{t('cultivation.back')}</Link>}>
          {t('cultivation.notFound.description')}
        </EmptyState>
      </Card>
    )
  }
  if (field.error) return <ErrorNotice error={field.error} />
  const f = field.data!
  const part = parts.data?.find((p) => p.id === cycle.fieldPartId) ?? null
  const tab: CultivationTab = search.tab ?? 'info'
  const setSearch = (next: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/o/$orgId/crops" params={{ orgId }}>{t('crops.title')}</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {f.name}
            {cycle.fieldPartName && <span className="text-fg-2 font-normal">· {cycle.fieldPartName}</span>}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <CropTag name={cycle.cropName} color={cycle.cropColor} />
            <CropRoleBadge role={cycle.role} />
            <span className="text-muted">· {cycle.seasonName} · {fmt.ha(cycle.areaHa)}{f.identifier ? ` · ${f.identifier}` : ''}</span>
            <CropCycleStatusBadge status={cycle.status} />
          </span>
        }
        actions={
          <>
            <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: f.id }} variant="secondary">
              <ExternalLink /> {t('cultivation.fieldRecord')}
            </Link>
            {can('crop.write') && (
              <Button onPress={() => setEditOpen(true)}>
                <Pencil /> {t('cultivation.editCrop')}
              </Button>
            )}
          </>
        }
      />

      {siblings.length > 1 && (
        <div className="mb-4">
          <SegmentedControl
            aria-label={t('cultivation.cropsOnField')}
            items={siblings.map((c) => ({ id: c.id, label: <><CropTag name={c.cropName} color={c.cropColor} />{c.role !== 'main' && <span className="text-xs text-muted">{cropRoleLabel(c.role)}</span>}</> }))}
            value={cycle.id}
            onChange={(id) => navigate({ to: '/o/$orgId/crops/$cropCycleId', params: { orgId, cropCycleId: id }, search: (prev) => prev })}
          />
        </div>
      )}

      <div className={tab === 'yield' ? 'grid gap-6' : 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] items-start'}>
        <Tabs className="min-w-0" selectedKey={tab} onSelectionChange={(key) => setSearch({ tab: key === 'info' ? undefined : (key as CultivationTab) })}>
          <TabList aria-label={t('cultivation.tabs.label')}>
            <Tab id="info">{t('cultivation.tabs.info')}</Tab>
            <Tab id="operations">{t('cultivation.tabs.operations')}</Tab>
            <Tab id="zones">{t('cultivation.tabs.zones')}</Tab>
            <Tab id="yield">{t('cultivation.tabs.yield')}</Tab>
          </TabList>
          <TabPanel id="info">
            <div className="space-y-6">
              <CultivationInfo cycle={cycle} field={f} operations={operations} onEdit={can('crop.write') ? () => setEditOpen(true) : undefined} />
              <GrasslandPrediction cycleId={cycle.id} />
            </div>
          </TabPanel>
          <TabPanel id="operations">
            <CultivationOperations
              cycle={cycle}
              field={f}
              operations={operations}
              isLoading={allOperations.isLoading}
              view={search.view ?? 'actual'}
              onView={(v) => setSearch({ view: v === 'actual' ? undefined : v })}
            />
          </TabPanel>
          <TabPanel id="zones">
            <ZoneOptimization
              cycle={cycle}
              field={f}
              operations={operations.filter((o) => o.status !== 'canceled')}
              productivity={productivity}
              maps={maps.data ?? []}
              zonings={zonings}
              zoning={zoning}
              onZoning={setZoningId}
              category={search.category ?? 'fertilization'}
              onCategory={(c) => setSearch({ category: c === 'fertilization' ? undefined : c })}
              onFocus={setFocus}
            />
          </TabPanel>
          <TabPanel id="yield">
            <CropCycleYield cycle={cycle} field={f} />
          </TabPanel>
        </Tabs>

        {tab !== 'yield' && (
          <aside className="order-first xl:order-none xl:sticky xl:top-4 space-y-3">
            <MapPreview field={f} part={part} zoning={tab === 'zones' ? zoning : null} focus={tab === 'zones' ? focus : null} />
          </aside>
        )}
      </div>

      {editOpen && <EditCycleDialog cycle={cycle} onClose={() => setEditOpen(false)} />}
    </>
  )
}

/** The field (and its part) on the map; in the optimization its zones, with the rates of the line in focus. */
function MapPreview({ field, part, zoning, focus }: { field: Field; part: FieldPart | null; zoning: Zoning | null; focus: ZoneFocus | null }) {
  const { t } = useTranslation()
  const overlay = useMemo<FeatureCollection | null>(
    () =>
      zoning
        ? {
            type: 'FeatureCollection',
            features: zoning.zones.map((z) => ({ type: 'Feature', geometry: z.geometry, properties: { color: zoneColor(z.zoneNo, zoning.zoneCount), zone: z.zoneNo } })),
          }
        : null,
    [zoning],
  )
  return (
    <Card padded={false} className="overflow-hidden">
      <FieldMap
        fields={[field]}
        selectedId={part ? null : field.id}
        highlight={part?.geometry ?? null}
        overlay={overlay}
        fillOpacity={overlay ? 0 : 0.32}
        labels={false}
        className="h-72 xl:h-[26rem]"
      />
      {zoning ? (
        <div className="p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
            <span>{t('cultivation.map.zones', { count: zoning.zoneCount })}</span>
            {focus && <span className="truncate text-fg-2 font-medium" title={focus.label}>{focus.label}</span>}
          </div>
          <ul className="space-y-1 text-sm">
            {[...zoning.zones].reverse().map((z) => (
              <li key={z.zoneNo} className="flex items-center gap-2">
                <span className="size-3 rounded-sm shrink-0" style={{ background: zoneColor(z.zoneNo, zoning.zoneCount) }} aria-hidden />
                <span className="flex-1 min-w-0 truncate">
                  {t('cultivation.zone', { number: z.zoneNo })}
                  {zoneName(z.zoneNo, zoning.zoneCount) && <span className="text-muted"> · {zoneName(z.zoneNo, zoning.zoneCount)}</span>}
                </span>
                <span className="tabular text-xs text-muted">{fmt.ha(z.areaHa, 1)}</span>
                <span className="tabular w-24 text-right">
                  {focus ? `${fmt.num(focus.rates[String(z.zoneNo)], 1)} ${focus.unit}` : fmt.pct(z.relativeProductivity)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-muted flex justify-between gap-2">
          <span>{part ? part.name : field.farmName}</span>
          <span className="tabular">{fmt.ha(part?.areaHa ?? field.areaHa)}</span>
        </div>
      )}
    </Card>
  )
}
