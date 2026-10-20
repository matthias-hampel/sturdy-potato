import type { OperationDraft, VoiceConfig, VoiceDraft, VoiceDraftStatus } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, ClipboardPlus, Mic, RotateCcw, Square, Trash2, Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { operationTypeLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/voice')({ component: VoicePage })

const STATUS_TONE: Record<VoiceDraftStatus, BadgeTone> = {
  pending: 'info',
  transcribing: 'info',
  draft: 'warning',
  confirmed: 'success',
  rejected: 'neutral',
  failed: 'danger',
}

/**
 * Voice drafts (agmeo `voice-drafts`): record a dictation on the field or type it, have it
 * transcribed and parsed into a draft operation, then review it and create the operation.
 */
function VoicePage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const config = useOrgQuery<VoiceConfig>('/voice-drafts/config', undefined, { staleTime: 300_000 })
  const drafts = useOrgQuery<VoiceDraft[]>('/voice-drafts', undefined, {
    // Recordings in transcription are polled until they are drafts.
    refetchInterval: (d) => (d?.some((x) => x.status === 'pending' || x.status === 'transcribing') ? 3000 : false),
  })
  const write = can('operation.write')
  const open = (drafts.data ?? []).filter((d) => d.status !== 'confirmed' && d.status !== 'rejected')
  const done = (drafts.data ?? []).filter((d) => d.status === 'confirmed' || d.status === 'rejected')

  return (
    <>
      <PageHeader title={t('voice.title')} subtitle={t('voice.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] items-start">
        <div className="space-y-6">
          {write && <Recorder config={config.data} />}
          {write && <TextDictation />}
        </div>
        <div className="space-y-4">
          {drafts.isLoading ? (
            <Loading />
          ) : drafts.error ? (
            <ErrorNotice error={drafts.error} />
          ) : !drafts.data?.length ? (
            <EmptyState icon={Mic} title={t('voice.empty')}>
              {t('voice.emptyHint')}
            </EmptyState>
          ) : (
            <>
              {open.map((d) => (
                <DraftCard key={d.id} draft={d} write={write} />
              ))}
              {done.length > 0 && (
                <Card title={t('voice.resolved')} padded={false}>
                  <ul className="divide-y divide-line text-sm">
                    {done.map((d) => (
                      <ResolvedRow key={d.id} draft={d} />
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** Picks a recording format the browser supports and the speech-to-text services accept. */
function recorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
}

function Recorder({ config }: { config: VoiceConfig | undefined }) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const started = useRef(0)
  const upload = useOrgMutation(
    (base, { blob, durationSec }: { blob: Blob; durationSec: number }) => {
      const form = new FormData()
      form.append('durationSec', String(durationSec))
      form.append('file', blob, `dictation.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
      return api.upload<VoiceDraft>(`${base}/voice-drafts/audio`, form)
    },
    { success: t('voice.uploaded') },
  )

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500)
    return () => clearInterval(id)
  }, [recording])
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((tr) => tr.stop()), [])

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = recorderMime()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        const blob = new Blob(chunks, { type: (rec.mimeType || mimeType || 'audio/webm').split(';')[0] })
        if (config && blob.size > config.maxAudioBytes) return setError(t('voice.tooLong'))
        if (blob.size) upload.mutate({ blob, durationSec: (Date.now() - started.current) / 1000 })
      }
      recorder.current = rec
      started.current = Date.now()
      setSeconds(0)
      rec.start(1000)
      setRecording(true)
    } catch {
      setError(t('voice.noMicrophone'))
    }
  }
  const stop = () => {
    recorder.current?.stop()
    setRecording(false)
  }

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  return (
    <Card title={t('voice.record')} description={t('voice.recordHint')}>
      {config && !config.transcription ? (
        <Notice tone="warning">{t('voice.notConfigured')}</Notice>
      ) : !supported ? (
        <Notice tone="warning">{t('voice.unsupported')}</Notice>
      ) : (
        <div className="flex items-center gap-3">
          {recording ? (
            <Button variant="danger" onPress={stop}>
              <Square /> {t('voice.stop')}
            </Button>
          ) : (
            <Button variant="primary" onPress={start} isPending={upload.isPending} isDisabled={!config}>
              <Mic /> {t('voice.start')}
            </Button>
          )}
          {recording && (
            <span className="flex items-center gap-2 text-sm tabular" aria-live="polite">
              <span className="size-2.5 rounded-full bg-danger animate-pulse" aria-hidden />
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  )
}

function TextDictation() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const create = useOrgMutation((base, transcript: string) => api.post<VoiceDraft>(`${base}/voice-drafts/text`, { transcript }), { onSuccess: () => setText('') })
  return (
    <Card title={t('voice.type')} description={t('voice.typeHint')}>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) create.mutate(text)
        }}
      >
        <TextField aria-label={t('voice.type')} multiline rows={4} value={text} onChange={setText} placeholder={t('voice.typePlaceholder')} />
        <Button type="submit" isPending={create.isPending} isDisabled={!text.trim()}>
          <Type /> {t('voice.parse')}
        </Button>
      </form>
    </Card>
  )
}

function DraftValues({ draft }: { draft: VoiceDraft }) {
  const { t } = useTranslation()
  const d = draft.draft as OperationDraft
  const r = draft.resolved
  const missing = new Set(d.missing)
  const value = (key: keyof OperationDraft, v: string | null) => (
    <span className={missing.has(key) ? 'text-danger' : v == null ? 'text-muted' : ''}>{v ?? (missing.has(key) ? t('voice.missingValue') : '—')}</span>
  )
  const rows: [string, React.ReactNode][] = [
    [t('voice.f.kind'), t(`voice.kind.${d.kind}`)],
    [t('voice.f.operationType'), r ? operationTypeLabel(r.operationType) : '—'],
    [t('voice.f.field'), value('fieldName', d.fieldName && (r?.fieldId ? d.fieldName : `${d.fieldName} (${t('voice.unknownField')})`))],
    [t('voice.f.article'), value('articleName', d.articleName && (r?.productId ? d.articleName : `${d.articleName} (${t('voice.unknownProduct')})`))],
    [t('voice.f.quantity'), value('quantity', d.quantity != null ? `${fmt.num(d.quantity, 3)} ${d.unit === 'm3/ha' ? 'm³/ha' : (d.unit ?? '')}` : null)],
    [t('voice.f.date'), r?.performedOn ? fmt.date(r.performedOn) : (d.date ?? '—')],
  ]
  if (d.bbch != null) rows.push([t('voice.f.bbch'), String(d.bbch)])
  if (d.windMs != null) rows.push([t('voice.f.wind'), `${fmt.num(d.windMs, 1)} m/s`])
  if (d.tempC != null) rows.push([t('voice.f.temp'), `${fmt.num(d.tempC, 1)} °C`])
  if (d.partialArea) rows.push([t('voice.f.partialArea'), d.partialAreaHa != null ? fmt.ha(d.partialAreaHa) : t('common.yes')])
  if (d.operatorHint) rows.push([t('voice.f.operator'), d.operatorHint])
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      {d.freeText && (
        <div className="contents">
          <dt className="text-muted">{t('voice.f.freeText')}</dt>
          <dd className="whitespace-pre-wrap">{d.freeText}</dd>
        </div>
      )}
    </dl>
  )
}

function DraftCard({ draft, write }: { draft: VoiceDraft; write: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<string | null>(null)
  const update = useOrgMutation((base, transcript: string) => api.patch<VoiceDraft>(`${base}/voice-drafts/${draft.id}`, { transcript }), { onSuccess: () => setEditing(null) })
  const reject = useOrgMutation((base) => api.post<VoiceDraft>(`${base}/voice-drafts/${draft.id}/reject`, {}), { success: t('voice.rejected') })
  const confirm = useOrgMutation((base) => api.post<VoiceDraft>(`${base}/voice-drafts/${draft.id}/confirm`, {}), { success: t('voice.confirmed') })
  const retry = useOrgMutation((base) => api.post<VoiceDraft>(`${base}/voice-drafts/${draft.id}/retry`, {}))
  const audioUrl = useAudioUrl(draft.hasAudio ? `/orgs/${orgId}/voice-drafts/${draft.id}/audio` : null)
  const busy = draft.status === 'pending' || draft.status === 'transcribing'
  const operation = draft.draft?.kind === 'operation'

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {fmt.dateTime(draft.createdAt)}
          <Badge tone={STATUS_TONE[draft.status]}>{t(`voice.status.${draft.status}`)}</Badge>
          {draft.confidence && <Badge tone={draft.confidence === 'high' ? 'success' : draft.confidence === 'medium' ? 'warning' : 'danger'}>{t(`voice.confidence.${draft.confidence}`)}</Badge>}
        </span>
      }
      actions={draft.source === 'audio' && draft.durationSec != null ? <span className="text-xs text-muted">{fmt.num(draft.durationSec)} s</span> : null}
    >
      <div className="space-y-3">
        {audioUrl && <audio controls src={audioUrl} className="w-full" preload="none" />}
        {busy && <p className="text-sm text-muted">{t('voice.transcribing')}</p>}
        {draft.status === 'failed' && <Notice tone="danger">{t('voice.failed', { error: draft.error ?? '' })}</Notice>}
        {editing != null ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (editing.trim()) update.mutate(editing)
            }}
          >
            <TextField aria-label={t('voice.transcript')} multiline rows={3} value={editing} onChange={setEditing} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" isPending={update.isPending}>
                {t('voice.reparse')}
              </Button>
              <Button onPress={() => setEditing(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : (
          draft.transcript != null && (
            <blockquote className="border-l-2 border-line pl-3 text-sm italic text-fg-2">
              „{draft.transcript}“
              {write && (draft.status === 'draft' || draft.status === 'failed') && (
                <Button variant="quiet" size="sm" className="ml-2 not-italic" onPress={() => setEditing(draft.transcript ?? '')}>
                  {t('voice.editTranscript')}
                </Button>
              )}
            </blockquote>
          )
        )}
        {draft.draft && <DraftValues draft={draft} />}
        {write && (
          <div className="flex flex-wrap gap-2 pt-1">
            {draft.status === 'draft' && operation && (
              <Button variant="primary" onPress={() => navigate({ to: '/o/$orgId/operations/new', params: { orgId }, search: { voiceDraftId: draft.id } })}>
                <ClipboardPlus /> {t('voice.createOperation')}
              </Button>
            )}
            {draft.status === 'draft' && !operation && (
              <Button variant="primary" onPress={() => confirm.mutate(undefined)} isPending={confirm.isPending}>
                <Check /> {t('voice.accept')}
              </Button>
            )}
            {draft.status === 'failed' && draft.hasAudio && (
              <Button onPress={() => retry.mutate(undefined)} isPending={retry.isPending}>
                <RotateCcw /> {t('voice.retry')}
              </Button>
            )}
            {(draft.status === 'draft' || draft.status === 'failed') && (
              <Button variant="ghost" onPress={() => reject.mutate(undefined)} isPending={reject.isPending}>
                <Trash2 /> {t('voice.reject')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function ResolvedRow({ draft }: { draft: VoiceDraft }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Badge tone={STATUS_TONE[draft.status]}>{t(`voice.status.${draft.status}`)}</Badge>
      <span className="min-w-0 flex-1 truncate text-fg-2">{draft.transcript ?? '—'}</span>
      {draft.operationId && (
        <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: draft.operationId }} variant="quiet" size="sm">
          {t('voice.openOperation')}
        </Link>
      )}
      <span className="text-xs text-muted">{fmt.dateTime(draft.createdAt)}</span>
    </li>
  )
}

/** The recording as an object URL (the API needs the bearer token, so no plain src link). */
function useAudioUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let revoked = false
    let objectUrl: string | null = null
    api
      .blob(path)
      .then((b) => {
        if (revoked) return
        objectUrl = URL.createObjectURL(b)
        setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])
  return url
}
