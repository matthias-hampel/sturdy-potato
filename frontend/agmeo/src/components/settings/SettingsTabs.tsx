import type { CarbonSettings, DataProcessor, NotificationKey, NotificationSettings, Organization, UpdateOrganizationInput } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ImageUp, Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FileTrigger } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { useOrgLogo } from '#/components/OrgLogo'
import { ShareDialog, SharesList } from '#/components/soil/ShareDialog'
import { LOCALE } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, Switch } from '#/ui/Field'
import { Badge, Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

/** Saves organization settings and refreshes the organization everywhere. */
function useOrgUpdate(success?: string) {
  const qc = useQueryClient()
  return useOrgMutation((base, input: UpdateOrganizationInput) => api.patch<Organization>(base, input), {
    success,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/** Longest side of the stored logo; larger images are scaled down in the browser. */
const LOGO_MAX_PX = 512

/** Re-encodes an image file as PNG (at most 512 px), the format the API and the PDF writer read. */
async function normalizeLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('unreadable'))
      el.src = url
    })
    const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * scale)), height: Math.max(1, Math.round(img.naturalHeight * scale)) })
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function LogoCard() {
  const { t } = useTranslation()
  const { org, orgId, can } = useOrg()
  const qc = useQueryClient()
  const logo = useOrgLogo(org)
  const [busy, setBusy] = useState(false)
  const editable = can('org.manage')
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] })
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', await normalizeLogo(file), 'logo.png')
      await api.upload(`/orgs/${orgId}/logo`, form, 'PUT')
      await refresh()
      toast.success(t('settings.logo.saved'))
    } catch (e) {
      toast.error(e instanceof Error && e.message === 'unreadable' ? t('settings.logo.unreadable') : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/logo`), { success: t('settings.logo.removed'), onSuccess: refresh })
  return (
    <Card title={t('settings.logo.title')} description={t('settings.logo.description')}>
      <div className="flex items-center gap-4">
        <div className="size-20 rounded-lg border border-line bg-white flex items-center justify-center overflow-hidden shrink-0">
          {logo ? <img src={logo} alt={t('settings.logo.alt', { name: org.name })} className="max-h-18 max-w-18 object-contain" /> : <span className="text-xs text-muted px-2 text-center">{t('settings.logo.none')}</span>}
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <FileTrigger acceptedFileTypes={['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']} onSelect={(files) => files?.[0] && void upload(files[0])}>
              <Button isPending={busy}>
                <ImageUp /> {logo ? t('settings.logo.replace') : t('settings.logo.upload')}
              </Button>
            </FileTrigger>
            {logo && (
              <Button variant="ghost" isPending={remove.isPending} onPress={() => remove.mutate()}>
                <Trash2 /> {t('settings.logo.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------

const COUNTRIES = ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'DK', 'PL', 'CZ', 'SK', 'HU', 'RO', 'LT', 'LV', 'EE', 'ES', 'IT', 'GB', 'IE', 'UA', 'US']

export function RegionTab() {
  const { t } = useTranslation()
  const { org, can } = useOrg()
  const names = new Intl.DisplayNames([LOCALE], { type: 'region' })
  const save = useOrgUpdate(t('settings.org.updated'))
  const carbon = useOrgQuery<CarbonSettings>('/carbon/settings')
  const saveRegion = useOrgMutation((base, nuts2Code: string | null) => api.put<CarbonSettings>(`${base}/carbon/settings`, { nuts2Code }), { success: t('settings.region.saved') })
  const countries = [...new Set([org.country, ...COUNTRIES])].map((id) => ({ id, name: names.of(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="grid xl:grid-cols-2 gap-6 items-start">
      <Card title={t('settings.region.title')} description={t('settings.region.description')}>
        <div className="space-y-4">
          <Select label={t('settings.region.country')} description={t('settings.region.countryHint')} isDisabled={!can('org.manage')} items={countries} value={org.country} onChange={(v) => v && v !== org.country && save.mutate({ country: String(v) })}>
            {(c) => <Option id={c.id}>{c.name}</Option>}
          </Select>
          {org.country === 'DE' &&
            (carbon.data ? (
              <Select
                label={t('settings.region.nuts2')}
                description={t('settings.region.nuts2Hint')}
                isDisabled={!can('farm.write')}
                items={[{ code: '__auto', name: carbon.data.suggestedNuts2Code ? t('settings.region.nuts2Auto', { region: carbon.data.regions.find((r) => r.code === carbon.data!.suggestedNuts2Code)?.name ?? carbon.data.suggestedNuts2Code }) : t('settings.region.nuts2None') }, ...carbon.data.regions].map((r) => ({ id: r.code, name: r.name }))}
                value={carbon.data.nuts2Code ?? '__auto'}
                onChange={(v) => v && saveRegion.mutate(v === '__auto' ? null : String(v))}
              >
                {(r) => <Option id={r.id}>{r.name}</Option>}
              </Select>
            ) : carbon.isLoading ? (
              <Loading />
            ) : null)}
          <p className="text-xs text-muted">{t('settings.region.timezoneHint')}</p>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function NotificationsTab() {
  const { t } = useTranslation()
  const { org, can } = useOrg()
  const qc = useQueryClient()
  const save = useOrgUpdate(t('settings.notifications.saved'))
  const mine = useQuery({ queryKey: ['me', 'notifications'], queryFn: () => api.get<NotificationSettings>('/me/notifications') })
  const [pending, setPending] = useState<NotificationKey | null>(null)
  const setMine = async (key: NotificationKey, enabled: boolean) => {
    setPending(key)
    try {
      qc.setQueryData(['me', 'notifications'], await api.put<NotificationSettings>('/me/notifications', { [key]: enabled }))
      toast.success(t('settings.notifications.saved'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="grid xl:grid-cols-2 gap-6 items-start">
      <Card title={t('settings.notifications.orgTitle')} description={t('settings.notifications.orgDescription')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t('rainDigest.settings.title')}</div>
            <p className="text-xs text-muted mt-1">{t('rainDigest.orgSettings.description')}</p>
          </div>
          <Switch aria-label={t('rainDigest.settings.title')} isDisabled={!can('org.manage') || save.isPending} isSelected={org.rainDigestEnabled} onChange={(on) => save.mutate({ rainDigestEnabled: on })} />
        </div>
      </Card>
      <Card title={t('settings.notifications.mineTitle')} description={t('settings.notifications.mineDescription')}>
        {mine.isLoading ? (
          <Loading />
        ) : mine.error ? (
          <ErrorNotice error={mine.error} />
        ) : (
          <div className="space-y-4">
            {(['rain_digest', 'storage_digest'] as const).map((key) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t(`settings.notifications.key.${key}`)}</div>
                  <p className="text-xs text-muted mt-1">{t(`settings.notifications.keyHint.${key}`)}</p>
                  {key === 'rain_digest' && !org.rainDigestEnabled && <p className="text-xs text-warning mt-1">{t('settings.notifications.orgOff')}</p>}
                </div>
                <Switch aria-label={t(`settings.notifications.key.${key}`)} isDisabled={pending === key} isSelected={mine.data?.[key] ?? true} onChange={(on) => void setMine(key, on)} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ExportCard() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [busy, setBusy] = useState(false)
  if (!can('members.manage')) return <Notice>{t('settings.export.noPermission')}</Notice>
  const run = async () => {
    setBusy(true)
    try {
      await api.download(`/orgs/${orgId}/export`, { format }, 'agmeo-export.zip')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title={t('settings.export.title')} description={t('settings.export.description')}>
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t('settings.export.format')} className="w-40" items={[{ id: 'csv', name: 'CSV' }, { id: 'json', name: 'JSON' }]} value={format} onChange={(v) => v && setFormat(v as 'csv' | 'json')}>
          {(f) => <Option id={f.id}>{f.name}</Option>}
        </Select>
        <Button variant="primary" isPending={busy} onPress={() => void run()}>
          <Download /> {t('settings.export.download')}
        </Button>
      </div>
      <p className="text-xs text-muted mt-3">{t('settings.export.contents')}</p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Soil
// ---------------------------------------------------------------------------

export function SoilTab() {
  const { t } = useTranslation()
  const { org, can } = useOrg()
  const save = useOrgUpdate(t('settings.org.updated'))
  const [share, setShare] = useState(false)
  return (
    <div className="space-y-6">
      <Card title={t('settings.soil.title')}>
        <div className="space-y-2">
          <Switch isDisabled={!can('org.manage') || save.isPending} isSelected={org.lockZonedFields} onChange={(on) => save.mutate({ lockZonedFields: on })}>
            {t('settings.soil.lockZoned.label')}
          </Switch>
          <p className="text-xs text-muted max-w-xl">{t('settings.soil.lockZoned.description')}</p>
        </div>
      </Card>
      <Card
        title={t('settings.soil.historyLink.title')}
        description={t('settings.soil.historyLink.description')}
        actions={
          can('field.write') && (
            <Button size="sm" onPress={() => setShare(true)}>
              <Link2 /> {t('settings.soil.historyLink.create')}
            </Button>
          )
        }
      >
        <SharesList />
      </Card>
      <ShareDialog isOpen={share} onOpenChange={setShare} fieldIds={[]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data processing
// ---------------------------------------------------------------------------

export function DataProcessingTab() {
  const { t } = useTranslation()
  const rows = useOrgQuery<DataProcessor[]>('/data-processing', undefined, { staleTime: Infinity })
  return (
    <Card title={t('settings.dataProcessing.title')} description={t('settings.dataProcessing.description')} padded={false}>
      {rows.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : rows.error ? (
        <div className="p-4">
          <ErrorNotice error={rows.error} />
        </div>
      ) : (
        <Table aria-label={t('settings.dataProcessing.title')}>
          <TableHeader>
            <Column isRowHeader>{t('settings.dataProcessing.processor')}</Column>
            <Column>{t('settings.dataProcessing.purpose')}</Column>
            <Column>{t('settings.dataProcessing.categories')}</Column>
            <Column>{t('settings.dataProcessing.location')}</Column>
          </TableHeader>
          <TableBody items={rows.data ?? []}>
            {(r) => (
              <Row id={r.id}>
                <Cell className="font-medium whitespace-nowrap">
                  {r.name ? (
                    r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline underline-offset-2">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )
                  ) : (
                    <span className="text-muted">{t('settings.dataProcessing.notStated')}</span>
                  )}
                </Cell>
                <Cell className="text-sm text-fg-2 max-w-md whitespace-normal">{t(`settings.dataProcessing.purpose.${r.id}`)}</Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    {r.categories.map((c) => (
                      <Badge key={c}>{t(`settings.dataProcessing.category.${c}`)}</Badge>
                    ))}
                  </div>
                </Cell>
                <Cell className="text-sm">{r.location ?? '—'}</Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
      <p className="p-4 text-xs text-muted border-t border-line">{t('settings.dataProcessing.footer')}</p>
    </Card>
  )
}
