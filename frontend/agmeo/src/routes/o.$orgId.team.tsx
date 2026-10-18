import { ROLES, type Employee, type EmployeeInput, type InviteMemberInput, type Member, type Role, type UpdateMemberInput } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { HardHat, KeyRound, Mail, Pencil, Phone, Trash2, UserCheck, UserPlus, UserX, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Form, type Key } from 'react-aria-components'
import { Trans, useTranslation } from 'react-i18next'
import { FormActions, NONE, keyOrNull, textOrNull } from '#/components/resources/form'
import { t } from '#/i18n'
import { roleLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { fmt } from '#/lib/format'
import { openSearch, useOpenParam } from '#/lib/openParam'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ConfirmButton, Dialog, DialogTrigger, ModalDialog, Tooltip } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/team')({ validateSearch: openSearch, component: TeamPage })

const roleDescription = (role: Role) => t(`team.roleDescription.${role}`)
const roleItems = () => ROLES.map((id) => ({ id, name: roleLabel(id), description: roleDescription(id) }))

const MEMBER_STATUS_TONES: Record<Member['status'], BadgeTone> = {
  active: 'success',
  invited: 'info',
  disabled: 'neutral',
}

function TeamPage() {
  const { t } = useTranslation()
  const { open } = Route.useSearch()
  const [tab, setTab] = useState<Key>(open ? 'employees' : 'access')
  useEffect(() => {
    if (open) setTab('employees')
  }, [open])
  return (
    <>
      <PageHeader title={t('team.title')} subtitle={t('team.subtitle')} />
      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList aria-label={t('team.title')}>
          <Tab id="access">{t('team.tabs.access')}</Tab>
          <Tab id="employees">{t('team.employees.title')}</Tab>
        </TabList>
        <TabPanel id="access">
          <MembersTab />
        </TabPanel>
        <TabPanel id="employees">
          <EmployeesTab />
        </TabPanel>
      </Tabs>
    </>
  )
}

// ---------------------------------------------------------------------------
// App access
// ---------------------------------------------------------------------------

