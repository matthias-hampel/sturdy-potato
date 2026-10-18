import type { FileItem } from '@agmeo/contracts'
import { ApiRequestError, SESSION_EXPIRED_EVENT, tokenStore } from '#/lib/api'

/** A file to upload with its folder path relative to the drop target (`''` = the target itself). */
export interface PendingFile {
  file: File
  dir: string
}

/** Reads dropped items, descending into folders (Chrome, Edge, Firefox and Safari support entries). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<PendingFile[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return [...dt.files].map((file) => ({ file, dir: '' }))
  const out: PendingFile[] = []
  const walk = async (entry: FileSystemEntry, dir: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      if (file.name !== '.DS_Store') out.push({ file, dir })
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const path = dir ? `${dir}/${entry.name}` : entry.name
    // readEntries returns at most 100 entries per call.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const e of batch) await walk(e, path)
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}

/** Files picked with `<input webkitdirectory>` carry their path in `webkitRelativePath`. */
export function filesFromInput(list: FileList): PendingFile[] {
  return [...list].map((file) => {
    const rel = file.webkitRelativePath
    return { file, dir: rel ? rel.split('/').slice(0, -1).join('/') : '' }
  })
}

/**
 * Uploads one batch to a folder with progress (fetch has no upload progress, so XHR).
 * Resolves with the stored files.
 */
export function uploadBatch(
  orgId: string,
  folderId: string | null,
  year: number | null,
  files: File[],
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<FileItem[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    if (folderId) form.append('folderId', folderId)
    if (year) form.append('year', String(year))
    form.append('names', JSON.stringify(files.map((f) => f.name)))
    for (const f of files) form.append('files', f, 'upload')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/orgs/${orgId}/files/upload`)
    const token = tokenStore.get()
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      const data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as FileItem[])
      if (xhr.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      reject(new ApiRequestError(xhr.status, data?.code ?? 'error', data?.message ?? xhr.statusText, data?.details))
    }
    xhr.onerror = () => reject(new ApiRequestError(0, 'network_error', 'Network error'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

/** Groups files into request batches of at most `maxFiles` files and about `maxBytes` bytes. */
export function batches<T extends { file: File }>(items: T[], maxFiles = 20, maxBytes = 64 * 1024 * 1024): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const item of items) {
    if (current.length && (current.length >= maxFiles || bytes + item.file.size > maxBytes)) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += item.file.size
  }
  if (current.length) out.push(current)
  return out
}

/** File size in decimal units, as storage providers count: 1 kB = 1000 bytes. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`
}
