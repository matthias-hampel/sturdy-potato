import type { FieldObservation, ImageryDate } from '@agmeo/contracts'
import { Copy, Download } from 'lucide-react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useTranslation } from 'react-i18next'
import { saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Card, DescriptionList } from '#/ui/Layout'
import { toast } from '#/ui/Toast'
import { INDEX_INFO, type ShownIndex } from './indices'

/**
 * The map as a PNG. Read inside a 'render' event, while WebGL still holds the frame,
 * so the map needs no preserved drawing buffer.
 */
export function snapshotMap(map: MapLibreMap): Promise<Blob> {
  return new Promise((resolve, reject) => {
    map.once('render', () => {
      map.getCanvas().toBlob((blob) => (blob ? resolve(blob) : reject(new Error('empty canvas'))), 'image/png')
    })
    map.triggerRepaint()
  })
}

/** Statistics of one satellite scene over the field, with copy and download of the shown map image. */
export function SceneStats({
  fieldId,
  fieldName,
  index,
  layerLabel,
  date,
  map,
}: {
  fieldId: string
  fieldName: string
  index: ShownIndex
  layerLabel: string
  date: ImageryDate | null
  map: MapLibreMap | null
}) {
  const { t } = useTranslation()
  const obs = useOrgQuery<FieldObservation[]>(`/monitoring/fields/${fieldId}/observations`, { index })
  const row = date ? obs.data?.find((o) => o.observedOn === date.date) : undefined
  const digits = index === 'lai' ? 1 : 2
  const clear = row?.validPixelPct ?? date?.clearPct ?? null
  const filename = `${slug(fieldName)}-${slug(layerLabel)}-${date?.date ?? 'map'}.png`

  const download = async () => {
    if (!map) return
    saveBlob(await snapshotMap(map), filename)
  }
  const copy = async () => {
    if (!map) return
    try {
      // Safari needs the clipboard item created synchronously inside the click, so the blob is passed as a promise.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': snapshotMap(map) })])
      toast.success(t('fieldPage.satellite.copied'))
    } catch {
      await download()
      toast.info(t('fieldPage.satellite.copyFallback'))
    }
  }

  return (
    <Card
      title={t('fieldPage.satellite.scene', { date: date ? fmt.date(date.date) : '—' })}
      actions={
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onPress={copy} isDisabled={!map || !date} aria-label={t('fieldPage.satellite.copyImage')}>
            <Copy className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onPress={download} isDisabled={!map || !date} aria-label={t('fieldPage.satellite.downloadImage')}>
            <Download className="size-4" />
          </Button>
        </div>
      }
    >
      <DescriptionList
        items={[
          { label: t('fieldPage.satellite.stat.index'), value: INDEX_INFO[index].label },
          { label: t('fieldPage.satellite.stat.mean'), value: row ? fmt.fixed(row.mean, digits) : null },
          { label: t('fieldPage.satellite.stat.median'), value: row ? fmt.fixed(row.median, digits) : null },
          { label: t('fieldPage.satellite.stat.stddev'), value: row ? fmt.fixed(row.stddev, digits) : null },
          { label: t('fieldPage.satellite.stat.p20'), value: row?.p20 != null ? fmt.fixed(row.p20, digits) : null },
          { label: t('fieldPage.satellite.stat.p80'), value: row?.p80 != null ? fmt.fixed(row.p80, digits) : null },
          { label: t('fieldPage.satellite.stat.cloud'), value: clear != null ? fmt.pct(100 - clear) : null },
        ]}
      />
      {date && !row && !obs.isLoading && <p className="mt-3 text-xs text-muted">{t('fieldPage.satellite.stat.none')}</p>}
    </Card>
  )
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
