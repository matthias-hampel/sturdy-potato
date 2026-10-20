import { ROLES, type Member, type Role } from '@agmeo/contracts'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { roleLabel } from '#/i18n/labels'
import { api, errorMessage } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'

interface InviteRow {
  key: number
  email: string
  role: Role
}
let seq = 0
const newRow = (): InviteRow => ({ key: seq++, email: '', role: 'worker' })

/**
 * Onboarding "invite step" (reference: onboarding/_components/InviteMemberDialog): several
 * colleagues at once by e-mail and role; each gets the invitation e-mail. Pending invitations
 * are listed above.
 */
export function InviteMembersDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const members = useOrgQuery<Member[]>('/members')
  const [rows, setRows] = useState<InviteRow[]>([newRow()])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invited = (members.data ?? []).filter((m) => m.status === 'invited')
  const filled = rows.filter((r) => r.email.trim())

  const submit = async () => {
    setPending(true)
    setError(null)
    const failed: InviteRow[] = []
    for (const r of filled) {
      try {
        await api.post(`/orgs/${orgId}/members`, { email: r.email.trim(), role: r.role })
      } catch (e) {
        failed.push(r)
        setError(`${r.email}: ${errorMessage(e)}`)
      }
    }
    setPending(false)
    await members.refetch()
    if (filled.length > failed.length) toast.success(t('onboarding.invite.sent', { count: filled.length - failed.length }))
    if (!failed.length) onClose()
    else setRows(failed)
  }

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('onboarding.invite.title')} description={t('onboarding.invite.description')} size="lg">
      <Form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {invited.length > 0 && (
          <div className="text-sm text-muted">
            {t('onboarding.invite.pending', { count: invited.length })}: {invited.map((m) => m.email).join(', ')}
          </div>
        )}
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-end gap-2">
              <TextField
                className="flex-1"
                label={i === 0 ? t('team.email') : undefined}
                aria-label={t('team.email')}
                type="email"
                value={r.email}
                placeholder="name@example.com"
                onChange={(email) => setRows((list) => list.map((x) => (x.key === r.key ? { ...x, email } : x)))}
              />
              <Select
                className="w-48"
                label={i === 0 ? t('team.role') : undefined}
                aria-label={t('team.role')}
                items={ROLES.filter((x) => x !== 'owner').map((id) => ({ id, name: roleLabel(id) }))}
                value={r.role}
                onChange={(v) => v && setRows((list) => list.map((x) => (x.key === r.key ? { ...x, role: v as Role } : x)))}
              >
                {(x) => <Option id={x.id}>{x.name}</Option>}
              </Select>
              <Button size="icon" variant="ghost" aria-label={t('onboarding.invite.removeRow')} isDisabled={rows.length === 1} onPress={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" isDisabled={rows.length >= 20 || !rows[rows.length - 1]?.email.trim()} onPress={() => setRows((list) => [...list, newRow()])}>
          <Plus /> {t('onboarding.invite.addRow')}
        </Button>
        <p className="text-xs text-muted">{t('onboarding.invite.hint')}</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('onboarding.invite.skip')}</Button>
          <Button type="submit" variant="primary" isDisabled={!filled.length} isPending={pending}>
            {t('team.invite.submit')}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}
