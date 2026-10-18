import { LOCALE, t } from '#/i18n'

const locale = LOCALE

const cache = new Map<string, Intl.NumberFormat>()
function nf(options: Intl.NumberFormatOptions) {
  const key = JSON.stringify(options)
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat(locale, options)))
  return f
}

const dash = '—'

export const fmt = {
  num(v: number | null | undefined, digits = 0) {
    return v == null || Number.isNaN(v) ? dash : nf({ maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)
  },
  fixed(v: number | null | undefined, digits = 1) {
    return v == null || Number.isNaN(v) ? dash : nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)
  },
  ha(v: number | null | undefined, digits = 2) {
    return v == null ? dash : `${fmt.fixed(v, digits)} ha`
  },
  money(v: number | null | undefined, currency = 'EUR', digits = 0) {
    return v == null ? dash : nf({ style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)
  },
  pct(v: number | null | undefined, digits = 0) {
    return v == null ? dash : `${fmt.fixed(v, digits)} %`
  },
  qty(v: number | null | undefined, unit: string) {
    if (v == null) return dash
    const label = unit === 'm3' ? 'm³' : unit === 'unit' ? t('enum.baseUnit.unit') : unit
    const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 1 : 2
    return `${fmt.num(v, digits)} ${label}`
  },
  date(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!iso) return dash
    const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
    return d.toLocaleDateString(locale, opts)
  },
  shortDate(iso: string | null | undefined) {
    return fmt.date(iso, { day: 'numeric', month: 'short' })
  },
  dateTime(iso: string | null | undefined) {
    if (!iso) return dash
    return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  },
  weekday(iso: string) {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })
  },
  relativeDays(iso: string | null | undefined) {
    if (!iso) return dash
    const days = Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) / 86_400_000)
    // "heute", "morgen", "in 3 Tagen", "vor 2 Tagen"
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
  },
}

export function today() {
  return new Date().toLocaleDateString('sv-SE')
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}

/** Local datetime-local string → ISO with offset. */
export function localToIso(date: string, time = '08:00') {
  return new Date(`${date}T${time}:00`).toISOString()
}
