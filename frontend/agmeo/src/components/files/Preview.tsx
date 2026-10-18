import { fileKind, type FileItem } from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { Button } from '#/ui/Button'
import { ErrorNotice, Loading } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

const MAX_ROWS = 500

interface Sheet {
  name: string
  rows: string[][]
  truncated: boolean
}

/** Splits CSV/TSV text, honouring quotes; the delimiter is guessed from the first line. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const first = text.slice(0, text.indexOf('\n') >>> 0)
  const sep = delimiter ?? [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length > MAX_ROWS) break
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows
}

async function readSheets(file: FileItem, blob: Blob): Promise<Sheet[]> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'xlsx') {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    return (await readXlsxFile(blob)).map(({ sheet, data }) => {
      const rows = data.map((r) => r.map((v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))))
      return { name: sheet, rows: rows.slice(0, MAX_ROWS + 1), truncated: rows.length > MAX_ROWS + 1 }
    })
  }
  const rows = parseDelimited(await blob.text(), ext === 'tsv' ? '\t' : undefined)
  return [{ name: file.name, rows: rows.slice(0, MAX_ROWS + 1), truncated: rows.length > MAX_ROWS + 1 }]
}

function useBlob(file: FileItem) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: ['file-blob', orgId, file.id],
    queryFn: async () => new Blob([await api.blob(`/orgs/${orgId}/files/${file.id}/content`)], { type: file.mimeType }),
    staleTime: 5 * 60_000,
  })
}

function TablePreview({ file }: { file: FileItem }) {
  const { t } = useTranslation()
  const blob = useBlob(file)
  const sheets = useQuery({ queryKey: ['file-sheets', file.id], queryFn: () => readSheets(file, blob.data!), enabled: !!blob.data })
  const [active, setActive] = useState(0)
  if (blob.error || sheets.error) return <ErrorNotice error={blob.error ?? sheets.error} />
  if (!sheets.data) return <Loading />
  const sheet = sheets.data[active] ?? sheets.data[0]
  return (
    <div className="space-y-3">
      {sheets.data.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {sheets.data.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cx('rounded-full border px-3 py-1 text-xs', i === active ? 'bg-primary text-primary-fg border-primary' : 'border-line text-fg-2 hover:bg-surface-2')}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <p className="text-sm text-muted">{t('files.preview.emptySheet')}</p>
      ) : (
        <div className="overflow-auto max-h-[65vh] border border-line rounded-lg">
          <table className="text-xs tabular border-collapse">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {sheet.rows[0].map((h, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-semibold border-b border-line whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(1, MAX_ROWS + 1).map((r, i) => (
                <tr key={i} className="odd:bg-surface even:bg-surface-2/40">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1 border-b border-line/60 whitespace-nowrap max-w-80 truncate">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sheet.truncated && <p className="text-xs text-muted">{t('files.preview.truncated', { count: MAX_ROWS })}</p>}
    </div>
  )
}

function MediaPreview({ file }: { file: FileItem }) {
  const blob = useBlob(file)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob.data) return
    const u = URL.createObjectURL(blob.data)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob.data])
  if (blob.error) return <ErrorNotice error={blob.error} />
  if (!url) return <Loading />
  return fileKind(file.name) === 'pdf' ? (
    <iframe title={file.name} src={url} className="w-full h-[75vh] rounded-lg border border-line bg-white" />
  ) : (
    <img src={url} alt={file.name} className="max-h-[75vh] max-w-full mx-auto rounded-lg" />
  )
}

/** Shows tables, images and PDFs in a dialog; other files only download. */
export function PreviewDialog({ file, onClose, onDownload }: { file: FileItem; onClose: () => void; onDownload: () => void }) {
  const { t } = useTranslation()
  const kind = fileKind(file.name)
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={file.name} size="xl" footer={() => <Button onPress={onDownload}><Download /> {t('files.action.download')}</Button>}>
      {kind === 'table' ? <TablePreview file={file} /> : <MediaPreview file={file} />}
    </ModalDialog>
  )
}

export const canPreview = (name: string) => ['table', 'image', 'pdf'].includes(fileKind(name))
