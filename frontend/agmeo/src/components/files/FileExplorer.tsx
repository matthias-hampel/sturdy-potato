import { fileKind, type FileItem, type FileListing, type FolderItem, type StorageUsage, type TrashItem } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Home,
  LayoutGrid,
  List,
  Map as MapIcon,
  MoreVertical,
  PackageOpen,
  Pencil,
  Scissors,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton } from 'react-aria-components'
import { LOCALE } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Checkbox, Option, SearchField, Select } from '#/ui/Field'
import { EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { Menu, MenuItem, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx, focusRing } from '#/ui/utils'
import { type ContextAction, ContextMenu } from './ContextMenu'
import { EditFileDialog, FolderNameDialog, MoveDialog, StorageBar, TrashDialog } from './dialogs'
import { GeoViewer } from './GeoViewer'
import { isGeoName } from './geo'
import { canPreview, PreviewDialog } from './Preview'
import { filesFromDataTransfer, filesFromInput, formatBytes } from './upload'
import { useUploads } from './useUploads'

type Item = { kind: 'folder'; key: string; id: string; name: string; folder: FolderItem } | { kind: 'file'; key: string; id: string; name: string; file: FileItem }
type SortKey = 'name' | 'size' | 'created' | 'year'
type View = 'grid' | 'list'
type Clipboard = { mode: 'copy' | 'cut'; fileIds: string[]; folderIds: string[] }

const DRAG_TYPE = 'application/x-agmeo-files'
const VIEW_KEY = 'agmeo.files.view'

const readView = (): View => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function fileIcon(name: string): LucideIcon {
  switch (fileKind(name)) {
    case 'geo':
      return MapIcon
    case 'table':
      return FileSpreadsheet
    case 'image':
      return FileImage
    case 'pdf':
      return FileText
    case 'zip':
      return FileArchive
    default:
      return FileIcon
  }
}

const selection = (keys: Iterable<string>) => {
  const fileIds: string[] = []
  const folderIds: string[] = []
  for (const k of keys) (k.startsWith('d:') ? folderIds : fileIds).push(k.slice(2))
  return { fileIds, folderIds }
}

/** File manager for an organization's documents, in the spirit of a desktop explorer. */
export function FileExplorer({ folderId, search, onNavigate, onSearch }: { folderId: string | null; search: string; onNavigate: (folderId: string | null) => void; onSearch: (q: string) => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { season } = useSeason()
  const canWrite = can('files.write')
  const listing = useOrgQuery<FileListing>('/files', { folderId, search: search || undefined }, { keepPrevious: true })
  const folders = useOrgQuery<FolderItem[]>('/files/folders')
  const usage = useOrgQuery<StorageUsage>('/files/storage')
  const trash = useOrgQuery<TrashItem[]>('/files/trash')
  const [view, setViewState] = useState<View>(readView)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: Item | null } | null>(null)
  const [dialog, setDialog] = useState<
    | { kind: 'newFolder' }
    | { kind: 'renameFolder'; folder: FolderItem }
    | { kind: 'editFile'; file: FileItem }
    | { kind: 'move'; fileIds: string[]; folderIds: string[] }
    | { kind: 'delete'; fileIds: string[]; folderIds: string[] }
    | { kind: 'trash' }
    | { kind: 'preview'; file: FileItem }
    | { kind: 'geo'; file: FileItem }
    | { kind: 'zip'; file: FileItem }
    | null
  >(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [osDrag, setOsDrag] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const uploads = useUploads(folderId, season?.harvestYear ?? null, (ids) => setSelected(new Set(ids.map((id) => `f:${id}`))))

  const setView = (v: View) => {
    setViewState(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Not remembered without storage.
    }
  }

  // Folders above files; each group sorted by the chosen column.
  const items: Item[] = (() => {
    const data = listing.data ?? { folders: [], files: [] }
    const dir = sort.desc ? -1 : 1
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, LOCALE, { numeric: true, sensitivity: 'base' })
    const fs = [...data.folders].sort((a, b) => (sort.key === 'created' ? a.createdAt.localeCompare(b.createdAt) : byName(a, b)) * dir)
    const fl = [...data.files].sort((a, b) => {
      const v =
        sort.key === 'size' ? a.sizeBytes - b.sizeBytes : sort.key === 'created' ? a.createdAt.localeCompare(b.createdAt) : sort.key === 'year' ? (a.year ?? 0) - (b.year ?? 0) : 0
      return (v || byName(a, b)) * dir
    })
    return [
      ...fs.map((folder) => ({ kind: 'folder' as const, key: `d:${folder.id}`, id: folder.id, name: folder.name, folder })),
      ...fl.map((file) => ({ kind: 'file' as const, key: `f:${file.id}`, id: file.id, name: file.name, file })),
    ]
  })()

  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [folderId, search])

  // Breadcrumb trail from the flat folder list.
  const byId = new Map((folders.data ?? []).map((f) => [f.id, f]))
  const trail: FolderItem[] = []
  for (let f = folderId ? byId.get(folderId) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) trail.unshift(f)

  const qc = useQueryClient()
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn()
      if (success) toast.success(success)
    } catch (e) {
      toast.error(t('common.saveFailed'), errorMessage(e))
    } finally {
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
    }
  }
  const base = `/orgs/${orgId}/files`
  const moveItems = (sel: { fileIds: string[]; folderIds: string[] }, targetFolderId: string | null) =>
    run(() => api.post(`${base}/move`, { ...sel, targetFolderId }), t('files.move.done'))
  const copyItems = (sel: { fileIds: string[]; folderIds: string[] }, targetFolderId: string | null) =>
    run(() => api.post(`${base}/copy`, { ...sel, targetFolderId }), t('files.copy.done'))
  const removeItems = (sel: { fileIds: string[]; folderIds: string[] }) =>
    run(async () => {
      await api.post(`${base}/delete`, sel)
      setSelected(new Set())
    }, t('files.delete.done'))
  const download = (file: FileItem) => api.download(`${base}/${file.id}/content`, undefined, file.name).catch((e) => toast.error(t('files.action.downloadFailed'), errorMessage(e)))
  const downloadFolder = (folder: FolderItem) => api.download(`${base}/folders/${folder.id}/zip`, undefined, `${folder.name}.zip`).catch((e) => toast.error(t('files.action.downloadFailed'), errorMessage(e)))
  const extract = (file: FileItem) => run(() => api.post(`${base}/${file.id}/extract`), t('files.zip.extracted'))
  const compress = (sel: { fileIds: string[]; folderIds: string[] }) => {
    const names = [...sel.fileIds.map((id) => items.find((i) => i.key === `f:${id}`)?.name), ...sel.folderIds.map((id) => items.find((i) => i.key === `d:${id}`)?.name)].filter(Boolean) as string[]
    const name = names.length === 1 ? names[0].replace(/\.[^.]+$/, '') : t('files.zip.archiveName')
    return run(() => api.post(`${base}/compress`, { ...sel, targetFolderId: folderId, year: season?.harvestYear ?? null, name }), t('files.zip.compressed'))
  }
  const paste = (target: string | null) => {
    if (!clipboard) return
    const sel = { fileIds: clipboard.fileIds, folderIds: clipboard.folderIds }
    if (clipboard.mode === 'cut') {
      void moveItems(sel, target)
      setClipboard(null)
    } else void copyItems(sel, target)
  }

  const open = (item: Item) => {
    if (item.kind === 'folder') return onNavigate(item.id)
    const f = item.file
    if (f.name.toLowerCase().endsWith('.zip')) return setDialog({ kind: 'zip', file: f })
    if (isGeoName(f.name) && !/\.(json|zip)$/i.test(f.name)) return setDialog({ kind: 'geo', file: f })
    if (canPreview(f.name)) return setDialog({ kind: 'preview', file: f })
    void download(f)
  }

  // Click: select one; Ctrl/Cmd: toggle; Shift: range from the anchor.
  const select = (item: Item, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey && anchor) {
      const keys = items.map((i) => i.key)
      const [a, b] = [keys.indexOf(anchor), keys.indexOf(item.key)].sort((x, y) => x - y)
      setSelected(new Set(keys.slice(a, b + 1)))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(item.key)) next.delete(item.key)
      else next.add(item.key)
      setSelected(next)
    } else setSelected(new Set([item.key]))
    setAnchor(item.key)
  }
  const toggle = (item: Item) => {
    const next = new Set(selected)
    if (next.has(item.key)) next.delete(item.key)
    else next.add(item.key)
    setSelected(next)
    setAnchor(item.key)
  }

  const selectedItems = items.filter((i) => selected.has(i.key))
  const sel = selection(selected)

  // Keyboard shortcuts while the explorer has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [role="menu"], [role="dialog"]')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(items.map((i) => i.key)))
    } else if (e.key === 'Escape') setSelected(new Set())
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size && canWrite) {
      e.preventDefault()
      setDialog({ kind: 'delete', ...sel })
    } else if (e.key === 'Enter' && selectedItems.length === 1) open(selectedItems[0])
    else if (e.key === 'F2' && selectedItems.length === 1 && canWrite) {
      const i = selectedItems[0]
      setDialog(i.kind === 'folder' ? { kind: 'renameFolder', folder: i.folder } : { kind: 'editFile', file: i.file })
    } else if (mod && e.key.toLowerCase() === 'c' && selected.size) setClipboard({ mode: 'copy', ...sel })
    else if (mod && e.key.toLowerCase() === 'x' && selected.size && canWrite) setClipboard({ mode: 'cut', ...sel })
    else if (mod && e.key.toLowerCase() === 'v' && clipboard && canWrite) paste(folderId)
  }

  // Files pasted from the operating system's clipboard are uploaded.
  useEffect(() => {
    if (!canWrite) return
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) {
        e.preventDefault()
        void uploads.start(files.map((file) => ({ file, dir: '' })))
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [canWrite, uploads])

  // Drag and drop: internal items onto folders and breadcrumbs move them; files from the
  // desktop anywhere on the explorer upload into the current folder (or the folder under them).
  const dragProps = (item: Item) =>
    canWrite
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            const keys = selected.has(item.key) ? [...selected] : [item.key]
            if (!selected.has(item.key)) setSelected(new Set([item.key]))
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(selection(keys)))
            e.dataTransfer.effectAllowed = 'move'
          },
        }
      : {}
  const dropProps = (key: string, target: string | null) =>
    canWrite
      ? {
          onDragOver: (e: React.DragEvent) => {
            const internal = e.dataTransfer.types.includes(DRAG_TYPE)
            if (!internal && !e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
            setDropTarget(key)
          },
          onDragLeave: () => setDropTarget((d) => (d === key ? null : d)),
          onDrop: async (e: React.DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            setDropTarget(null)
            setOsDrag(false)
            const raw = e.dataTransfer.getData(DRAG_TYPE)
            if (raw) {
              const s = JSON.parse(raw) as { fileIds: string[]; folderIds: string[] }
              if (target && s.folderIds.includes(target)) return
              void moveItems(s, target)
            } else {
              void uploads.start(await filesFromDataTransfer(e.dataTransfer), target)
            }
          },
        }
      : {}

  const itemActions = (item: Item | null): ContextAction[] => {
    if (!item) {
      return [
        ...(canWrite
          ? ([
              { id: 'newFolder', label: t('files.folder.new'), icon: FolderPlus, onAction: () => setDialog({ kind: 'newFolder' }) },
              { id: 'upload', label: t('files.upload.files'), icon: Upload, onAction: () => fileInput.current?.click() },
            ] as ContextAction[])
          : []),
        ...(clipboard && canWrite ? [{ id: 'paste', label: t('files.action.paste'), icon: ClipboardPaste, onAction: () => paste(folderId) }] : []),
      ]
    }
    const many = selected.has(item.key) && selected.size > 1
    const s = many ? sel : selection([item.key])
    const single = !many
    const out: ContextAction[] = []
    if (single) {
      if (item.kind === 'folder') out.push({ id: 'open', label: t('files.action.open'), icon: FolderOpen, onAction: () => open(item) })
      else {
        if (isGeoName(item.name)) out.push({ id: 'viewer', label: t('files.action.openInViewer'), icon: MapIcon, onAction: () => setDialog({ kind: 'geo', file: item.file }) })
        if (canPreview(item.name)) out.push({ id: 'preview', label: t('files.action.preview'), icon: Eye, onAction: () => setDialog({ kind: 'preview', file: item.file }) })
        out.push({ id: 'download', label: t('files.action.download'), icon: Download, onAction: () => void download(item.file) })
        if (item.name.toLowerCase().endsWith('.zip') && canWrite) out.push({ id: 'extract', label: t('files.zip.extract'), icon: PackageOpen, onAction: () => void extract(item.file) })
      }
      if (item.kind === 'folder') out.push({ id: 'zip', label: t('files.action.downloadZip'), icon: Download, onAction: () => void downloadFolder(item.folder) })
      out.push('separator')
    }
    out.push({ id: 'copy', label: t('files.action.copy'), icon: Copy, onAction: () => setClipboard({ mode: 'copy', ...s }) })
    if (canWrite) {
      out.push({ id: 'cut', label: t('files.action.cut'), icon: Scissors, onAction: () => setClipboard({ mode: 'cut', ...s }) })
      if (single && item.kind === 'folder' && clipboard) out.push({ id: 'paste', label: t('files.action.pasteInto'), icon: ClipboardPaste, onAction: () => paste(item.id) })
      out.push('separator')
      out.push({ id: 'compress', label: t('files.zip.compress'), icon: FileArchive, onAction: () => void compress(s) })
      out.push({ id: 'move', label: t('files.action.move'), icon: FolderInput, onAction: () => setDialog({ kind: 'move', ...s }) })
      if (single) {
        out.push(
          item.kind === 'folder'
            ? { id: 'rename', label: t('files.folder.rename'), icon: Pencil, onAction: () => setDialog({ kind: 'renameFolder', folder: item.folder }) }
            : { id: 'edit', label: t('files.edit.title'), icon: Pencil, onAction: () => setDialog({ kind: 'editFile', file: item.file }) },
        )
      }
      out.push('separator')
      out.push({ id: 'delete', label: many ? t('files.delete.many', { count: selected.size }) : t('files.delete.one'), icon: Trash2, danger: true, onAction: () => setDialog({ kind: 'delete', ...s }) })
    }
    return out
  }

  const onContextMenu = (e: React.MouseEvent, item: Item | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (item && !selected.has(item.key)) {
      setSelected(new Set([item.key]))
      setAnchor(item.key)
    }
    setMenu({ x: e.clientX, y: e.clientY, target: item })
  }

  const cut = new Set(clipboard?.mode === 'cut' ? [...clipboard.fileIds.map((id) => `f:${id}`), ...clipboard.folderIds.map((id) => `d:${id}`)] : [])
  const years = [...new Set([season?.harvestYear, new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1].filter((y): y is number => !!y))]
  const searching = !!search.trim()

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative outline-none min-h-[60vh]"
      onDragEnter={(e) => canWrite && e.dataTransfer.types.includes('Files') && setOsDrag(true)}
      onDragOver={(e) => {
        if (canWrite && e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropTarget(null)
        }
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOsDrag(false)
      }}
      onDrop={async (e) => {
        if (!canWrite || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOsDrag(false)
        void uploads.start(await filesFromDataTransfer(e.dataTransfer))
      }}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <nav aria-label={t('files.breadcrumb')} className="flex items-center gap-0.5 min-w-0 flex-1 text-sm">
          <button type="button" {...dropProps('root', null)} onClick={() => onNavigate(null)} className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-2', dropTarget === 'root' && 'ring-2 ring-primary bg-primary-soft', !folderId && !searching && 'font-semibold')}>
            <Home className="size-4" /> {t('files.root')}
          </button>
          {searching ? (
            <>
              <ChevronRight className="size-4 text-muted shrink-0" />
              <span className="px-2 py-1 font-semibold truncate">{t('files.searchResults', { query: search })}</span>
            </>
          ) : (
            trail.map((f, i) => (
              <span key={f.id} className="inline-flex items-center gap-0.5 min-w-0">
                <ChevronRight className="size-4 text-muted shrink-0" />
                <button type="button" {...dropProps(`crumb:${f.id}`, f.id)} onClick={() => onNavigate(f.id)} className={cx('truncate rounded-md px-2 py-1 hover:bg-surface-2', dropTarget === `crumb:${f.id}` && 'ring-2 ring-primary bg-primary-soft', i === trail.length - 1 && 'font-semibold')}>
                  {f.name}
                </button>
              </span>
            ))
          )}
        </nav>
        {usage.data && <div className="hidden lg:block"><StorageBar usage={usage.data} /></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchField aria-label={t('files.search')} placeholder={t('files.search')} value={search} onChange={onSearch} className="w-full sm:w-64" />
        <Select aria-label={t('files.sort.label')} className="w-40" items={(['name', 'size', 'created', 'year'] as const).map((k) => ({ id: k, name: t(`files.sort.${k}`) }))} value={sort.key} onChange={(v) => v && setSort((s) => ({ ...s, key: v as SortKey }))}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <Button variant="ghost" size="icon" aria-label={sort.desc ? t('files.sort.descending') : t('files.sort.ascending')} onPress={() => setSort((s) => ({ ...s, desc: !s.desc }))}>
          {sort.desc ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </Button>
        <SegmentedControl aria-label={t('files.view.label')} value={view} onChange={setView} items={[{ id: 'grid' as const, label: <LayoutGrid className="size-4" aria-label={t('files.view.grid')} /> }, { id: 'list' as const, label: <List className="size-4" aria-label={t('files.view.list')} /> }]} />
        <div className="flex-1" />
        <span
          className={cx('rounded-[var(--radius-control)]', dropTarget === 'trash' && 'ring-2 ring-danger')}
          {...(canWrite
            ? {
                onDragOver: (e: React.DragEvent) => {
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setDropTarget('trash')
                },
                onDragLeave: () => setDropTarget((d) => (d === 'trash' ? null : d)),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropTarget(null)
                  const raw = e.dataTransfer.getData(DRAG_TYPE)
                  if (raw) setDialog({ kind: 'delete', ...(JSON.parse(raw) as { fileIds: string[]; folderIds: string[] }) })
                },
              }
            : {})}
        >
          <Button variant="ghost" onPress={() => setDialog({ kind: 'trash' })}>
            <Trash2 /> {t('files.trash.title')}
            {(trash.data?.length ?? 0) > 0 && <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-xs tabular">{trash.data!.length}</span>}
          </Button>
        </span>
        {canWrite && (
          <>
            <Button onPress={() => setDialog({ kind: 'newFolder' })}><FolderPlus /> {t('files.folder.new')}</Button>
            <MenuTrigger>
              <Button variant="primary"><Upload /> {t('files.upload.button')}</Button>
              <Menu onAction={(k) => (k === 'folder' ? folderInput.current?.click() : fileInput.current?.click())}>
                <MenuItem id="files"><Upload /> {t('files.upload.files')}</MenuItem>
                <MenuItem id="folder"><FolderUp /> {t('files.upload.folder')}</MenuItem>
              </Menu>
            </MenuTrigger>
          </>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) void uploads.start(filesFromInput(e.target.files)); e.target.value = '' }} />
        <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={(e) => { if (e.target.files) void uploads.start(filesFromInput(e.target.files)); e.target.value = '' }} />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-line bg-surface-2/60 px-3 py-1.5 text-sm">
          <span className="font-medium">{t('files.selected', { count: selected.size })}</span>
          <div className="flex-1" />
          {selectedItems.length === 1 && selectedItems[0].kind === 'file' && <Button size="sm" variant="ghost" onPress={() => void download((selectedItems[0] as { file: FileItem }).file)}><Download /> {t('files.action.download')}</Button>}
          {canWrite && <Button size="sm" variant="ghost" onPress={() => setDialog({ kind: 'move', ...sel })}><FolderInput /> {t('files.action.move')}</Button>}
          {canWrite && <Button size="sm" variant="ghost" onPress={() => void compress(sel)}><FileArchive /> {t('files.zip.compress')}</Button>}
          {canWrite && <Button size="sm" variant="ghost" className="text-danger" onPress={() => setDialog({ kind: 'delete', ...sel })}><Trash2 /> {t('files.delete.one')}</Button>}
          <Button size="icon-sm" variant="ghost" aria-label={t('files.clearSelection')} onPress={() => setSelected(new Set())}><X /></Button>
        </div>
      )}

      {uploads.state && (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm" role="status">
          <div className="flex items-center gap-3">
            <span className="flex-1">{t('files.upload.progress', { done: uploads.state.done, total: uploads.state.total, size: formatBytes(uploads.state.bytes, LOCALE) })}</span>
            <Button size="sm" variant="ghost" onPress={uploads.cancel}>{t('common.cancel')}</Button>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((uploads.state.loaded / Math.max(1, uploads.state.bytes)) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Contents */}
      <div onContextMenu={(e) => onContextMenu(e, null)} onClick={(e) => e.target === e.currentTarget && setSelected(new Set())} className="min-h-[40vh]">
        {listing.error ? (
          <ErrorNotice error={listing.error} />
        ) : listing.isPending ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={searching ? FileIcon : FolderOpen} title={searching ? t('files.empty.search') : folderId ? t('files.empty.folder') : t('files.empty.root')} action={canWrite && !searching ? <Button variant="primary" onPress={() => fileInput.current?.click()}><Upload /> {t('files.upload.files')}</Button> : undefined}>
            {canWrite && !searching ? t('files.empty.dropHint') : undefined}
          </EmptyState>
        ) : view === 'grid' ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" aria-label={t('files.contents')}>
            {items.map((item) => (
              <li
                key={item.key}
                {...dragProps(item)}
                {...(item.kind === 'folder' ? dropProps(item.key, item.id) : {})}
                onClick={(e) => select(item, e)}
                onDoubleClick={() => open(item)}
                onContextMenu={(e) => onContextMenu(e, item)}
                aria-selected={selected.has(item.key)}
                className={cx(
                  'group relative flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center cursor-default select-none',
                  selected.has(item.key) ? 'border-primary bg-primary-soft/50' : 'border-transparent hover:bg-surface-2',
                  dropTarget === item.key && 'ring-2 ring-primary',
                  cut.has(item.key) && 'opacity-50',
                )}
              >
                <Checkbox aria-label={t('files.select', { name: item.name })} isSelected={selected.has(item.key)} onChange={() => toggle(item)} className={cx('absolute top-1.5 left-1.5', !selected.has(item.key) && 'opacity-0 group-hover:opacity-100')} />
                <ItemThumb item={item} />
                <span className="w-full text-sm leading-tight line-clamp-2 break-words">{item.name}</span>
                <span className="text-xs text-muted">{item.kind === 'folder' ? t('files.itemCount', { count: item.folder.itemCount }) : formatBytes(item.file.sizeBytes, LOCALE)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm" aria-label={t('files.contents')}>
              <thead className="text-xs text-muted border-b border-line">
                <tr>
                  <th className="w-10 px-3 py-2"><Checkbox aria-label={t('files.selectAll')} isSelected={selected.size > 0 && selected.size === items.length} isIndeterminate={selected.size > 0 && selected.size < items.length} onChange={(v) => setSelected(v ? new Set(items.map((i) => i.key)) : new Set())} /></th>
                  {(['name', 'size', 'created', 'year'] as const).map((k) => (
                    <th key={k} className={cx('px-3 py-2 font-medium text-left whitespace-nowrap', k === 'size' && 'text-right')}>
                      <button type="button" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : false }))} className="hover:text-fg">
                        {t(`files.sort.${k}`)} {sort.key === k ? (sort.desc ? '↓' : '↑') : ''}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium text-left hidden xl:table-cell">{t('files.column.description')}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const Icon = item.kind === 'folder' ? Folder : fileIcon(item.name)
                  return (
                    <tr
                      key={item.key}
                      {...dragProps(item)}
                      {...(item.kind === 'folder' ? dropProps(item.key, item.id) : {})}
                      onClick={(e) => select(item, e)}
                      onDoubleClick={() => open(item)}
                      onContextMenu={(e) => onContextMenu(e, item)}
                      aria-selected={selected.has(item.key)}
                      className={cx('border-b border-line/60 last:border-0 cursor-default select-none', selected.has(item.key) ? 'bg-primary-soft/50' : 'hover:bg-surface-2/60', dropTarget === item.key && 'outline outline-2 outline-primary', cut.has(item.key) && 'opacity-50')}
                    >
                      <td className="px-3 py-2"><Checkbox aria-label={t('files.select', { name: item.name })} isSelected={selected.has(item.key)} onChange={() => toggle(item)} /></td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon className={cx('size-4 shrink-0', item.kind === 'folder' ? 'text-primary' : 'text-muted')} aria-hidden />
                          <span className="truncate">{item.name}</span>
                          {item.kind === 'folder' && <span className="text-xs text-muted shrink-0">{t('files.itemCount', { count: item.folder.itemCount })}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular text-muted whitespace-nowrap">{item.kind === 'file' ? formatBytes(item.file.sizeBytes, LOCALE) : ''}</td>
                      <td className="px-3 py-2 tabular text-muted whitespace-nowrap">{createdLabel(item.kind === 'file' ? item.file.createdAt : item.folder.createdAt)}</td>
                      <td className="px-3 py-2 tabular text-muted">{item.kind === 'file' ? item.file.year ?? '' : ''}</td>
                      <td className="px-3 py-2 text-muted hidden xl:table-cell max-w-72 truncate">{item.kind === 'file' ? item.file.description ?? '' : ''}</td>
                      <td className="px-1 py-1">
                        <AriaButton aria-label={t('files.actionsFor', { name: item.name })} className={cx('rounded-md p-1.5 text-muted hover:bg-surface-2', focusRing)} onPress={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); if (!selected.has(item.key)) setSelected(new Set([item.key])); setMenu({ x: r.left, y: r.bottom + 4, target: item }) }}>
                          <MoreVertical className="size-4" />
                        </AriaButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {osDrag && canWrite && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-2 border-dashed border-primary bg-primary-soft/60 flex items-center justify-center">
          <div className="rounded-xl bg-surface px-5 py-4 shadow text-center">
            <Upload className="size-6 mx-auto text-primary" />
            <div className="mt-2 font-medium">{t('files.upload.dropHere', { folder: trail.at(-1)?.name ?? t('files.root') })}</div>
          </div>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={itemActions(menu.target)} onClose={() => setMenu(null)} />}

      {dialog?.kind === 'newFolder' && <FolderNameDialog parentId={folderId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'renameFolder' && <FolderNameDialog folder={dialog.folder} parentId={dialog.folder.parentId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'editFile' && <EditFileDialog file={dialog.file} years={years} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'move' && <MoveDialog title={t('files.move.title', { count: dialog.fileIds.length + dialog.folderIds.length })} folderIds={dialog.folderIds} onMove={(target) => moveItems(dialog, target)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'trash' && <TrashDialog canWrite={canWrite} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'preview' && <PreviewDialog file={dialog.file} onClose={() => setDialog(null)} onDownload={() => void download(dialog.file)} />}
      {dialog?.kind === 'geo' && <GeoViewer file={dialog.file} folderFiles={listing.data?.files ?? []} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ModalDialog isOpen onOpenChange={(o) => !o && setDialog(null)} title={t('files.delete.title', { count: dialog.fileIds.length + dialog.folderIds.length })} size="sm"
          footer={(close) => (
            <>
              <Button onPress={close}>{t('common.cancel')}</Button>
              <Button variant="danger" onPress={() => { void removeItems(dialog); close() }}>{t('files.delete.confirm')}</Button>
            </>
          )}
        >
          <p className="text-sm text-fg-2">{t('files.delete.message')}</p>
        </ModalDialog>
      )}
      {dialog?.kind === 'zip' && (
        <ModalDialog isOpen onOpenChange={(o) => !o && setDialog(null)} title={dialog.file.name} size="sm"
          footer={(close) => (
            <>
              <Button onPress={close}>{t('common.cancel')}</Button>
              <Button onPress={() => { setDialog({ kind: 'geo', file: dialog.file }) }}><MapIcon /> {t('files.action.openInViewer')}</Button>
              {canWrite && <Button variant="primary" onPress={() => { void extract(dialog.file); close() }}><PackageOpen /> {t('files.zip.extract')}</Button>}
              <Button onPress={() => { void download(dialog.file); close() }}><Download /></Button>
            </>
          )}
        >
          <p className="text-sm text-fg-2">{t('files.zip.question')}</p>
        </ModalDialog>
      )}
    </div>
  )
}

function createdLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : fmt.date(iso)
}

/** Folder or file-type icon; images show a thumbnail once loaded. */
function ItemThumb({ item }: { item: Item }) {
  const { orgId } = useOrg()
  const isImage = item.kind === 'file' && fileKind(item.name) === 'image' && item.file.sizeBytes <= 8_000_000
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!isImage || !ref.current) return
    const o = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' })
    o.observe(ref.current)
    return () => o.disconnect()
  }, [isImage])
  const blob = useQuery({
    queryKey: ['file-blob', orgId, item.id],
    queryFn: async () => new Blob([await api.blob(`/orgs/${orgId}/files/${item.id}/content`)], { type: (item as { file: FileItem }).file.mimeType }),
    enabled: isImage && visible,
    staleTime: 10 * 60_000,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob.data) return
    const u = URL.createObjectURL(blob.data)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob.data])
  const Icon = item.kind === 'folder' ? Folder : fileIcon(item.name)
  return (
    <div ref={ref} className="size-16 flex items-center justify-center">
      {url ? <img src={url} alt="" className="max-h-16 max-w-16 rounded object-cover" /> : <Icon className={cx('size-12', item.kind === 'folder' ? 'text-primary fill-primary-soft' : 'text-muted')} strokeWidth={1.25} aria-hidden />}
    </div>
  )
}
