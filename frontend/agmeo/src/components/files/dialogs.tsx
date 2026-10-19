import type { FileItem, FolderItem, StorageUsage, TrashItem } from '@agmeo/contracts'
import { Folder, FolderOpen, Home, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Form } from 'react-aria-components'
import { LOCALE } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { EmptyState, Loading } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { formatBytes } from './upload'

/** New folder or folder rename. */
export function FolderNameDialog({ folder, parentId, onClose }: { folder?: FolderItem; parentId: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(folder?.name ?? '')
  const save = useOrgMutation(
    (base, _: void) => (folder ? api.patch(`${base}/files/folders/${folder.id}`, { name }) : api.post(`${base}/files/folders`, { name, parentId })),
    { onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={folder ? t('files.folder.rename') : t('files.folder.new')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} validate={(v) => (/[/\\]/.test(v) ? t('files.folder.invalidName') : null)} />
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

const splitExt = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/** Name (the extension stays), description and harvest year of a file. */
export function EditFileDialog({ file, years, onClose }: { file: FileItem; years: number[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [base, ext] = splitExt(file.name)
  const [name, setName] = useState(base)
  const [description, setDescription] = useState(file.description ?? '')
  const [year, setYear] = useState<number | null>(file.year)
  const options = [...new Set([...(file.year ? [file.year] : []), ...years])].sort((a, b) => b - a)
  const save = useOrgMutation((path, _: void) => api.patch(`${path}/files/${file.id}`, { name: `${name.trim()}${ext}`, description: description.trim() || null, year }), { onSuccess: onClose })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('files.edit.title')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} description={ext ? t('files.edit.extension', { ext }) : undefined} validate={(v) => (/[/\\]/.test(v) ? t('files.folder.invalidName') : null)} />
        <TextField label={t('files.column.description')} multiline value={description} onChange={setDescription} />
        <Select label={t('files.column.year')} items={[{ id: 'none', name: t('files.edit.noYear') }, ...options.map((y) => ({ id: String(y), name: String(y) }))]} value={year ? String(year) : 'none'} onChange={(v) => setYear(v && v !== 'none' ? Number(v) : null)}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

/** Choose a target folder from the tree; the moved folders and their subfolders are not offered. */
export function MoveDialog({ folderIds, onMove, onClose, title }: { folderIds: string[]; onMove: (target: string | null) => Promise<unknown>; onClose: () => void; title: string }) {
  const { t } = useTranslation()
  const folders = useOrgQuery<FolderItem[]>('/files/folders')
  const [target, setTarget] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const children = new Map<string | null, FolderItem[]>()
  for (const f of folders.data ?? []) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f])
  const excluded = new Set(folderIds)
  const renderLevel = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? [])
      .filter((f) => !excluded.has(f.id))
      .map((f) => (
        <div key={f.id}>
          <button type="button" onClick={() => setTarget(f.id)} style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }} className={cx('w-full flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm text-left', target === f.id ? 'bg-primary text-primary-fg' : 'hover:bg-surface-2')}>
            {target === f.id ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0 text-muted" />}
            <span className="truncate">{f.name}</span>
          </button>
          {renderLevel(f.id, depth + 1)}
        </div>
      ))
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isPending={pending} onPress={async () => { setPending(true); try { await onMove(target); close() } finally { setPending(false) } }}>{t('files.move.here')}</Button>
        </>
      )}
    >
      {folders.isPending ? <Loading /> : (
        <div className="max-h-[50vh] overflow-y-auto border border-line rounded-lg p-1">
          <button type="button" onClick={() => setTarget(null)} className={cx('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left', target === null ? 'bg-primary text-primary-fg' : 'hover:bg-surface-2')}>
            <Home className="size-4 shrink-0" /> {t('files.root')}
          </button>
          {renderLevel(null, 1)}
        </div>
      )}
    </ModalDialog>
  )
}

export function TrashDialog({ canWrite, onClose }: { canWrite: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const trash = useOrgQuery<TrashItem[]>('/files/trash')
  const usage = useOrgQuery<StorageUsage>('/files/storage')
  const restore = useOrgMutation((base, item: TrashItem) => api.post(`${base}/files/trash/restore`, item.kind === 'file' ? { fileIds: [item.id] } : { folderIds: [item.id] }), { success: t('files.trash.restored') })
  const empty = useOrgMutation((base, _: void) => api.delete<{ deleted: number }>(`${base}/files/trash`), { success: t('files.trash.emptied') })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('files.trash.title')} description={usage.data ? t('files.trash.reclaimable', { size: formatBytes(usage.data.trashBytes, LOCALE) }) : undefined} size="md"
      footer={(close) => (
        <>
          {canWrite && (trash.data?.length ?? 0) > 0 && (
            <ConfirmButton title={t('files.trash.emptyTitle')} message={t('files.trash.emptyMessage')} confirmLabel={t('files.trash.empty')} onConfirm={() => empty.mutateAsync()} trigger={<Button variant="danger"><Trash2 /> {t('files.trash.empty')}</Button>} />
          )}
          <div className="flex-1" />
          <Button onPress={close}>{t('common.close')}</Button>
        </>
      )}
    >
      {trash.isPending ? <Loading /> : !trash.data?.length ? (
        <EmptyState icon={Trash2} title={t('files.trash.emptyState')} />
      ) : (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {trash.data.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex items-center gap-3 px-3 py-2">
              {item.kind === 'folder' ? <Folder className="size-4 text-muted shrink-0" /> : <FileIconSmall name={item.name} />}
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="text-xs text-muted">{t('files.trash.deletedOn', { date: fmt.dateTime(item.deletedAt) })} · {formatBytes(item.sizeBytes, LOCALE)}</div>
              </div>
              {canWrite && <Button size="sm" variant="ghost" onPress={() => restore.mutate(item)}><RotateCcw /> {t('files.trash.restore')}</Button>}
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  )
}

function FileIconSmall({ name }: { name: string }) {
  return <span className="text-[10px] font-semibold uppercase text-muted w-4 text-center shrink-0">{name.split('.').pop()?.slice(0, 3)}</span>
}

/** "1,2 GB of 5 GB" with a bar that turns amber from 80 % and red when full. */
export function StorageBar({ usage }: { usage: StorageUsage }) {
  const { t } = useTranslation()
  const pct = Math.min(100, (usage.usedBytes / Math.max(1, usage.limitBytes)) * 100)
  return (
    <div className="min-w-44">
      <div className="flex justify-between text-xs text-muted gap-2">
        <span>{t('files.storage.used', { used: formatBytes(usage.usedBytes, LOCALE), limit: formatBytes(usage.limitBytes, LOCALE) })}</span>
        {usage.state !== 'ok' && <span className={usage.state === 'full' ? 'text-danger' : 'text-warning'}>{usage.state === 'full' ? t('files.storage.full') : `${fmt.num(pct)} %`}</span>}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t('files.storage.label')}>
        <div className={cx('h-full rounded-full', usage.state === 'full' ? 'bg-danger' : usage.state === 'warn' ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
