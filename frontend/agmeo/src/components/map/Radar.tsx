import { RADAR_PRECIPITATION_CLASSES, type RadarFrame, type RadarManifest } from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import { CloudRain, Info, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { LOCALE } from '#/i18n'
import { api, tokenStore } from '#/lib/api'
import { Button } from '#/ui/Button'
import { Switch } from '#/ui/Field'
import { ModalDialog } from '#/ui/Overlay'
import { cx, focusRing } from '#/ui/utils'
import type { MapImageOverlay } from './FieldMap'

/**
 * DWD precipitation radar on the field map, after the reference app (RadarPlayer, RadarOverlay,
 * queries/radar.ts): the last 6 hours of analyses and the 2-hour nowcast as one timeline. Off by
 * default; the choice is remembered in the browser. The slider follows "now" until the user
 * picks a frame.
 */

const STORAGE_KEY = 'agmeo.radar'
const FRAME_INTERVAL_MS = 600
const FIVE_MIN = 5 * 60_000

const frameUrl = (key: string) => `${window.location.origin}/api/v1/radar/frames/${key}.png`

function readEnabled() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export interface RadarState {
  enabled: boolean
  setEnabled: (on: boolean) => void
  manifest: RadarManifest | undefined
  isLoading: boolean
  isError: boolean
  frames: RadarFrame[]
  nowIndex: number
  /** The shown frame's index; follows the newest analysis unless the user picked one. */
  index: number
  setIndex: (i: number) => void
  frame: RadarFrame | null
  playing: boolean
  setPlaying: (on: boolean) => void
  /** The image for FieldMap's `image` prop; null when the radar is off or has no frame. */
  image: MapImageOverlay | null
}

export function useRadar(): RadarState {
  const [enabled, setEnabledState] = useState(readEnabled)
  // -1 = follow the newest analysis as new manifests arrive.
  const [picked, setPicked] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on)
    if (!on) {
      setPlaying(false)
      setPicked(-1)
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  }, [])

  const query = useQuery<RadarManifest>({
    queryKey: ['radar', 'manifest'],
    queryFn: () => api.get<RadarManifest>('/radar/manifest'),
    enabled,
    staleTime: 60_000,
    retry: false,
    // A new frame every 5 minutes; while the first frames are rendered (idle radar), poll faster.
    refetchInterval: (q) => (!enabled ? false : q.state.data?.frames.length ? FIVE_MIN : 20_000),
  })
  const manifest = query.data
  const frames = useMemo(() => manifest?.frames ?? [], [manifest])
  const nowIndex = manifest ? Math.max(0, manifest.nowIndex) : 0
  const index = frames.length ? (picked >= 0 && picked < frames.length ? picked : nowIndex) : -1

  useEffect(() => {
    if (!enabled || !playing || frames.length <= 1) return
    const timer = setInterval(() => setPicked((prev) => ((prev < 0 || prev >= frames.length ? nowIndex : prev) + 1) % frames.length), FRAME_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [enabled, playing, frames.length, nowIndex])

  // Frames are immutable: load them all once playback starts, so the loop runs from the cache.
  const warmed = useRef(new Set<string>())
  useEffect(() => {
    if (!enabled || !playing) return
    const keys = frames.map((f) => f.key).filter((k) => !warmed.current.has(k))
    let cancelled = false
    const worker = async () => {
      for (let key = keys.shift(); key && !cancelled; key = keys.shift()) {
        warmed.current.add(key)
        await fetch(frameUrl(key), { headers: { authorization: `Bearer ${tokenStore.get() ?? ''}` } }).catch(() => warmed.current.delete(key))
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()])
    return () => {
      cancelled = true
    }
  }, [enabled, playing, frames])

  const frame = index >= 0 ? frames[index] : null
  const bounds = manifest?.bounds
  const image = useMemo<MapImageOverlay | null>(() => (enabled && frame && bounds ? { url: frameUrl(frame.key), bounds, opacity: 0.85 } : null), [enabled, frame, bounds])

  return {
    enabled,
    setEnabled,
    manifest,
    isLoading: query.isLoading,
    isError: query.isError,
    frames,
    nowIndex,
    index,
    setIndex: (i) => {
      setPicked(i)
      setPlaying(false)
    },
    frame,
    playing,
    setPlaying,
    image,
  }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
const dayTime = (iso: string) => new Date(iso).toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** The on/off switch for the map's layer controls. */
export function RadarToggle({ radar }: { radar: RadarState }) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-3">
      <Switch isSelected={radar.enabled} onChange={radar.setEnabled}>
        <CloudRain className="size-4 text-fg-2" aria-hidden />
        {t('radar.title')}
      </Switch>
    </div>
  )
}

