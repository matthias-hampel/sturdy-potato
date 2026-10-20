import { CLASS_KEYS, type SoilParameter, type SoilShareData, type SoilShareInfo } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { Download, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { Logo } from '#/components/Logo'
import { type MapZone, SoilZoneMap } from '#/components/soil/SoilZoneMap'
import { NO_DATA_COLOR, paramLabel, paramUnit, paramValue, STAGE_COLORS } from '#/components/soil/soilLabels'
import { fmt } from '#/lib/format'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { Badge, Card, EmptyState, Loading, Notice } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/share/soil/$token')({
  component: SharePage,
})

const BASE = '/api/v1/share/soil'
const accessKey = (token: string) => `agmeo.soilShare.${token}`
const readAccess = (token: string) => {
  try {
    return window.sessionStorage.getItem(accessKey(token))
  } catch {
    return null
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, init)
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null }
}

/**
 * Public share page of soil results (reference: app/share/soil/[token]): no sign-in; the link
 * and, when set, a password open the shared fields' zones and lab values.
 */
function SharePage() {
  const { t } = useTranslation()
  const { token } = Route.useParams()
  const [info, setInfo] = useState<SoilShareInfo | null>(null)
  const [data, setData] = useState<SoilShareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const open = async (pw: string | null) => {
    setBusy(true)
    const access = readAccess(token)
    const res = await call<SoilShareData & { code?: string }>(`${BASE}/${encodeURIComponent(token)}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(access ? { 'x-share-access': access } : {}) },
      body: JSON.stringify({ password: pw }),
    })
    setBusy(false)
    if (res.ok) {
      setData(res.body)
      setError(null)
      try {
        window.sessionStorage.setItem(accessKey(token), res.body.accessToken)
      } catch {
        // Private mode: the password is asked again on reload.
      }
    } else if (pw != null || !access) {
      setError(res.status === 429 ? t('soil.share.page.tooMany') : res.status === 401 ? t('soil.share.page.wrongPassword') : t('soil.share.page.unavailable'))
    }
  }

  useEffect(() => {
    void (async () => {
      const res = await call<SoilShareInfo>(`${BASE}/${encodeURIComponent(token)}`)
      if (!res.ok) {
        setError(t('soil.share.page.notFound'))
        return
      }
      setInfo(res.body)
      if (res.body.status === 'ok' && (!res.body.requiresPassword || readAccess(token))) await open(null)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <Logo />
        {info && (
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-fg truncate">{info.title}</h1>
            <p className="text-xs text-muted">
              {info.orgName} · {fmt.date(info.createdAt.slice(0, 10))}
            </p>
          </div>
        )}
      </header>
      <main className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        {!info && !error ? (
          <Loading />
        ) : !info ? (
          <EmptyState title={error} />
        ) : info.status !== 'ok' ? (
          <EmptyState title={t(`soil.share.page.${info.status}`)}>{t('soil.share.page.askOwner')}</EmptyState>
        ) : data ? (
          <ShareDashboard data={data} token={token} />
        ) : info.requiresPassword ? (
          <Card className="max-w-sm mx-auto mt-10">
            <Form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void open(password)
              }}
            >
              <div className="flex items-center gap-2 text-fg">
                <Lock className="size-5" /> <span className="font-medium">{t('soil.share.page.passwordTitle')}</span>
              </div>
              <TextField label={t('soil.share.password')} type="password" value={password} onChange={setPassword} autoFocus />
              {error && <Notice tone="danger">{error}</Notice>}
              <Button type="submit" variant="primary" isPending={busy} className="w-full">
                {t('soil.share.page.open')}
              </Button>
            </Form>
          </Card>
        ) : (
          <Loading />
        )}
      </main>
    </div>
  )
}

function ShareDashboard({ data, token }: { data: SoilShareData; token: string }) {
  const { t } = useTranslation()
  const [fieldId, setFieldId] = useState<string | null>(data.fields[0]?.fieldId ?? null)
  const [param, setParam] = useState<SoilParameter>(data.params[0] ?? 'ph')
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const field = data.fields.find((f) => f.fieldId === fieldId) ?? null
  const sampledCampaigns = field?.campaigns.filter((c) => c.sampledOn) ?? []
  const campaign = field?.campaigns.find((c) => c.zonationId === campaignId) ?? sampledCampaigns[0] ?? field?.campaigns[0] ?? null
  const classKey = (CLASS_KEYS as Record<string, 'ph' | 'p' | 'k' | 'mg'>)[param]
  const zones = useMemo<MapZone[]>(
    () =>
      (campaign?.zones ?? []).map((z) => ({
        key: z.id,
        geometry: z.geometry,
        color: classKey ? (z.classes[classKey] ? STAGE_COLORS[z.classes[classKey]!] : NO_DATA_COLOR) : z.color,
        label: z.values[param] != null ? paramValue(param, z.values[param]) : (z.probeNr?.toString() ?? z.label),
        point: z.samplePoint,
      })),
    [campaign, classKey, param],
  )

  if (!data.fields.length) return <EmptyState title={t('soil.share.page.noFields')} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t('soil.page.field')} className="w-64" items={data.fields.map((f) => ({ id: f.fieldId, name: f.fieldName }))} value={fieldId} onChange={(v) => (setFieldId(v ? String(v) : null), setCampaignId(null))}>
          {(item) => <Option id={item.id}>{item.name}</Option>}
        </Select>
        {data.params.length > 0 && (
          <Select label={t('soil.share.page.colouring')} className="w-48" items={data.params.map((p) => ({ id: p }))} value={param} onChange={(v) => v && setParam(v as SoilParameter)}>
            {(item) => <Option id={item.id}>{paramLabel(item.id)}</Option>}
          </Select>
        )}
        {data.kind === 'history' && field && field.campaigns.length > 1 && (
          <Select
            label={t('soil.share.history.sampleData')}
            className="w-56"
            items={field.campaigns.map((c) => ({ id: c.zonationId, label: c.sampledOn ? fmt.date(c.sampledOn) : `${fmt.date(c.createdAt.slice(0, 10))} · ${t('soil.share.history.notAnalysed')}` }))}
            value={campaign?.zonationId ?? null}
            onChange={(v) => setCampaignId(v ? String(v) : null)}
          >
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
        )}
        {data.hasFile && (
          <a className="ml-auto inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href={`${BASE}/${encodeURIComponent(token)}/file?access=${encodeURIComponent(data.accessToken)}`}>
            <Download className="size-4" /> {t('soil.share.page.download')}
          </a>
        )}
      </div>
      {field && (
        <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)] gap-4 items-start">
          <div className="space-y-2">
            <SoilZoneMap key={field.fieldId} boundary={field.geometry} zones={zones} className="h-[480px]" />
            {classKey && (
              <div className="flex flex-wrap gap-3 text-xs text-muted">
                {Object.entries(STAGE_COLORS).map(([s, c]) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className="size-2.5 rounded-sm" style={{ background: c }} /> {s}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Card title={`${field.fieldName} · ${fmt.ha(field.areaHa)}`} padded={false}>
            {campaign?.sampledOn && <p className="px-4 pt-2 text-xs text-muted">{t('soil.share.history.lastSample')}: {fmt.date(campaign.sampledOn)}</p>}
            <Table aria-label={field.fieldName}>
              <TableHeader>
                <Column isRowHeader>{t('soil.export.zonationPdf.probe')}</Column>
                <Column align="end">{t('soil.batch.fields.area')}</Column>
                {data.params.slice(0, 6).map((p) => (
                  <Column key={p} align="end">
                    {paramLabel(p)}
                  </Column>
                ))}
              </TableHeader>
              <TableBody items={campaign?.zones ?? []}>
                {(z) => (
                  <Row id={z.id}>
                    <Cell>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-3 rounded-sm" style={{ background: z.color }} />
                        {z.probeNr ?? z.label}
                      </span>
                    </Cell>
                    <Cell align="end">{fmt.ha(z.areaHa)}</Cell>
                    {data.params.slice(0, 6).map((p) => {
                      const key = (CLASS_KEYS as Record<string, 'ph' | 'p' | 'k' | 'mg'>)[p]
                      const cls = key ? z.classes[key] : (z.lab?.supplyClass?.[p] ?? null)
                      return (
                        <Cell key={p} align="end">
                          <span className="inline-flex items-center gap-1.5">
                            {paramValue(p, z.values[p])}
                            {cls && <Badge className={cx('!px-1.5')} dot={STAGE_COLORS[cls]}>{cls}</Badge>}
                          </span>
                        </Cell>
                      )
                    })}
                  </Row>
                )}
              </TableBody>
            </Table>
            <p className="px-4 py-2 text-xs text-muted">{data.params.slice(0, 6).map((p) => `${paramLabel(p)}${paramUnit(p) ? ` ${paramUnit(p)}` : ''}`).join(' · ')}</p>
          </Card>
        </div>
      )}
    </div>
  )
}
