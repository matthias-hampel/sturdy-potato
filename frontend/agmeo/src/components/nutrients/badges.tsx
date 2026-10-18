import type { ContentClass, NeedSource } from '@agmeo/contracts'
import { t } from '#/i18n'
import { needSourceLabel } from '#/i18n/labels.agronomy'
import { fmt } from '#/lib/format'
import { Badge, type BadgeTone } from '#/ui/Layout'

/** A and B are below the target (warm), C is the target, D and E are above it. */
const CLASS_TONE: Record<ContentClass, BadgeTone> = { A: 'warning', B: 'accent', C: 'success', D: 'info', E: 'info' }

export function ContentClassBadge({ value }: { value: ContentClass | null | undefined }) {
  if (!value) return null
  return (
    <Badge tone={CLASS_TONE[value]} className="px-1.5 font-semibold tabular">
      <span title={t('soil.contentClassOf', { class: value })}>{value}</span>
    </Badge>
  )
}

/** A lab value with its content class: "12,4 C". */
export function SoilValue({ value, cls, digits = 1 }: { value: number | null | undefined; cls?: ContentClass | null; digits?: number }) {
  if (value == null) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 tabular whitespace-nowrap">
      {fmt.num(value, digits)}
      <ContentClassBadge value={cls} />
    </span>
  )
}

const SOURCE_TONE: Record<NeedSource, BadgeTone> = { sample: 'success', reference: 'info', entered: 'primary', derived: 'neutral', default: 'warning' }

/** Where an input of the fertilizer need came from. */
export function NeedSourceBadge({ source, detail }: { source: NeedSource; detail?: string | null }) {
  return (
    <Badge tone={SOURCE_TONE[source]}>
      {needSourceLabel(source)}
      {detail && <span className="font-normal">{detail}</span>}
    </Badge>
  )
}