function MembersTab() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const { user } = useAuth()
  const canManage = can('members.manage')
  const members = useOrgQuery<Member[]>('/members')

  const update = useOrgMutation((base, { userId, ...input }: UpdateMemberInput & { userId: string }) => api.patch<Member>(`${base}/members/${userId}`, input), {
    success: (m) => t('team.members.updated', { name: m.displayName }),
  })
  const remove = useOrgMutation((base, m: Member) => api.delete(`${base}/members/${m.userId}`), { success: t('team.members.removed') })

  const sorted = [...(members.data ?? [])].sort(
    (a, b) => Number(a.status === 'disabled') - Number(b.status === 'disabled') || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.displayName.localeCompare(b.displayName),
  )

  return (
    <div className="space-y-4">
      <Notice icon={KeyRound}>
        <Trans i18nKey="team.members.devSignInNotice" components={{ b: <strong /> }} />
      </Notice>

      <Card
        title={t('team.members.title')}
        description={members.data ? t('team.members.withAccess', { count: members.data.filter((m) => m.status !== 'disabled').length }) : undefined}
        actions={canManage && <InviteDialog />}
        padded={false}
      >
        {members.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : members.error ? (
          <div className="p-4">
            <ErrorNotice error={members.error} />
          </div>
        ) : (
          <Table aria-label={t('team.members.title')}>
            <TableHeader>
              <Column isRowHeader>{t('common.name')}</Column>
              <Column>{t('team.email')}</Column>
              <Column>{t('team.role')}</Column>
              <Column>{t('common.status')}</Column>
              <Column>{t('team.members.lastSignIn')}</Column>
              {canManage && (
                <Column>
                  <span className="sr-only">{t('team.actions')}</span>
                </Column>
              )}
            </TableHeader>
            <TableBody items={sorted} dependencies={[canManage, user?.id, update.isPending]}>
              {(m) => {
                const isSelf = m.userId === user?.id
                const statusLabel = t(`team.memberStatus.${m.status}`)
                const statusTone = MEMBER_STATUS_TONES[m.status]
                return (
                  <Row id={m.userId} className={m.status === 'disabled' ? 'text-muted' : undefined}>
                    <Cell>
                      <span className="flex items-center gap-2.5 min-w-44">
                        <Avatar name={m.displayName} />
                        <span className="font-medium truncate">{m.displayName}</span>
                        {isSelf && <Badge tone="primary">{t('team.members.you')}</Badge>}
                      </span>
                    </Cell>
                    <Cell className="whitespace-nowrap text-fg-2">{m.email}</Cell>
                    <Cell>
                      {canManage ? (
                        <Select
                          aria-label={t('team.members.roleOf', { name: m.displayName })}
                          className="w-44"
                          items={roleItems()}
                          value={m.role}
                          isDisabled={update.isPending}
                          onChange={(v) => v && v !== m.role && update.mutate({ userId: m.userId, role: v as Role })}
                        >
                          {(r) => (
                            <Option id={r.id} description={r.description}>
                              {r.name}
                            </Option>
                          )}
                        </Select>
                      ) : (
                        <span className="whitespace-nowrap">{roleLabel(m.role)}</span>
                      )}
                    </Cell>
                    <Cell>
                      <Badge tone={statusTone}>{statusLabel}</Badge>
                    </Cell>
                    <Cell className="whitespace-nowrap tabular text-fg-2">{m.lastLoginAt ? fmt.dateTime(m.lastLoginAt) : <span className="text-muted">{t('team.members.never')}</span>}</Cell>
                    {canManage && (
                      <Cell className="w-0">
                        {!isSelf && (
                          <span className="flex items-center justify-end gap-1">
                            {m.status === 'disabled' ? (
                              <Tooltip content={t('team.members.enableTooltip')}>
                                <Button size="icon-sm" variant="ghost" aria-label={t('team.members.enable', { name: m.displayName })} onPress={() => update.mutate({ userId: m.userId, status: 'active' })}>
                                  <UserCheck />
                                </Button>
                              </Tooltip>
                            ) : (
                              <Tooltip content={t('team.members.disableTooltip')}>
                                <Button size="icon-sm" variant="ghost" aria-label={t('team.members.disable', { name: m.displayName })} onPress={() => update.mutate({ userId: m.userId, status: 'disabled' })}>
                                  <UserX />
                                </Button>
                              </Tooltip>
                            )}
                            <ConfirmButton
                              title={t('team.members.removeTitle')}
                              message={<Trans i18nKey="team.members.removeMessage" values={{ name: m.displayName, email: m.email }} components={{ b: <strong /> }} />}
                              confirmLabel={t('common.remove')}
                              onConfirm={() => remove.mutateAsync(m).catch(() => undefined)}
                              trigger={
                                <Button size="icon-sm" variant="ghost" aria-label={t('team.members.remove', { name: m.displayName })}>
                                  <Trash2 />
                                </Button>
                              }
                            />
                          </span>
                        )}
                      </Cell>
                    )}
                  </Row>
                )
              }}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .replace(/^(Dr\.?|Prof\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
  return (
    <span className="size-7 rounded-full bg-primary-soft text-primary text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden>
      {initials || '?'}
    </span>
  )
}

function InviteDialog() {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      <Button size="sm" variant="quiet">
        <UserPlus /> {t('team.invite.title')}
      </Button>
      <Dialog title={t('team.invite.title')} description={t('team.invite.description')} size="sm">
        {(close) => <InviteForm close={close} />}
      </Dialog>
    </DialogTrigger>
  )
}

function InviteForm({ close }: { close: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('worker')
  const invite = useOrgMutation((base, input: InviteMemberInput) => api.post<Member>(`${base}/members`, input), {
    success: (m) => t('team.invite.invited', { name: m.displayName }),
    onSuccess: close,
  })

  return (
    <Form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        invite.mutate({ email: email.trim(), displayName: displayName.trim(), role })
      }}
    >
      <TextField label={t('team.email')} type="email" isRequired autoFocus value={email} onChange={setEmail} placeholder="name@example.com" />
      <TextField label={t('common.name')} isRequired value={displayName} onChange={setDisplayName} />
      <Select label={t('team.role')} items={roleItems()} value={role} onChange={(v) => v && setRole(v as Role)} description={roleDescription(role)}>
        {(r) => (
          <Option id={r.id} description={r.description}>
            {r.name}
          </Option>
        )}
      </Select>
      <p className="text-xs text-muted">{t('team.invite.hint')}</p>
      <FormActions close={close} isPending={invite.isPending} submitLabel={t('team.invite.submit')} />
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

function EmployeesTab() {
  const { t } = useTranslation()
  const { org, can } = useOrg()
  const canWrite = can('team.write')
  const employees = useOrgQuery<Employee[]>('/employees')
  const members = useOrgQuery<Member[]>('/members')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  useOpenParam(employees.data, (e) => canWrite && setEditing(e))

  const memberName = (id: string | null) => (id ? (members.data?.find((m) => m.userId === id)?.displayName ?? t('team.employees.appUser')) : null)
  const sorted = [...(employees.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  const addButton = canWrite && (
    <Button size="sm" variant="quiet" onPress={() => setEditing('new')}>
      <UserPlus /> {t('team.employees.add')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <Notice icon={HardHat}>{t('team.employees.notice')}</Notice>

      <Card
        title={t('team.employees.title')}
        description={employees.data ? t('team.employees.activeCount', { count: employees.data.filter((e) => e.active).length }) : undefined}
        actions={sorted.length > 0 && addButton}
        padded={false}
      >
        {employees.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : employees.error ? (
          <div className="p-4">
            <ErrorNotice error={employees.error} />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('team.employees.empty.title')}
            action={
              canWrite && (
                <Button variant="primary" onPress={() => setEditing('new')}>
                  <UserPlus /> {t('team.employees.add')}
                </Button>
              )
            }
          >
            {t('team.employees.empty.text')}
          </EmptyState>
        ) : (
          <Table aria-label={t('team.employees.tableLabel')}>
            <TableHeader>
              <Column isRowHeader>{t('common.name')}</Column>
              <Column>{t('team.employees.jobTitle')}</Column>
              <Column>{t('team.employees.appUser')}</Column>
              <Column align="end">{t('team.employees.hourlyRate')}</Column>
              <Column align="end">{t('team.employees.hoursThisYear')}</Column>
              <Column>{t('common.status')}</Column>
              {canWrite && (
                <Column>
                  <span className="sr-only">{t('team.actions')}</span>
                </Column>
              )}
            </TableHeader>
            <TableBody items={sorted} dependencies={[canWrite, members.data, org.currency]}>
              {(e) => (
                <Row id={e.id} className={cx(!e.active && 'text-muted')}>
                  <Cell>
                    <div className="flex items-center gap-2.5 min-w-44">
                      <Avatar name={e.name} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{e.name}</div>
                        {(e.email || e.phone) && (
                          <div className="text-xs text-muted flex flex-wrap gap-x-3">
                            {e.email && (
                              <span className="inline-flex items-center gap-1">
                                <Mail className="size-3" aria-hidden /> {e.email}
                              </span>
                            )}
                            {e.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="size-3" aria-hidden /> {e.phone}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Cell>
                  <Cell className="whitespace-nowrap">{e.jobTitle ?? <span className="text-muted">—</span>}</Cell>
                  <Cell className="whitespace-nowrap">{memberName(e.userId) ?? <span className="text-muted">{t('team.employees.noAppAccess')}</span>}</Cell>
                  <Cell align="end">{e.hourlyRate != null ? `${fmt.money(e.hourlyRate, org.currency, 2)} / h` : <span className="text-muted">—</span>}</Cell>
                  <Cell align="end">{fmt.num(e.hoursThisYear, 1)} h</Cell>
                  <Cell>{e.active ? <Badge tone="success">{t('team.employees.active')}</Badge> : <Badge>{t('team.employees.inactive')}</Badge>}</Cell>
                  {canWrite && (
                    <Cell className="w-0">
                      <Button size="icon-sm" variant="ghost" aria-label={t('team.editName', { name: e.name })} onPress={() => setEditing(e)}>
                        <Pencil />
                      </Button>
                    </Cell>
                  )}
                </Row>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <ModalDialog
        isOpen={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing && editing !== 'new' ? t('team.editName', { name: editing.name }) : t('team.employees.add')}
        size="md"
      >
        {(close) => <EmployeeForm employee={editing && editing !== 'new' ? editing : undefined} members={members.data ?? []} employees={employees.data ?? []} close={close} />}
      </ModalDialog>
    </div>
  )
}

function EmployeeForm({ employee, members, employees, close }: { employee?: Employee; members: Member[]; employees: Employee[]; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [name, setName] = useState(employee?.name ?? '')
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? '')
  const [email, setEmail] = useState(employee?.email ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [hourlyRate, setHourlyRate] = useState(employee?.hourlyRate ?? NaN)
  const [userId, setUserId] = useState<string>(employee?.userId ?? NONE)
  const [active, setActive] = useState(employee?.active ?? true)

  // Each app user stands for one person, so offer only users not linked to another employee.
  const taken = new Set(employees.filter((e) => e.id !== employee?.id && e.userId).map((e) => e.userId))
  const userItems = [
    { id: NONE, name: t('team.employees.notLinked'), description: t('team.employees.notLinkedHint') },
    ...members.filter((m) => !taken.has(m.userId)).map((m) => ({ id: m.userId, name: m.displayName, description: `${m.email} · ${roleLabel(m.role)}` })),
  ]

  const save = useOrgMutation(
    (base, input: EmployeeInput) => (employee ? api.put<Employee>(`${base}/employees/${employee.id}`, input) : api.post<Employee>(`${base}/employees`, input)),
    { success: employee ? t('team.employees.updated') : t('team.employees.added'), onSuccess: close },
  )

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          name: name.trim(),
          jobTitle: textOrNull(jobTitle),
          email: textOrNull(email),
          phone: textOrNull(phone),
          hourlyRate: num(hourlyRate),
          userId: keyOrNull(userId),
          active,
        })
      }}
    >
      <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} />
      <TextField label={t('team.employees.jobTitle')} value={jobTitle} onChange={setJobTitle} placeholder={t('team.employees.jobTitlePlaceholder')} />
      <TextField label={t('team.email')} type="email" value={email} onChange={setEmail} />
      <TextField label={t('team.employees.phone')} type="tel" value={phone} onChange={setPhone} />
      <NumberField
        label={t('team.employees.hourlyRate')}
        unit={`${org.currency}/h`}
        value={hourlyRate}
        onChange={setHourlyRate}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 2 }}
        description={t('team.employees.hourlyRateHint')}
      />
      <Select
        label={t('team.employees.appUser')}
        items={userItems}
        value={userId}
        description={t('team.employees.appUserHint')}
        onChange={(v) => {
          const id = String(v ?? NONE)
          setUserId(id)
          const m = members.find((x) => x.userId === id)
          if (m) {
            if (!name.trim()) setName(m.displayName)
            if (!email.trim()) setEmail(m.email)
          }
        }}
      >
        {(u) => (
          <Option id={u.id} textValue={u.name} description={u.description}>
            {u.name}
          </Option>
        )}
      </Select>
      <div className="sm:col-span-2">
        <Switch isSelected={active} onChange={setActive}>
          {t('team.employees.active')}
          <span className="text-muted"> · {t('team.employees.activeHint')}</span>
        </Switch>
      </div>
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={employee ? t('common.saveChanges') : t('team.employees.add')} />
      </div>
    </Form>
  )
}
