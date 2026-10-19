import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { t } from '#/i18n'
import { ApiRequestError, api, errorMessage } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { toast } from '#/ui/Toast'
import { type PendingFile, batches, uploadBatch } from './upload'

export interface UploadState {
  total: number
  done: number
  bytes: number
  loaded: number
}

/**
 * Uploads files and dropped folder structures into a folder: recreates the folders first,
 * then sends the files in batches with combined progress. Cancelling stops the remaining
 * batches; files already stored stay.
 */
export function useUploads(folderId: string | null, year: number | null, onUploaded?: (ids: string[]) => void) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const [state, setState] = useState<UploadState | null>(null)
  const abort = useRef<AbortController | null>(null)

  const start = async (items: PendingFile[], into: string | null = folderId) => {
    if (!items.length || abort.current) return
    const controller = new AbortController()
    abort.current = controller
    const bytes = items.reduce((s, i) => s + i.file.size, 0)
    setState({ total: items.length, done: 0, bytes, loaded: 0 })
    const stored: string[] = []
    try {
      const usage = await api.get<{ usedBytes: number; limitBytes: number }>(`/orgs/${orgId}/files/storage`)
      if (usage.usedBytes + bytes > usage.limitBytes) {
        toast.error(t('files.upload.storageFull'), t('files.upload.storageFullHint'))
        return
      }
      const dirs = [...new Set(items.map((i) => i.dir).filter(Boolean))]
      const folderOf: Record<string, string> = dirs.length
        ? await api.post<Record<string, string>>(`/orgs/${orgId}/files/folders/tree`, { parentId: into, paths: dirs })
        : {}
      const byFolder = new Map<string | null, PendingFile[]>()
      for (const i of items) {
        const target = i.dir ? folderOf[i.dir] : into
        byFolder.set(target, [...(byFolder.get(target) ?? []), i])
      }
      let loadedBefore = 0
      for (const [target, group] of byFolder) {
        for (const batch of batches(group)) {
          if (controller.signal.aborted) break
          const result = await uploadBatch(orgId, target, year, batch.map((b) => b.file), (loaded) => setState((s) => s && { ...s, loaded: loadedBefore + loaded }), controller.signal)
          loadedBefore += batch.reduce((s, b) => s + b.file.size, 0)
          stored.push(...result.map((r) => r.id))
          setState((s) => s && { ...s, done: s.done + batch.length, loaded: loadedBefore })
        }
      }
      toast.success(t('files.upload.done', { count: stored.length }))
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast.info(t('files.upload.canceled', { count: stored.length }))
      else if (e instanceof ApiRequestError && e.code === 'storage_full') toast.error(t('files.upload.storageFull'), t('files.upload.storageFullHint'))
      else toast.error(t('files.upload.failed'), errorMessage(e))
    } finally {
      abort.current = null
      setState(null)
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
      if (stored.length) onUploaded?.(stored)
    }
  }

  return { state, start, cancel: () => abort.current?.abort() }
}
