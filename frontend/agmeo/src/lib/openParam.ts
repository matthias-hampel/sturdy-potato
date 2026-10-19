import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'

/** `?open=<id>` on list pages without detail routes: the global search links to a record this way. */
export const openSearch = z.object({ open: z.uuid().optional().catch(undefined) })

/**
 * Calls `onOpen` with the record named by `?open=` once `items` has loaded, then drops the
 * parameter so closing the dialog and following the same link again works.
 */
export function useOpenParam<T extends { id: string }>(items: T[] | undefined, onOpen: (item: T) => void) {
  const { open } = useSearch({ strict: false }) as { open?: string }
  const navigate = useNavigate()
  useEffect(() => {
    if (!open || !items) return
    const item = items.find((i) => i.id === open)
    if (item) onOpen(item)
    void navigate({ to: '.', search: (s: Record<string, unknown>) => ({ ...s, open: undefined }), replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per link, not per render of onOpen
  }, [open, items])
}
