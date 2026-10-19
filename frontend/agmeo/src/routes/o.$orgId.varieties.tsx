import type { VarietyDetail, VarietyRating, VarietySpecies, VarietySummary, VarietyTrait } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DataTable } from '#/components/table/DataTable'
import { type ColumnDef, useTableView } from '#/components/table/tableTools'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { ComboBox, Option, SearchField } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'

export const Route = createFileRoute('/o/$orgId/varieties')({
  validateSearch: z.object({ species: z.string().optional() }),
  component: VarietiesPage,
})

/** 1–9 susceptibility: low is good. */
export const ratingTone = (v: number): BadgeTone => (v <= 3 ? 'success' : v <= 6 ? 'warning' : 'danger')

/** BSL property keys ("neigung_zu_lager") as words, for properties without a translation. */
const humanize = (key: string) => {
  const s = key.replace(/_/g, ' ').replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/(?<![aeq])ue/g, 'ü')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function RatingBadges({ ratings, max = 2 }: { ratings: VarietyRating[]; max?: number }) {
  if (!ratings.length) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-wrap gap-1 whitespace-nowrap">
      {ratings.slice(0, max).map((r) => (
        <Badge key={r.disease} tone={ratingTone(r.susceptibility)}>
          {r.disease} {r.susceptibility}
        </Badge>
      ))}
      {ratings.length > max && <span className="text-xs text-muted">+{ratings.length - max}</span>}
    </span>
  )
}

/**
 * Variety browser (agmeo `app/varieties`): the Beschreibende Sortenliste of the Bundessortenamt by
 * species or crop, with the sowing traits (maturity, lodging, winter kill, yield, TKM) and the 1–9
 * disease ratings, and every listed property of a variety.
 */
function VarietiesPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const species = useOrgQuery<VarietySpecies[]>('/variety-catalogue/species', undefined, { staleTime: 3_600_000 })
  const selected = search.species ?? species.data?.find((s) => s.speciesCode === 'WW')?.key ?? species.data?.[0]?.key ?? null
  const list = useOrgQuery<VarietySummary[]>(selected ? '/variety-catalogue' : null, { species: selected }, { keepPrevious: true, staleTime: 3_600_000 })
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (list.data ?? []).filter((v) => !k || v.name.toLowerCase().includes(k) || (v.breeder ?? '').toLowerCase().includes(k))
  }, [list.data, q])

  const trait = (v: VarietySummary, key: VarietyTrait) => v.traits[key]?.value ?? null
  const columns: ColumnDef<VarietySummary>[] = [
    { id: 'name', label: t('varieties.col.name'), isRowHeader: true, value: (v) => v.name, render: (v) => <span className="font-medium">{v.name}{v.isNew && <Badge tone="info" className="ml-2">{t('varieties.new')}</Badge>}</span> },
    { id: 'kenn', label: t('varieties.col.kenn'), value: (v) => v.kennNummer, render: (v) => v.kennNummer ?? '—' },
    { id: 'group', label: t('varieties.col.group'), filter: 'select', value: (v) => v.subspecies, render: (v) => <span className="text-fg-2">{v.subspecies}</span> },
    { id: 'since', label: t('varieties.col.since'), align: 'end', filter: 'number', value: (v) => v.registeredSince, render: (v) => v.registeredSince ?? '—' },
    { id: 'breeder', label: t('varieties.col.breeder'), filter: 'select', value: (v) => v.breeder, render: (v) => <span className="truncate">{v.breeder ?? '—'}</span> },
    ...(['maturity', 'lodging', 'winterKill', 'yield', 'tkg'] as const).map(
      (key): ColumnDef<VarietySummary> => ({
        id: key,
        label: t(`varieties.trait.${key}`),
        align: 'end',
        filter: 'number',
        value: (v) => trait(v, key),
        render: (v) => (trait(v, key) != null ? fmt.num(trait(v, key), 1) : '—'),
      }),
    ),
    { id: 'ratings', label: t('varieties.col.ratings'), className: 'min-w-80', value: (v) => v.ratings[0]?.susceptibility ?? null, text: (v) => v.ratings.map((r) => r.disease).join(' '), render: (v) => <RatingBadges ratings={v.ratings} /> },
    {
      id: 'approval',
      label: t('varieties.col.approval'),
      filter: 'select',
      value: (v) => (v.approval ? (v.approval.endedOn ? t('varieties.approvalEnded') : t('varieties.approved')) : null),
      render: (v) => (v.approval ? v.approval.endedOn ? <Badge tone="neutral">{t('varieties.endedOn', { date: fmt.date(v.approval.endedOn) })}</Badge> : <Badge tone="success">{t('varieties.approved')}</Badge> : <span className="text-muted">—</span>),
    },
  ]
  const view = useTableView(columns, rows)

  return (
    <>
      <PageHeader title={t('varieties.title')} subtitle={t('varieties.subtitle')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <ComboBox
          label={t('varieties.species')}
          className="w-80"
          items={(species.data ?? []).map((s) => ({ id: s.key, name: s.crops.length ? `${s.name} (${s.crops.map((c) => c.name).join(', ')})` : s.name, count: s.count }))}
          value={selected}
          onChange={(v) => v && navigate({ search: { species: String(v) }, replace: true })}
        >
          {(s) => (
            <Option id={s.id} description={t('varieties.count', { count: s.count })}>
              {s.name}
            </Option>
          )}
        </ComboBox>
        <SearchField aria-label={t('varieties.search')} placeholder={t('varieties.search')} value={q} onChange={setQ} className="w-64" />
      </div>
      <Notice tone="info" className="mb-4">
        {t('varieties.scaleNotice')}
      </Notice>
      {species.isLoading || list.isLoading ? (
        <Loading />
      ) : species.error || list.error ? (
        <ErrorNotice error={species.error ?? list.error} />
      ) : !species.data?.length ? (
        <Card>
          <EmptyState icon={BookOpen} title={t('varieties.noData')}>
            {t('varieties.noDataHint')}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <DataTable aria-label={t('varieties.title')} view={view} row={(v) => ({ onAction: () => setOpen(v.id) })} empty={t('varieties.noneFound')} />
        </Card>
      )}
      {open && <VarietyDialog id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function VarietyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const detail = useOrgQuery<VarietyDetail>(`/variety-catalogue/${id}`)
  const d = detail.data
  const label = (name: string) => (i18n.exists(`varieties.property.${name}`) ? t(`varieties.property.${name}`) : humanize(name))
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={d ? d.name : t('common.loading')} size="lg">
      {!d ? (
        detail.error ? <ErrorNotice error={detail.error} /> : <Loading />
      ) : (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">{t('varieties.species')}</dt>
            <dd>{[d.speciesName, d.subspecies !== d.speciesName ? d.subspecies : null].filter(Boolean).join(' · ')}{d.usage ? ` (${d.usage})` : ''}</dd>
            <dt className="text-muted">{t('varieties.col.kenn')}</dt>
            <dd>{d.kennNummer ?? '—'}</dd>
            <dt className="text-muted">{t('varieties.col.breeder')}</dt>
            <dd>{d.breeder ?? '—'}{d.breederNumber ? ` (${d.breederNumber})` : ''}</dd>
            <dt className="text-muted">{t('varieties.col.since')}</dt>
            <dd>{d.registeredSince ?? '—'}{d.hybrid ? ` · ${t('varieties.hybrid')}` : ''}</dd>
            {d.approval && (
              <>
                <dt className="text-muted">{t('varieties.col.approval')}</dt>
                <dd>
                  {d.approval.grantedOn ? t('varieties.grantedOn', { date: fmt.date(d.approval.grantedOn) }) : '—'}
                  {d.approval.endedOn ? ` · ${t('varieties.endedOn', { date: fmt.date(d.approval.endedOn) })}` : ''}
                  {d.approval.marketableUntil ? ` · ${t('varieties.marketableUntil', { date: fmt.date(d.approval.marketableUntil) })}` : ''}
                </dd>
              </>
            )}
          </dl>
          {d.note && <p className="text-fg-2">{d.note}</p>}
          <div>
            <h3 className="mb-1 font-medium">{t('varieties.col.ratings')}</h3>
            <RatingBadges ratings={d.ratings} max={50} />
          </div>
          <div>
            <h3 className="mb-1 font-medium">{t('varieties.allProperties')}</h3>
            {d.properties.length === 0 ? (
              <p className="text-muted">{t('varieties.noProperties')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {d.properties.map((p) => (
                  <div key={`${p.kind}:${p.name}`} className="rounded-md border border-line px-2 py-1.5">
                    <div className="text-xs text-muted">{label(p.name)}{p.kind === 'quality' ? ` · ${t('varieties.quality')}` : ''}</div>
                    <div className="font-medium tabular">{typeof p.value === 'number' ? fmt.num(p.value, 2) : p.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </ModalDialog>
  )
}
