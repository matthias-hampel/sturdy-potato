import type { LabApplyResult, LabPreview } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { DropZone, FileTrigger, type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { Button } from '#/ui/Button'
import { Checkbox } from '#/ui/Field'
import { Badge, Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'
import { paramLabel } from './soilLabels'

const ACCEPTED = ['.csv', '.txt', '.xlsx', '.zip', 'text/csv', 'application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']

const form = (files: File[], fieldIds?: string[]) => {
  const data = new FormData()
  data.append('names', JSON.stringify(files.map((f) => f.name)))
  if (fieldIds) data.append('fieldIds', JSON.stringify(fieldIds))
  for (const f of files) data.append('files', f, 'upload')
  return data
}

/**
 * Lab result upload (reference: UploadLabResultsModal): the lab's CSV, XLSX or returned
 * Probenkarte is matched to the sampling zones by probe number or location; the chosen fields
 * get the values on their zones and a soil sample for nutrient planning.
 */
export function UploadLabResultsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<LabPreview | null>(null)
  const [selection, setSelection] = useState<Selection>('all')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LabApplyResult | null>(null)

  const reset = () => {
    setFiles([])
    setPreview(null)
    setResult(null)
    setSelection('all')
  }
  const load = async (picked: File[]) => {
    if (!picked.length) return
    const all = [...files, ...picked.filter((p) => !files.some((f) => f.name === p.name && f.size === p.size))]
    setFiles(all)
    setBusy(true)
    try {
      setPreview(await api.upload<LabPreview>(`/orgs/${orgId}/soil/lab-results/preview`, form(all)))
      setSelection('all')
    } catch (e) {
      toast.error(t('soil.lab.previewFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    if (!preview) return
    const ids = selection === 'all' ? preview.fields.map((f) => f.fieldId) : [...selection].map(String)
    setBusy(true)
    try {
      const r = await api.upload<LabApplyResult>(`/orgs/${orgId}/soil/lab-results`, form(files, ids))
      setResult(r)
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
      const ok = r.results.filter((x) => x.status === 'success').length
      if (ok) toast.success(t('soil.lab.applied', { count: ok }))
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const selectedCount = preview ? (selection === 'all' ? preview.fields.length : selection.size) : 0

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) reset()
        onOpenChange(open)
      }}
      size="xl"
      title={t('soil.lab.title')}
      description={t('soil.lab.description')}
      footer={(close) =>
        result ? (
          <Button variant="primary" onPress={close}>
            {t('soil.done')}
          </Button>
        ) : (
          <>
            <Button onPress={close}>{t('common.cancel')}</Button>
            <Button variant="primary" isDisabled={!selectedCount} isPending={busy && !!preview} onPress={apply}>
              {t('soil.lab.apply', { count: selectedCount })}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {result.results.map((r) => (
            <li key={r.fieldId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>{r.fieldName}</span>
              {r.status === 'success' ? <Badge tone="success">{t('soil.lab.probesWritten', { count: r.probeCount ?? 0 })}</Badge> : <Badge tone="danger">{r.reason}</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <DropZone
            onDrop={async (e) => {
              const picked = await Promise.all(e.items.filter((i) => i.kind === 'file').map((i) => (i as { getFile: () => Promise<File> }).getFile()))
              await load(picked)
            }}
            className={cx('rounded-xl border-2 border-dashed border-line-strong p-5 text-center outline-none drop-target:border-primary drop-target:bg-primary-soft')}
          >
            <FileUp className="size-7 text-muted mx-auto" aria-hidden />
            <p className="text-sm mt-2">{t('soil.lab.drop')}</p>
            <FileTrigger allowsMultiple acceptedFileTypes={ACCEPTED} onSelect={(list) => list && load([...list])}>
              <Button size="sm" className="mt-2" isPending={busy && !preview}>
                {t('soil.lab.choose')}
              </Button>
            </FileTrigger>
            <p className="text-xs text-muted mt-3">{t('soil.lab.formats')}</p>
          </DropZone>

          {preview && (
            <>
              <p className="text-sm text-fg-2">
                {t('soil.lab.summary', { rows: preview.rowCount, files: preview.fileNames.length })}
                {preview.duplicateRows > 0 && ` · ${t('soil.lab.duplicates', { count: preview.duplicateRows })}`}
              </p>
              {preview.rejectedFiles.map((f) => (
                <Notice key={f.fileName} tone="danger">
                  {f.fileName}: {t(`soil.lab.rejected.${f.reason}`)}
                </Notice>
              ))}
              {preview.failedFileNames.length > 0 && <Notice tone="danger">{t('soil.lab.failed', { names: preview.failedFileNames.join(', ') })}</Notice>}
              {preview.fields.length > 0 ? (
                <Table aria-label={t('soil.lab.fields')} selectionMode="multiple" selectedKeys={selection} onSelectionChange={setSelection}>
                  <TableHeader>
                    <Column className="w-10">
                      <Checkbox slot="selection" />
                    </Column>
                    <Column isRowHeader>{t('soil.page.field')}</Column>
                    <Column align="end">{t('soil.page.col.probes')}</Column>
                    <Column>{t('soil.lab.params')}</Column>
                    <Column>{t('soil.lab.status')}</Column>
                  </TableHeader>
                  <TableBody items={preview.fields.map((f) => ({ ...f, id: f.fieldId }))}>
                    {(f) => (
                      <Row id={f.id}>
                        <Cell>
                          <Checkbox slot="selection" />
                        </Cell>
                        <Cell>
                          {f.fieldName}
                          <span className="block text-xs text-muted">{fmt.ha(f.fieldAreaHa)}</span>
                        </Cell>
                        <Cell align="end">
                          {f.probes.length}
                          {f.probes.some((p) => p.match === 'location') && <span className="block text-xs text-muted">{t('soil.lab.byLocation')}</span>}
                        </Cell>
                        <Cell>{f.params.map(paramLabel).join(', ')}</Cell>
                        <Cell>
                          {f.alreadyImported ? (
                            <Badge tone="neutral">{t('soil.lab.alreadyImported')}</Badge>
                          ) : f.storedSampleDate ? (
                            <Badge tone="warning">{t('soil.lab.overwrites', { date: fmt.date(f.storedSampleDate) })}</Badge>
                          ) : (
                            <Badge tone="success">{t('soil.lab.new')}</Badge>
                          )}
                        </Cell>
                      </Row>
                    )}
                  </TableBody>
                </Table>
              ) : (
                <Notice tone="warning">{t('soil.lab.noMatches')}</Notice>
              )}
              {preview.unmatched.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-fg">{t('soil.lab.unmatched', { count: preview.unmatched.length })}</p>
                  <p className="text-xs text-muted">{t('soil.lab.unmatchedHint')}</p>
                  <ul className="text-xs text-fg-2 max-h-32 overflow-y-auto">
                    {preview.unmatched.map((r, i) => (
                      <li key={i}>
                        {r.probeNr != null ? `${t('soil.export.zonationPdf.probe')} ${r.probeNr}` : t('soil.lab.noProbeNr')}
                        {r.fieldNameHint && ` · ${r.fieldNameHint}`} · {fmt.date(r.date)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </ModalDialog>
  )
}
