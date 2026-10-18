import type { Comment, CommentTarget } from '@agmeo/contracts'
import { Pencil, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { Loading } from '#/ui/Layout'

/** Comment thread of an operation or task: everyone with access reads and writes, authors edit their own. */
export function Comments({ entityType, entityId }: { entityType: CommentTarget; entityId: string }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const comments = useOrgQuery<Comment[]>('/comments', { entityType, entityId })
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const add = useOrgMutation((base, _: void) => api.post<Comment>(`${base}/comments`, { entityType, entityId, id: crypto.randomUUID(), body }), { onSuccess: () => setBody('') })
  const save = useOrgMutation((base, e: { id: string; body: string }) => api.patch(`${base}/comments/${e.id}`, { body: e.body }), { onSuccess: () => setEditing(null) })
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/comments/${id}`))
  return (
    <section className="space-y-3" aria-label={t('comments.title')}>
      <h3 className="text-sm font-semibold">{t('comments.title')}</h3>
      {comments.isPending ? <Loading /> : !comments.data?.length ? <p className="text-sm text-muted">{t('comments.empty')}</p> : (
        <ul className="space-y-3">
          {comments.data.map((c) => (
            <li key={c.id} className="rounded-lg bg-surface-2/60 px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="font-medium text-fg">{c.authorName}</span>
                <span>{fmt.dateTime(c.createdAt)}</span>
                {c.editedAt && <span>· {t('comments.edited')}</span>}
                <span className="flex-1" />
                {c.mine && <Button size="icon-sm" variant="ghost" aria-label={t('comments.edit')} onPress={() => setEditing({ id: c.id, body: c.body })}><Pencil /></Button>}
                {(c.mine || can('members.manage')) && <Button size="icon-sm" variant="ghost" aria-label={t('comments.delete')} onPress={() => remove.mutate(c.id)}><Trash2 /></Button>}
              </div>
              {editing?.id === c.id ? (
                <div className="mt-1 space-y-2">
                  <TextField aria-label={t('comments.edit')} multiline rows={2} value={editing.body} onChange={(v) => setEditing({ id: c.id, body: v })} autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onPress={() => setEditing(null)}>{t('common.cancel')}</Button>
                    <Button size="sm" variant="primary" isDisabled={!editing.body.trim()} isPending={save.isPending} onPress={() => save.mutate(editing)}>{t('common.save')}</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap mt-0.5">{c.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) add.mutate()
        }}
      >
        <TextField aria-label={t('comments.new')} placeholder={t('comments.placeholder')} multiline rows={2} value={body} onChange={setBody} className="flex-1" />
        <Button type="submit" variant="primary" aria-label={t('comments.send')} isDisabled={!body.trim()} isPending={add.isPending}><Send /></Button>
      </form>
    </section>
  )
}
