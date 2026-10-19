import { MIN_SHARE_PASSWORD, type CreateSoilShareInput, type SoilLabImport, type SoilShare, type SoilShareKind, type UpdateSoilShareInput } from '@agmeo/contracts'
import { Copy, KeyRound, Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { DatePicker, Option, Select, TextField } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

export const shareUrl = (token: string) => `${window.location.origin}/share/soil/${token}`

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    window.prompt('', text)
  }
}

/** Expiry date (end of that day) as an ISO timestamp. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString()

/**
 * Share link for soil results (reference: ShareResultsDialog): the shared fields' lab results or
 * their whole sampling history, optionally password-protected and expiring, with the lab file.
 */
export function ShareDialog({ fieldIds, isOpen, onOpenChange }: { fieldIds: string[]; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const [kind, setKind] = useState<SoilShareKind>('results')
  const [title, setTitle] = useState('')
  const [password, setPassword] = useState('')
  const [expires, setExpires] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [created, setCreated] = useState<SoilShare | null>(null)
  const imports = useOrgQuery<SoilLabImport[]>(isOpen ? '/soil/lab-imports' : null)
  const relevant = (imports.data ?? []).filter((i) => i.files.length && i.fields.some((f) => fieldIds.includes(f.id)))
  const create = useOrgMutation((base, input: CreateSoilShareInput) => api.post<SoilShare>(`${base}/soil/shares`, input), { onSuccess: setCreated })
  const tooShort = password.length > 0 && password.length < MIN_SHARE_PASSWORD

  const close = (open: boolean) => {
    if (!open) {
      setCreated(null)
      setPassword('')
    }
    onOpenChange(open)
  }

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={close}
      size="md"
      title={t('soil.share.button')}
      description={t('soil.share.description')}
      footer={(closeDialog) =>
        created ? (
          <Button variant="primary" onPress={closeDialog}>
            {t('soil.done')}
          </Button>
        ) : (
          <>
            <Button onPress={closeDialog}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              isDisabled={!title.trim() || tooShort}
              isPending={create.isPending}
              onPress={() =>
                create.mutate({
                  kind,
                  title: title.trim(),
                  fieldIds: kind === 'history' && !fieldIds.length ? [] : fieldIds,
                  password: password || null,
                  expiresAt: expires ? endOfDay(expires) : null,
                  labImportId: kind === 'results' ? importId : null,
                  locale: i18n.language === 'de' ? 'de' : 'en',
                })
              }
            >
              {t('soil.share.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <Notice tone="success">{t('soil.share.createdHint')}</Notice>
          <div className="flex gap-2">
            <TextField aria-label={t('soil.share.link')} value={shareUrl(created.token)} isReadOnly className="flex-1" />
            <Button onPress={() => copy(shareUrl(created.token), t('soil.share.copied'))}>
              <Copy /> {t('soil.share.copy')}
            </Button>
          </div>
          {created.hasPassword && <p className="text-xs text-muted">{t('soil.share.passwordHint')}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <SegmentedControl
            aria-label={t('soil.share.kind')}
            value={kind}
            onChange={setKind}
            items={[
              { id: 'results', label: t('soil.share.kind.results') },
              { id: 'history', label: t('soil.share.kind.history') },
            ]}
          />
          <p className="text-xs text-muted">{t(`soil.share.kind.${kind}.hint`, { count: fieldIds.length })}</p>
          <TextField label={t('soil.share.linkTitle')} value={title} onChange={setTitle} placeholder={t('soil.share.titlePlaceholder')} />
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label={t('soil.share.password')}
              type="password"
              value={password}
              onChange={setPassword}
              description={t('soil.share.passwordOptional', { min: MIN_SHARE_PASSWORD })}
              errorMessage={tooShort ? t('soil.share.passwordTooShort', { min: MIN_SHARE_PASSWORD }) : undefined}
              isInvalid={tooShort}
            />
            <DatePicker label={t('soil.share.expires')} value={expires} onChange={setExpires} description={t('soil.share.expiresHint')} />
          </div>
          {kind === 'results' && relevant.length > 0 && (
            <Select label={t('soil.share.file')} items={[{ id: '', label: t('soil.share.noFile') }, ...relevant.map((i) => ({ id: i.id, label: `${fmt.date(i.createdAt.slice(0, 10))} · ${i.files.map((f) => f.name).join(', ')}` }))]} value={importId ?? ''} onChange={(v) => setImportId(v ? String(v) : null)}>
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
          )}
        </div>
      )}
    </ModalDialog>
  )
}

/** Existing share links: copy, change the password, revoke (reference: manage list of ShareResultsDialog). */
export function SharesList() {
  const { t } = useTranslation()
  const shares = useOrgQuery<SoilShare[]>('/soil/shares')
  const [passwordFor, setPasswordFor] = useState<SoilShare | null>(null)
  const [password, setPassword] = useState('')
  const update = useOrgMutation((base, v: { id: string; input: UpdateSoilShareInput }) => api.patch(`${base}/soil/shares/${v.id}`, v.input), {
    success: t('soil.share.updated'),
    onSuccess: () => (setPasswordFor(null), setPassword('')),
  })
  const revoke = useOrgMutation((base, id: string) => api.delete(`${base}/soil/shares/${id}`), { success: t('soil.share.revoked') })

  if (shares.isLoading) return <Loading />
  if (shares.error) return <ErrorNotice error={shares.error} />
  if (!shares.data?.length)
    return (
      <Card>
        <EmptyState icon={Link2} title={t('soil.share.noShares')}>
          {t('soil.share.noSharesBody')}
        </EmptyState>
      </Card>
    )
  const state = (s: SoilShare) => (s.revokedAt ? 'revoked' : s.expiresAt && s.expiresAt < new Date().toISOString() ? 'expired' : 'active')
  return (
    <Card padded={false}>
      <Table aria-label={t('soil.share.manageTitle')}>
        <TableHeader>
          <Column isRowHeader>{t('soil.share.linkTitle')}</Column>
          <Column>{t('soil.imports.fields')}</Column>
          <Column>{t('soil.share.created')}</Column>
          <Column>{t('soil.share.expires')}</Column>
          <Column>{t('soil.history.status')}</Column>
          <Column aria-label={t('soil.share.actions')}> </Column>
        </TableHeader>
        <TableBody items={shares.data}>
          {(s) => (
            <Row id={s.id}>
              <Cell>
                {s.title}
                <span className="block text-xs text-muted">
                  {t(`soil.share.kind.${s.kind}`)}
                  {s.hasPassword && ` · ${t('soil.share.protected')}`}
                </span>
              </Cell>
              <Cell>{s.fieldNames.length ? s.fieldNames.join(', ') : t('soil.share.allFields')}</Cell>
              <Cell>
                {fmt.date(s.createdAt.slice(0, 10))}
                {s.createdByName && <span className="block text-xs text-muted">{s.createdByName}</span>}
              </Cell>
              <Cell>{s.expiresAt ? fmt.date(s.expiresAt.slice(0, 10)) : '—'}</Cell>
              <Cell>
                <Badge tone={state(s) === 'active' ? 'success' : 'neutral'}>{t(`soil.share.state.${state(s)}`)}</Badge>
              </Cell>
              <Cell>
                {!s.revokedAt && (
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('soil.share.copy')} onPress={() => copy(shareUrl(s.token), t('soil.share.copied'))}>
                      <Copy />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('soil.share.changePassword')} onPress={() => setPasswordFor(s)}>
                      <KeyRound />
                    </Button>
                    <ConfirmButton
                      title={t('soil.share.revokeTitle')}
                      message={t('soil.share.revokeMessage')}
                      confirmLabel={t('soil.share.revoke')}
                      onConfirm={() => revoke.mutateAsync(s.id)}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={t('soil.share.revoke')}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  </div>
                )}
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      <ModalDialog
        isOpen={!!passwordFor}
        onOpenChange={(open) => !open && setPasswordFor(null)}
        title={t('soil.share.changePassword')}
        footer={(close) => (
          <>
            <Button onPress={close}>{t('common.cancel')}</Button>
            {passwordFor?.hasPassword && (
              <Button onPress={() => passwordFor && update.mutate({ id: passwordFor.id, input: { password: null } })}>{t('soil.share.removePassword')}</Button>
            )}
            <Button variant="primary" isDisabled={password.length < MIN_SHARE_PASSWORD} onPress={() => passwordFor && update.mutate({ id: passwordFor.id, input: { password } })}>
              {t('common.save')}
            </Button>
          </>
        )}
      >
        <TextField label={t('soil.share.password')} type="password" value={password} onChange={setPassword} description={t('soil.share.passwordChangeHint')} />
      </ModalDialog>
    </Card>
  )
}
