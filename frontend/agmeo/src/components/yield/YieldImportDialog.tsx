import type { CropCycle, YieldMapInspection, YieldMapSource } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileUp, Loader2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FileTrigger } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, DatePicker, Option, Select, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { formatLabel, fmtYield } from './shared'

type Phase = 'inspected' | 'importing' | 'done' | 'failed'

interface Entry {
  inspection: YieldMapInspection
  selected: Set<string>
  /** Crop cycles added by hand (not matched by the points). */
  extra: string[]
  harvestedOn: string | null
  machineLabel: string
  phase: Phase
  error: string | null
}

/** Matches below this share are listed but not pre-selected. */
const PRESELECT_SHARE = 0.2

/**
 * Yield-map import: upload harvest-monitor exports (ISO-XML TASKDATA, AGRO-MAP .aft,
 * shapefile or GeoJSON zips), see what was read and which fields each one covers, confirm the
 * assignment, and hand them to the worker. `cropCycleId` pre-selects a crop cycle (the
 * import from a crop's yield tab).
 */
export function YieldImportDialog({ isOpen, onClose, cropCycleId }: { isOpen: boolean; onClose: () => void; cropCycleId?: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasonId, season } = useSeason()
  const qc = useQueryClient()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId }, { enabled: isOpen && !!seasonId })
  const [entries, setEntries] = useState<Entry[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const cycleOptions = useMemo(() => (cycles.data ?? []).filter((c) => c.role === 'main').map((c) => ({ id: c.id, name: `${c.fieldName} · ${c.cropName}`, cycle: c })), [cycles.data])

  const reset = () => {
    setEntries([])
    setUploadError(null)
  }
  const close = () => {
    if (entries.some((e) => e.phase === 'done')) void qc.invalidateQueries({ queryKey: ['org', orgId] })
    reset()
    onClose()
  }

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    const files = [...list]
    const invalid = files.find((f) => !/\.(zip|aft)$/i.test(f.name))
    if (invalid) {
      setUploadError(t('yield.import.invalidType'))
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('names', JSON.stringify(files.map((f) => f.name)))
      if (seasonId) form.append('seasonId', seasonId)
      if (season) form.append('year', String(season.harvestYear))
      for (const f of files) form.append('files', f, f.name)
      const inspections = await api.upload<YieldMapInspection[]>(`/orgs/${orgId}/yield-maps/upload`, form)
      setEntries((prev) => [
        ...prev,
        ...inspections.map((inspection) => {
          const selected = new Set(inspection.matches.filter((m) => m.share >= PRESELECT_SHARE).map((m) => m.cropCycleId))
          if (cropCycleId) selected.add(cropCycleId)
          const extra = cropCycleId && !inspection.matches.some((m) => m.cropCycleId === cropCycleId) ? [cropCycleId] : []
          return { inspection, selected, extra, harvestedOn: null, machineLabel: '', phase: 'inspected' as Phase, error: null }
        }),
      ])
    } catch (e) {
      setUploadError(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const update = (fileId: string, patch: Partial<Entry>) => setEntries((prev) => prev.map((e) => (e.inspection.fileId === fileId ? { ...e, ...patch } : e)))

  const importAll = async () => {
    let imported = 0
    for (const entry of entries) {
      if (entry.phase !== 'inspected' || entry.selected.size === 0) continue
      update(entry.inspection.fileId, { phase: 'importing', error: null })
      try {
        await api.post<YieldMapSource[]>(`/orgs/${orgId}/yield-maps/sources`, {
          fileId: entry.inspection.fileId,
          cropCycleIds: [...entry.selected],
          harvestedOn: entry.harvestedOn,
          machineLabel: entry.machineLabel || null,
        })
        update(entry.inspection.fileId, { phase: 'done' })
        imported++
      } catch (e) {
        update(entry.inspection.fileId, { phase: 'failed', error: errorMessage(e) })
      }
    }
    if (imported) {
      toast.success(t('yield.import.queued', { count: imported }))
      void qc.invalidateQueries({ queryKey: ['org', orgId] })
    }
  }

  const ready = entries.filter((e) => e.phase === 'inspected' && e.selected.size > 0)
  const allDone = entries.length > 0 && entries.every((e) => e.phase === 'done' || e.phase === 'failed' || e.selected.size === 0)

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && close()}
      size="lg"
      title={t('yield.import.title')}
      description={t('yield.import.description')}
      footer={() => (
        <>
          <Button onPress={close}>{allDone ? t('common.close') : t('common.cancel')}</Button>
          {!allDone && (
            <Button variant="primary" isDisabled={!ready.length} onPress={importAll}>
              {t('yield.import.submit', { count: ready.length })}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        <FileTrigger acceptedFileTypes={['.zip', '.aft', 'application/zip']} allowsMultiple onSelect={(list) => void onFiles(list)}>
          <Button isPending={uploading} variant={entries.length ? 'secondary' : 'primary'}>
            <FileUp /> {uploading ? t('yield.import.uploading') : t('yield.import.choose')}
          </Button>
        </FileTrigger>
        <p className="text-xs text-muted">{t('yield.import.formats')}</p>
        {uploadError && <Notice tone="danger">{uploadError}</Notice>}

        {entries.map((entry) => (
          <InspectionCard
            key={entry.inspection.fileId}
            entry={entry}
            cycleOptions={cycleOptions}
            onChange={(patch) => update(entry.inspection.fileId, patch)}
          />
        ))}
      </div>
    </ModalDialog>
  )
}

function InspectionCard({
  entry,
  cycleOptions,
  onChange,
}: {
  entry: Entry
  cycleOptions: { id: string; name: string; cycle: CropCycle }[]
  onChange: (patch: Partial<Entry>) => void
}) {
  const { t } = useTranslation()
  const i = entry.inspection
  const editable = entry.phase === 'inspected'
  const matched = new Set(i.matches.map((m) => m.cropCycleId))
  const extraCycles = entry.extra.map((id) => cycleOptions.find((o) => o.id === id)?.cycle).filter((c): c is CropCycle => !!c)
  const toggle = (id: string, on: boolean) => {
    const next = new Set(entry.selected)
    if (on) next.add(id)
    else next.delete(id)
    onChange({ selected: next })
  }

  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-start gap-3">
        <PhaseIcon phase={entry.phase} hasError={!!i.error} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{i.fileName}</div>
          {i.error ? (
            <div className="text-sm text-danger">{i.error === 'too_large_to_inspect' ? t('yield.import.tooLarge') : i.error}</div>
          ) : (
            <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{formatLabel(i.format)}</span>
              <span>{t('yield.import.points', { count: i.pointCount })}</span>
              <span>Ø {fmtYield(i.meanRateTHa)}</span>
              {i.harvestedFrom && <span>{t('yield.import.harvested', { date: fmt.date(i.harvestedFrom) })}</span>}
              {i.crs && <span>{i.crs}</span>}
            </div>
          )}
        </div>
        <span className="text-xs text-muted tabular">{fmt.num(i.sizeBytes / 1024 / 1024, 1)} MB</span>
      </div>

      {i.plausible === false && (
        <Notice tone="warning" icon={AlertTriangle}>
          {t('yield.import.implausible')} {i.note}
        </Notice>
      )}
      {entry.error && <Notice tone="danger">{entry.error}</Notice>}
      {entry.phase === 'done' && <Notice tone="success">{t('yield.import.done')}</Notice>}

      {editable && (
        <>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t('yield.import.fields')}</div>
            {i.matches.length === 0 && !extraCycles.length && <p className="text-sm text-muted">{t('yield.import.noMatch')}</p>}
            {i.matches.map((m) => (
              <Checkbox key={m.cropCycleId} isSelected={entry.selected.has(m.cropCycleId)} onChange={(on) => toggle(m.cropCycleId, on)}>
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{m.fieldName}</span>
                  <CropTag name={m.cropName} />
                  <span className="text-xs text-muted tabular">
                    {fmt.ha(m.areaHa, 1)} · {t('yield.import.share', { pct: fmt.num(m.share * 100) })}
                  </span>
                </span>
              </Checkbox>
            ))}
            {extraCycles.map((c) => (
              <Checkbox key={c.id} isSelected={entry.selected.has(c.id)} onChange={(on) => toggle(c.id, on)}>
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{c.fieldName}</span>
                  <CropTag name={c.cropName} color={c.cropColor} />
                  <span className="text-xs text-muted">{t('yield.import.manual')}</span>
                </span>
              </Checkbox>
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <Select
              label={t('yield.import.addField')}
              items={cycleOptions.filter((o) => !matched.has(o.id) && !entry.extra.includes(o.id))}
              value={null}
              onChange={(id) => {
                if (!id) return
                const next = new Set(entry.selected)
                next.add(String(id))
                onChange({ extra: [...entry.extra, String(id)], selected: next })
              }}
              placeholder={t('yield.import.addFieldPlaceholder')}
            >
              {(o) => <Option id={o.id}>{o.name}</Option>}
            </Select>
            {!i.harvestedFrom && (
              <DatePicker label={t('yield.import.harvestDate')} value={entry.harvestedOn} onChange={(d) => onChange({ harvestedOn: d })} description={t('yield.import.harvestDateHint')} />
            )}
            <TextField label={t('yield.import.machine')} value={entry.machineLabel} onChange={(v) => onChange({ machineLabel: v })} placeholder={t('yield.import.machinePlaceholder')} />
          </div>
        </>
      )}
    </div>
  )
}

function PhaseIcon({ phase, hasError }: { phase: Phase; hasError: boolean }) {
  if (phase === 'importing') return <Loader2 className="size-5 animate-spin text-muted shrink-0" aria-hidden />
  if (phase === 'done') return <CheckCircle2 className="size-5 text-success shrink-0" aria-hidden />
  if (phase === 'failed' || hasError) return <XCircle className="size-5 text-danger shrink-0" aria-hidden />
  return <FileUp className="size-5 text-muted shrink-0" aria-hidden />
}
