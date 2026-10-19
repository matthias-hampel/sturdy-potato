import { YIELD_RAMP, type YieldMapSource, type YieldRaster } from '@agmeo/contracts'
import { useTranslation } from 'react-i18next'
import { ColumnChart } from '#/components/charts'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { Badge, type BadgeTone } from '#/ui/Layout'

/** XYZ tile template of a merged yield raster, coloured over `range` [t/ha]. */
export function yieldTiles(orgId: string, rasterId: string, range: [number, number]) {
  const query = new URLSearchParams({ min: String(range[0]), max: String(range[1]) })
  return `${window.location.origin}/api/v1/orgs/${orgId}/yield-maps/rasters/${rasterId}/tiles/{z}/{x}/{y}.png?${query}`
}

/** Yield rate in the organization's unit. */
export const fmtYield = (v: number | null | undefined, digits = 1) => fmt.measure(v, 'yieldMass', { digits })
export const fmtTonnes = (v: number | null | undefined) => (v == null ? '—' : `${fmt.num(v, v >= 100 ? 0 : 1)} t`)

/** Colour ramp of the map with the stretch's ends. */
export function YieldLegend({ range, note }: { range: [number, number]; note?: string }) {
  return (
    <div className="space-y-1">
      <div className="h-2.5 rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(to right, ${YIELD_RAMP.join(', ')})` }} aria-hidden />
      <div className="flex justify-between text-xs text-muted tabular">
        <span>{fmtYield(range[0])}</span>
        {note && <span className="truncate px-2">{note}</span>}
        <span>{fmtYield(range[1])}</span>
      </div>
    </div>
  )
}

const STATUS_TONE: Record<YieldMapSource['status'], BadgeTone> = { ok: 'success', pending_parse: 'info', pending_download: 'info', failed: 'danger', skipped: 'neutral' }

export function sourceStatusLabel(status: YieldMapSource['status']) {
  if (status === 'ok') return t('yield.status.ok')
  if (status === 'failed') return t('yield.status.failed')
  if (status === 'skipped') return t('yield.status.skipped')
  return t('yield.status.pending')
}

export function SourceStatusBadge({ status }: { status: YieldMapSource['status'] }) {
  return <Badge tone={STATUS_TONE[status]}>{sourceStatusLabel(status)}</Badge>
}

export function exclusionLabel(reason: YieldMapSource['excludedReason']) {
  switch (reason) {
    case 'duplicate':
      return t('yield.reason.duplicate')
    case 'implausible':
      return t('yield.reason.implausible')
    case 'no_overlap':
      return t('yield.reason.no_overlap')
    case 'user':
      return t('yield.reason.user')
    default:
      return null
  }
}

export function providerLabel(provider: YieldMapSource['provider']) {
  switch (provider) {
    case 'johndeere':
      return 'John Deere'
    case 'claas':
      return 'CLAAS'
    case 'agco':
      return 'PTx FarmENGAGE'
    case 'nextfarming':
      return 'NEXT Farming'
    default:
      return t('yield.provider.upload')
  }
}

export function formatLabel(format: YieldMapSource['format']) {
  switch (format) {
    case 'isoxml':
      return 'ISO-XML'
    case 'aft':
      return 'AGRO-MAP .aft'
    case 'pointdata':
      return 'GeoJSON'
    case 'flow_channels':
      return t('yield.format.flow')
    case 'mass_per_area':
      return 'Shapefile'
    default:
      return '—'
  }
}

/** Why the map figure was not taken over as the documented yield. */
export function writebackText(w: YieldRaster['writeback']) {
  if (w.status === 'filled') return t('yield.writeback.filled')
  switch (w.reason) {
    case 'already-documented':
      return t('yield.writeback.alreadyDocumented')
    case 'multi-cut':
      return t('yield.writeback.multiCut')
    case 'partial-coverage':
      return t('yield.writeback.partial')
    case 'no-date':
      return t('yield.writeback.noDate')
    default:
      return w.reason ? t('yield.writeback.skipped') : null
  }
}

/** Distribution of the map's pixels. */
export function YieldHistogram({ raster }: { raster: YieldRaster }) {
  const { t } = useTranslation()
  if (!raster.histogram.length) return null
  return (
    <ColumnChart
      ariaLabel={t('yield.histogram')}
      height={160}
      series={[{ name: t('yield.pixels'), color: 'var(--color-series-1)' }]}
      format={(v) => fmt.num(v)}
      data={raster.histogram.map((b) => ({
        key: String(b.binStart),
        label: fmt.num(b.binStart, 1),
        values: [b.count],
        tooltip: (
          <span className="tabular">
            {fmt.num(b.binStart, 1)}–{fmtYield(b.binEnd)}: {t('yield.pixelCount', { count: b.count })}
          </span>
        ),
      }))}
    />
  )
}