/** Player over the map: frame time, analysis/nowcast marker, play/pause and the time slider, legend. */
export function RadarPanel({ radar, className }: { radar: RadarState; className?: string }) {
  const { t } = useTranslation()
  const [infoOpen, setInfoOpen] = useState(false)
  // The thumb's value is a frame number; the shown time and kind describe it.
  const labelId = useId()
  const { frames, frame, index, nowIndex } = radar
  const frameLabel = (f: RadarFrame) => (f.kind === 'nowcast' ? t('radar.kind.nowcast', { minutes: f.leadMinutes }) : t('radar.kind.analysis'))
  const total = frames.length
  const nowPct = total > 1 ? (nowIndex / (total - 1)) * 100 : 100

  return (
    <div className={cx('z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-line bg-surface/95 p-3 text-sm shadow-[var(--shadow-overlay)]', className)}>
      <div className="flex items-center gap-2">
        <CloudRain className="size-4 shrink-0 text-fg-2" aria-hidden />
        <span className="font-medium text-fg">{t('radar.title')}</span>
        <span id={labelId} className="ml-auto flex items-center gap-1.5 tabular text-fg-2" aria-live={radar.playing ? 'off' : 'polite'}>
          {frame && (
            <>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  frame.kind === 'nowcast' ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-fg-2',
                )}
              >
                {frameLabel(frame)}
              </span>
              <span className="font-medium text-fg" title={dayTime(frame.time)}>
                {time(frame.time)}
              </span>
            </>
          )}
        </span>
        <Button size="icon-xs" variant="ghost" aria-label={t('radar.info.open')} onPress={() => setInfoOpen(true)}>
          <Info />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={t('radar.hide')} onPress={() => radar.setEnabled(false)}>
          <X />
        </Button>
      </div>

      {radar.isError ? (
        <p className="mt-2 text-fg-2">{t('radar.unavailable')}</p>
      ) : !total ? (
        <p className="mt-2 text-fg-2">{radar.isLoading || radar.manifest ? t('radar.loading') : t('radar.unavailable')}</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="secondary"
            className="shrink-0 rounded-full"
            aria-label={radar.playing ? t('radar.pause') : t('radar.play')}
            onPress={() => radar.setPlaying(!radar.playing)}
            isDisabled={total < 2}
          >
            {radar.playing ? <Pause /> : <Play />}
          </Button>
          <Slider
            aria-label={t('radar.slider')}
            minValue={0}
            maxValue={Math.max(0, total - 1)}
            step={1}
            value={Math.max(0, index)}
            onChange={(v) => radar.setIndex(v as number)}
            className="min-w-0 flex-1"
          >
            <SliderTrack className="relative h-7 cursor-pointer">
              {({ state }) => (
                <>
                  <div className="absolute inset-x-0 top-1/2 -mt-0.5 h-1 rounded-full bg-line" />
                  {/* The nowcast part of the timeline, right of "now". */}
                  <div className="absolute right-0 top-1/2 -mt-0.5 h-1 rounded-r-full bg-warning/50" style={{ left: `${nowPct}%` }} aria-hidden />
                  <div className="absolute top-1/2 -mt-0.5 h-1 rounded-l-full bg-primary" style={{ width: `${Math.min(state.getThumbPercent(0) * 100, nowPct)}%` }} aria-hidden />
                  {nowIndex < total - 1 && <div className="absolute top-1 h-5 w-px bg-fg-2" style={{ left: `${nowPct}%` }} aria-hidden />}
                  <SliderThumb aria-describedby={labelId} className={cx('top-1/2 size-4 rounded-full border border-line-strong bg-surface shadow-sm dragging:scale-110', focusRing)} />
                </>
              )}
            </SliderTrack>
          </Slider>
        </div>
      )}
      {total > 0 && (
        <div className="mt-0.5 flex justify-between pl-10 text-[11px] text-muted tabular" aria-hidden>
          <span>{time(frames[0].time)}</span>
          {nowIndex < total - 1 && <span>{t('radar.now')}</span>}
          <span>{time(frames[total - 1].time)}</span>
        </div>
      )}

      <RadarLegend className="mt-2" />
      <div className="mt-1.5 text-[11px] text-muted">{t('radar.attribution')}</div>
      <ModalDialog isOpen={infoOpen} onOpenChange={setInfoOpen} title={t('radar.info.title')} description={t('radar.info.description')} size="sm">
        <div className="flex flex-col gap-4 text-sm text-fg-2">
          {(
            [
              [t('radar.info.coverageTitle'), t('radar.info.coverage')],
              [t('radar.info.sourceTitle'), t('radar.info.source')],
              [t('radar.info.readingTitle'), t('radar.info.reading')],
            ] as const
          ).map(([title, text]) => (
            <section key={title}>
              <h3 className="font-medium text-fg">{title}</h3>
              <p className="mt-1">{text}</p>
            </section>
          ))}
        </div>
      </ModalDialog>
    </div>
  )
}

/** The colour classes of the radar images (the worker colours with the same table). */
export function RadarLegend({ className }: { className?: string }) {
  const { t } = useTranslation()
  const nf = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })
  return (
    <div className={className}>
      <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={t('radar.legend.label')}>
        {RADAR_PRECIPITATION_CLASSES.map((c) => (
          <span key={c.mmPerHour} className="flex-1" style={{ background: `rgba(${c.rgba[0]}, ${c.rgba[1]}, ${c.rgba[2]}, ${c.rgba[3] / 255})` }} />
        ))}
      </div>
      <div className="mt-0.5 flex text-[10px] leading-tight text-muted tabular" aria-hidden>
        {RADAR_PRECIPITATION_CLASSES.map((c) => (
          <span key={c.mmPerHour} className="flex-1">
            {nf.format(c.mmPerHour)}
          </span>
        ))}
        <span className="pl-1">{t('radar.legend.unit')}</span>
      </div>
    </div>
  )
}
