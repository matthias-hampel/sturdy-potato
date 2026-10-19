import type { WeatherForecast, WeatherNotice } from '@agmeo/contracts'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Flame,
  Snowflake,
  Sun,
  SunDim,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'

/** WMO weather interpretation code (as used by Open-Meteo) → label and icon. */
export function weatherCode(code: number | null | undefined): { label: string; icon: LucideIcon } {
  switch (code) {
    case 0:
      return { label: t('weather.code.clearSky'), icon: Sun }
    case 1:
      return { label: t('weather.code.mainlyClear'), icon: Sun }
    case 2:
      return { label: t('weather.code.partlyCloudy'), icon: CloudSun }
    case 3:
      return { label: t('weather.code.overcast'), icon: Cloud }
    case 45:
    case 48:
      return { label: t('weather.code.fog'), icon: CloudFog }
    case 51:
    case 53:
    case 55:
      return { label: t('weather.code.drizzle'), icon: CloudDrizzle }
    case 56:
    case 57:
      return { label: t('weather.code.freezingDrizzle'), icon: CloudDrizzle }
    case 61:
      return { label: t('weather.code.lightRain'), icon: CloudRain }
    case 63:
      return { label: t('weather.code.rain'), icon: CloudRain }
    case 65:
      return { label: t('weather.code.heavyRain'), icon: CloudRain }
    case 66:
    case 67:
      return { label: t('weather.code.freezingRain'), icon: CloudHail }
    case 71:
    case 73:
    case 75:
    case 77:
      return { label: t('weather.code.snow'), icon: CloudSnow }
    case 80:
    case 81:
      return { label: t('weather.code.rainShowers'), icon: CloudRain }
    case 82:
      return { label: t('weather.code.heavyShowers'), icon: CloudRain }
    case 85:
    case 86:
      return { label: t('weather.code.snowShowers'), icon: CloudSnow }
    case 95:
      return { label: t('weather.code.thunderstorm'), icon: CloudLightning }
    case 96:
    case 99:
      return { label: t('weather.code.thunderstormHail'), icon: CloudHail }
    default:
      return { label: t('common.unknown'), icon: Cloud }
  }
}

const NOTICE_ICONS: Record<WeatherNotice['kind'], LucideIcon> = {
  frost: Snowflake,
  heavy_rain: Droplets,
  strong_wind: Wind,
  heat: Flame,
  dry_spell: SunDim,
}

/** Notice kind → translated label and icon (computed at render time). */
export function noticeKind(kind: WeatherNotice['kind']): { label: string; icon: LucideIcon } {
  const labels: Record<WeatherNotice['kind'], string> = {
    frost: t('weather.notice.kind.frost'),
    heavy_rain: t('weather.notice.kind.heavyRain'),
    strong_wind: t('weather.notice.kind.strongWind'),
    heat: t('weather.notice.kind.heat'),
    dry_spell: t('weather.notice.kind.drySpell'),
  }
  return { label: labels[kind], icon: NOTICE_ICONS[kind] }
}

/**
 * Translated notice text. The API sends an English `message`; the UI rebuilds the sentence
 * from `kind`, `severity` and the forecast values of the notice's day (same thresholds and
 * values the API uses). Falls back to the API message if the day is not in the forecast.
 */
export function noticeMessage(n: WeatherNotice, w: Pick<WeatherForecast, 'daily' | 'past' | 'precipitationLast7dMm'>): string {
  if (n.kind === 'dry_spell') {
    const last7 = w.precipitationLast7dMm ?? w.past.reduce((s, d) => s + (d.precipitationMm ?? 0), 0)
    const next5 = w.daily.slice(0, 5).reduce((s, d) => s + (d.precipitationMm ?? 0), 0)
    return t('weather.notice.drySpell', { last7: fmt.measure(last7, 'precipDepth'), next5: fmt.measure(next5, 'precipDepth') })
  }
  const day = w.daily.find((d) => d.date === n.date)
  switch (n.kind) {
    case 'frost':
      if (day?.tempMinC == null) break
      return n.severity === 'warning'
        ? t('weather.notice.frost', { value: fmt.measure(day.tempMinC, 'temperature') })
        : t('weather.notice.groundFrost', { value: fmt.measure(day.tempMinC, 'temperature') })
    case 'heavy_rain':
      if (day?.precipitationMm == null) break
      return t('weather.notice.heavyRain', { value: fmt.measure(day.precipitationMm, 'precipDepth') })
    case 'strong_wind':
      if (day?.gustMaxKmh == null) break
      return t('weather.notice.strongWind', { value: fmt.measure(day.gustMaxKmh, 'speed', { digits: 0 }) })
    case 'heat':
      if (day?.tempMaxC == null) break
      return t('weather.notice.heat', { value: fmt.measure(day.tempMaxC, 'temperature') })
  }
  return n.message
}

/** Open-Meteo local time strings ("2026-10-18T07:00", farm timezone, no offset). */
export const localDate = (time: string) => time.slice(0, 10)
export const localClock = (time: string) => time.slice(11, 16)
