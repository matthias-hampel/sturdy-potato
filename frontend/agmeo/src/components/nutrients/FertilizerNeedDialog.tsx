import type { Crop, FertilizerNeed, FertilizerNeedOverrides, FertilizerNeedRecord, NeedSource, NminReferenceValue, NNeedResult, PkNeedResult, SoilTexture } from '@agmeo/contracts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, History, Printer, RotateCcw } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { t as tt } from '#/i18n'
import { needSourceLabel, soilTextureItems, soilTextureLabel } from '#/i18n/labels.agronomy'
import { NUTRIENT_LABELS } from '#/i18n/labels.fieldwork'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'
import { ContentClassBadge, NeedSourceBadge } from './badges'

type Overrides = Omit<FertilizerNeedOverrides, 'note'>

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** Warnings come with an English message; the UI translates them by code. */
function warningText(w: { code: string; message: string }, need: FertilizerNeed) {
  return tt(`fertilizerNeed.warning.${w.code}`, { defaultValue: w.message, date: fmt.date(need.inputs.soilSample?.sampledOn) })
}

/**
 * Fertilizer need calculation (Düngebedarfsermittlung, DüV §4) of one crop. The inputs are derived
 * from the records; every change is previewed on the server, and saving documents the result.
 */
export function FertilizerNeedDialog({ cropCycleId, onClose }: { cropCycleId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const path = `/crop-cycles/${cropCycleId}/fertilizer-need`
  const base = useOrgQuery<FertilizerNeed>(path)
  const records = useOrgQuery<FertilizerNeedRecord[]>(`${path}/records`)
  const crops = useOrgQuery<Crop[]>('/crops')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [note, setNote] = useState('')
  const [pickReference, setPickReference] = useState(false)
  const [printing, setPrinting] = useState(false)
  const debounced = useDebounced(overrides, 400)
  const changed = Object.keys(debounced).length > 0
  const preview = useQuery<FertilizerNeed>({
    queryKey: ['org', orgId, `${path}/preview`, debounced],
    queryFn: () => api.post<FertilizerNeed>(`/orgs/${orgId}${path}/preview`, debounced),
    enabled: changed,
    placeholderData: keepPreviousData,
  })
  const save = useOrgMutation((base, _: void) => api.post<FertilizerNeed>(`${base}${path}`, { ...overrides, note: note.trim() || null }), {
    success: t('fertilizerNeed.saved'),
    onSuccess: () => setNote(''),
  })

  // Print the sheet once it is rendered, then remove it again.
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done, { once: true })
    const id = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const need = changed && preview.data ? preview.data : base.data
  const set = <K extends keyof Overrides>(key: K, value: Overrides[K] | undefined) =>
    setOverrides((o) => {
      const next = { ...o }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })

  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={t('fertilizerNeed.title')}
      description={need ? `${need.fieldName} · ${need.inputs.cropName} · ${fmt.ha(need.inputs.areaHa)}` : undefined}
      footer={(close) => (
        <>
          <Button onPress={() => setPrinting(true)} isDisabled={!need}>
            <Printer /> {t('fertilizerNeed.print')}
          </Button>
          {Object.keys(overrides).length > 0 && (
            <Button variant="ghost" onPress={() => setOverrides({})}>
              <RotateCcw /> {t('fertilizerNeed.resetInputs')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onPress={close}>
            {t('common.close')}
          </Button>
          {can('crop.write') && (
            <Button variant="primary" onPress={() => save.mutate()} isPending={save.isPending} isDisabled={!need || preview.isFetching}>
              {t('fertilizerNeed.save')}
            </Button>
          )}
        </>
      )}
    >
      {base.isLoading ? (
        <Loading />
      ) : base.error ? (
        <ErrorNotice error={base.error} />
      ) : need ? (
        <div className="space-y-5">
          {preview.error && <ErrorNotice error={preview.error} />}
          {need.warnings.map((w) => (
            <Notice key={w.code} tone="warning" icon={AlertTriangle}>
              {warningText(w, need)}
            </Notice>
          ))}
          {need.lastRecord && (
            <Notice tone="success" icon={CheckCircle2}>
              {t('fertilizerNeed.lastRecord', {
                date: fmt.dateTime(need.lastRecord.createdAt),
                name: need.lastRecord.createdBy ?? t('common.unknown'),
                n: need.lastRecord.n != null ? `${fmt.num(need.lastRecord.n, 1)} kg N/ha` : '—',
              })}
            </Notice>
          )}

          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
            <NeedInputs need={need} overrides={overrides} set={set} crops={crops.data ?? []} onPickReference={() => setPickReference(true)} />
            <div className={cx('space-y-5 transition-opacity', preview.isFetching && 'opacity-60')}>
              <Card title={t('fertilizerNeed.n.title')} description={need.n ? need.n.duevCrop : undefined} padded={!need.n}>
                {need.n ? <NLedger n={need.n} need={need} /> : <p className="text-sm text-muted">{t('fertilizerNeed.n.none')}</p>}
              </Card>
              <Card title={t('fertilizerNeed.pk.title')} padded={need.pk.length === 0}>
                {need.pk.length ? <PkTable rows={need.pk} /> : <p className="text-sm text-muted">{t('fertilizerNeed.pk.none')}</p>}
                <p className={cx('text-xs text-muted', need.pk.length ? 'px-4 py-3 border-t border-line' : 'mt-2')}>
                  {need.inputs.soilSample ? t('fertilizerNeed.pk.sample', { date: fmt.date(need.inputs.soilSample.sampledOn) }) : t('fertilizerNeed.pk.noSample')}
                  {' · '}
                  {need.limeDtCaO != null ? t('fertilizerNeed.lime', { value: fmt.num(need.limeDtCaO, 1) }) : t('fertilizerNeed.limeNone')}
                </p>
              </Card>
            </div>
          </div>

          {can('crop.write') && (
            <TextField label={t('fertilizerNeed.note')} description={t('fertilizerNeed.noteHint')} multiline rows={2} value={note} onChange={setNote} />
          )}

          <NeedHistory records={records.data ?? []} />
        </div>
      ) : null}

      {pickReference && (
        <NminReferencePicker
          cropCycleId={cropCycleId}
          selectedId={overrides.nminReferenceId ?? need?.inputs.nmin.referenceId ?? null}
          onPick={(ref) => {
            setOverrides((o) => {
              const { nmin: _, ...rest } = o
              return { ...rest, nminReferenceId: ref.id }
            })
            setPickReference(false)
          }}
          onClose={() => setPickReference(false)}
        />
      )}
      {printing && need && <PrintSheet need={need} note={note} />}
    </ModalDialog>
  )
}

/** A form field with the source of its current value underneath. */
function Sourced({ children, source }: { children: ReactNode; source?: ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      {children}
      {source && <div className="flex flex-wrap items-center gap-2">{source}</div>}
    </div>
  )
}

function NeedInputs({
  need,
  overrides,
  set,
  crops,
  onPickReference,
}: {
  need: FertilizerNeed
  overrides: Overrides
  set: <K extends keyof Overrides>(key: K, value: Overrides[K] | undefined) => void
  crops: Crop[]
  onPickReference: () => void
}) {
  const { t } = useTranslation()
  const i = need.inputs
  const grassland = need.n?.yieldUnit === 'dt TM/ha' || i.proteinPct != null
  const numberOr = (v: number | null | undefined) => v ?? Number.NaN
  // Cleared numbers fall back to the value derived from the records.
  const numeric = (key: 'expectedYieldTHa' | 'humusPct' | 'organicNPreviousYear' | 'proteinPct') => (v: number) => set(key, num(v) ?? undefined)
  const nminDetail = i.nmin.source === 'sample' && i.nmin.sampledOn ? fmt.date(i.nmin.sampledOn) : null
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t('fertilizerNeed.inputsHint')}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Sourced source={<NeedSourceBadge source={i.expectedYieldTHa.source} />}>
          <NumberField
            label={t('fertilizerNeed.input.expectedYield')}
            unit="t/ha"
            minValue={0}
            step={0.1}
            formatOptions={{ maximumFractionDigits: 2 }}
            value={numberOr(overrides.expectedYieldTHa ?? i.expectedYieldTHa.value)}
            onChange={numeric('expectedYieldTHa')}
          />
        </Sourced>
        <Sourced
          source={
            <>
              <NeedSourceBadge source={i.nmin.source} detail={nminDetail} />
              <Button size="sm" variant="quiet" onPress={onPickReference}>
                {t('fertilizerNeed.input.pickReference')}
              </Button>
            </>
          }
        >
          <NumberField
            label={t('fertilizerNeed.input.nmin')}
            unit="kg N/ha"
            minValue={0}
            formatOptions={{ maximumFractionDigits: 1 }}
            value={numberOr(overrides.nmin ?? i.nmin.value)}
            onChange={(v) => {
              set('nminReferenceId', undefined)
              set('nmin', num(v) ?? undefined)
            }}
          />
        </Sourced>
        <Sourced source={<NeedSourceBadge source={i.soilTexture.source} />}>
          <Select
            label={t('fertilizerNeed.input.soilTexture')}
            placeholder={t('soil.textureUnknown')}
            items={soilTextureItems()}
            value={overrides.soilTexture ?? i.soilTexture.value}
            onChange={(v) => set('soilTexture', (v as SoilTexture | null) ?? undefined)}
          >
            {(s) => <Option id={s.id}>{s.name}</Option>}
          </Select>
        </Sourced>
        <Sourced source={<NeedSourceBadge source={i.humusPct.source} />}>
          <NumberField
            label={t('fertilizerNeed.input.humus')}
            unit="%"
            minValue={0}
            maxValue={100}
            step={0.1}
            formatOptions={{ maximumFractionDigits: 1 }}
            value={numberOr(overrides.humusPct ?? i.humusPct.value)}
            onChange={numeric('humusPct')}
          />
        </Sourced>
        <Sourced source={<NeedSourceBadge source={i.previousCrop.source} />}>
          <ComboBox
            label={t('fertilizerNeed.input.previousCrop')}
            placeholder={t('fertilizerNeed.input.noCrop')}
            items={crops}
            value={overrides.previousCropId ?? i.previousCrop.id}
            onChange={(v) => set('previousCropId', v ? String(v) : undefined)}
          >
            {(c) => (
              <Option id={c.id} textValue={c.name}>
                <CropTag name={c.name} color={c.color} />
              </Option>
            )}
          </ComboBox>
        </Sourced>
        <Sourced source={<NeedSourceBadge source={i.catchCrop.source} detail={i.catchCrop.id ? catchCropKind(i.catchCrop) : null} />}>
          <ComboBox
            label={t('fertilizerNeed.input.catchCrop')}
            placeholder={t('fertilizerNeed.input.noCrop')}
            items={crops}
            value={overrides.catchCropId ?? i.catchCrop.id}
            onChange={(v) => set('catchCropId', v ? String(v) : undefined)}
          >
            {(c) => (
              <Option id={c.id} textValue={c.name}>
                <CropTag name={c.name} color={c.color} />
              </Option>
            )}
          </ComboBox>
        </Sourced>
        <Sourced source={<NeedSourceBadge source={i.organicNPreviousYear.source} />}>
          <NumberField
            label={t('fertilizerNeed.input.organicN')}
            description={t('fertilizerNeed.input.organicNHint')}
            unit="kg N/ha"
            minValue={0}
            formatOptions={{ maximumFractionDigits: 1 }}
            value={numberOr(overrides.organicNPreviousYear ?? i.organicNPreviousYear.value)}
            onChange={numeric('organicNPreviousYear')}
          />
        </Sourced>
        {grassland && (
          <NumberField
            label={t('fertilizerNeed.input.protein')}
            unit="%"
            minValue={0}
            maxValue={60}
            step={0.1}
            formatOptions={{ maximumFractionDigits: 1 }}
            value={numberOr(overrides.proteinPct ?? i.proteinPct)}
            onChange={numeric('proteinPct')}
          />
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        <Checkbox isSelected={overrides.nitrateSensitiveZone ?? i.nitrateSensitiveZone} onChange={(v) => set('nitrateSensitiveZone', v)}>
          {t('fertilizerNeed.input.redZone')}
        </Checkbox>
        <Checkbox isSelected={overrides.filmOrFleece ?? i.filmOrFleece} onChange={(v) => set('filmOrFleece', v)}>
          {t('fertilizerNeed.input.film')}
        </Checkbox>
        <Checkbox isSelected={overrides.strawRemoved ?? i.strawRemoved} onChange={(v) => set('strawRemoved', v)}>
          {t('fertilizerNeed.input.strawRemoved')}
        </Checkbox>
      </div>
    </div>
  )
}

function catchCropKind(c: FertilizerNeed['inputs']['catchCrop']) {
  return [c.legume ? tt('fertilizerNeed.catchCrop.legume') : null, c.winterHardy ? tt('fertilizerNeed.catchCrop.winterHardy') : tt('fertilizerNeed.catchCrop.frozen')].filter(Boolean).join(', ')
}

const signed = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'} ${fmt.num(Math.abs(v), 1)}`)

/** The N calculation laid out like the DüV form: requirement, corrections and deductions, need. */
/** The N need calculation line by line; also printed in the DüV report from saved records. */
export function NLedger({ n, need }: { n: NNeedResult; need: Pick<FertilizerNeed, 'inputs'> }) {
  const { t } = useTranslation()
  const i = need.inputs
  const lines: { label: ReactNode; value: number; kind?: 'start' | 'sum' | 'result'; hint?: ReactNode }[] = [
    { label: t('fertilizerNeed.ledger.requirement', { yield: fmt.num(n.referenceYield), unit: n.yieldUnit }), value: n.nRequirement, kind: 'start' },
    { label: t('fertilizerNeed.ledger.yieldCorrection'), hint: t('fertilizerNeed.ledger.expectedYield', { yield: fmt.num(n.expectedYield, 1), unit: n.yieldUnit }), value: n.yieldCorrection },
    { label: t('fertilizerNeed.ledger.nmin'), value: -n.nmin },
    { label: t('fertilizerNeed.ledger.humus'), hint: i.humusPct.value != null ? fmt.pct(i.humusPct.value, 1) : undefined, value: -n.humusDeduction },
    { label: t('fertilizerNeed.ledger.organic'), value: -n.organicPreviousYearDeduction },
    { label: t('fertilizerNeed.ledger.previousCrop'), hint: i.previousCrop.name, value: -n.previousCropDeduction },
    { label: t('fertilizerNeed.ledger.catchCrop'), hint: i.catchCrop.name, value: -n.catchCropDeduction },
    { label: t('fertilizerNeed.ledger.film'), value: n.filmSurcharge },
    { label: t('fertilizerNeed.ledger.subtotal'), value: n.needBeforeZone, kind: 'sum' },
    ...(i.nitrateSensitiveZone || n.zoneReduction ? [{ label: t('fertilizerNeed.ledger.redZone'), value: -n.zoneReduction }] : []),
    { label: t('fertilizerNeed.ledger.need'), value: n.need, kind: 'result' as const },
  ]
  return (
    <table className="w-full text-sm">
      <thead className="sr-only">
        <tr>
          <th>{t('fertilizerNeed.ledger.position')}</th>
          <th>kg N/ha</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, idx) => (
          <tr
            key={idx}
            className={cx(
              'border-b border-line last:border-0',
              l.kind === 'sum' && 'bg-surface-2/60 font-medium',
              l.kind === 'result' && 'bg-primary-soft font-semibold text-fg',
            )}
          >
            <td className="px-4 py-1.5">
              {l.kind === 'sum' || l.kind === 'result' ? '= ' : ''}
              {l.label}
              {l.hint && <span className="text-xs text-muted"> · {l.hint}</span>}
            </td>
            <td className={cx('px-4 py-1.5 text-right tabular whitespace-nowrap', !l.kind && l.value === 0 && 'text-muted')}>
              {l.kind ? fmt.num(l.value, 1) : signed(l.value)} <span className="text-xs text-muted font-normal">kg N/ha</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PkTable({ rows }: { rows: PkNeedResult[] }) {
  const { t } = useTranslation()
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr className="border-b border-line">
          <th className="text-left font-medium px-4 py-2">{t('fertilizerNeed.pk.nutrient')}</th>
          <th className="text-right font-medium px-3 py-2">{t('fertilizerNeed.pk.removal')}</th>
          <th className="text-center font-medium px-3 py-2">{t('soil.contentClass')}</th>
          <th className="text-right font-medium px-3 py-2">{t('fertilizerNeed.pk.factor')}</th>
          <th className="text-right font-medium px-4 py-2">{t('fertilizerNeed.pk.need')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.nutrient} className="border-b border-line last:border-0">
            <td className="px-4 py-1.5 font-medium">{NUTRIENT_LABELS[r.nutrient]}</td>
            <td className="px-3 py-1.5 text-right tabular">{fmt.num(r.removal, 1)}</td>
            <td className="px-3 py-1.5 text-center">{r.contentClass ? <ContentClassBadge value={r.contentClass} /> : <span className="text-muted">—</span>}</td>
            <td className="px-3 py-1.5 text-right tabular">× {fmt.num(r.factor, 2)}</td>
            <td className="px-4 py-1.5 text-right tabular font-medium whitespace-nowrap">
              {fmt.num(r.need, 1)} <span className="text-xs text-muted font-normal">kg/ha</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NeedHistory({ records }: { records: FertilizerNeedRecord[] }) {
  const { t } = useTranslation()
  if (records.length === 0) return null
  const pk = (r: FertilizerNeedRecord, nutrient: PkNeedResult['nutrient']) => r.result.pk.find((p) => p.nutrient === nutrient)?.need
  return (
    <Card title={<span className="inline-flex items-center gap-2"><History className="size-4 text-muted" aria-hidden /> {t('fertilizerNeed.history.title')}</span>} padded={false}>
      <Table aria-label={t('fertilizerNeed.history.title')}>
        <TableHeader>
          <Column isRowHeader>{t('fertilizerNeed.history.savedAt')}</Column>
          <Column>{t('fertilizerNeed.history.by')}</Column>
          <Column align="end">{t('fertilizerNeed.input.expectedYield')}</Column>
          <Column align="end">Nmin</Column>
          <Column align="end">{t('fertilizerNeed.ledger.need')}</Column>
          <Column align="end">P₂O₅</Column>
          <Column align="end">K₂O</Column>
        </TableHeader>
        <TableBody items={records}>
          {(r) => (
            <Row id={r.id}>
              <Cell className="tabular whitespace-nowrap">{fmt.dateTime(r.createdAt)}</Cell>
              <Cell className="text-fg-2">{r.createdBy ?? '—'}</Cell>
              <Cell align="end">{r.inputs.expectedYieldTHa.value != null ? `${fmt.fixed(r.inputs.expectedYieldTHa.value, 1)} t/ha` : '—'}</Cell>
              <Cell align="end">{fmt.num(r.inputs.nmin.value, 1)}</Cell>
              <Cell align="end" className="font-medium">{r.result.n ? `${fmt.num(r.result.n.need, 1)} kg N/ha` : '—'}</Cell>
              <Cell align="end">{fmt.num(pk(r, 'p2o5'), 1)}</Cell>
              <Cell align="end">{fmt.num(pk(r, 'k2o'), 1)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

function NminReferencePicker({
  cropCycleId,
  selectedId,
  onPick,
  onClose,
}: {
  cropCycleId: string
  selectedId: string | null
  onPick: (ref: NminReferenceValue) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const refs = useOrgQuery<NminReferenceValue[]>(`/crop-cycles/${cropCycleId}/nmin-references`, undefined, { staleTime: 3_600_000 })
  const list = refs.data ?? []
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} size="lg" title={t('fertilizerNeed.reference.title')} description={t('fertilizerNeed.reference.description')}>
      {refs.isLoading ? (
        <Loading />
      ) : refs.error ? (
        <ErrorNotice error={refs.error} />
      ) : list.length === 0 ? (
        <Notice>{t('fertilizerNeed.reference.empty')}</Notice>
      ) : (
        <Table aria-label={t('fertilizerNeed.reference.title')}>
          <TableHeader>
            <Column isRowHeader>{t('fertilizerNeed.reference.region')}</Column>
            <Column>{t('fertilizerNeed.reference.crop')}</Column>
            <Column>{t('fertilizerNeed.reference.soil')}</Column>
            <Column>{t('fertilizerNeed.input.previousCrop')}</Column>
            <Column align="end">{t('fertilizerNeed.reference.total')}</Column>
            <Column align="end">{t('fertilizerNeed.reference.year')}</Column>
            <Column>{t('fertilizerNeed.reference.source')}</Column>
          </TableHeader>
          <TableBody items={list}>
            {(r) => (
              <Row id={r.id} onAction={() => onPick(r)}>
                <Cell>
                  <span className="inline-flex items-center gap-1.5">
                    {r.id === selectedId && <Check className="size-4 text-primary" aria-label={t('fertilizerNeed.reference.selected')} />}
                    {r.region ?? r.state}
                  </span>
                </Cell>
                <Cell>{r.crop}</Cell>
                <Cell className="text-fg-2">{r.soil ?? '—'}</Cell>
                <Cell className="text-fg-2">{r.previousCrop ?? '—'}</Cell>
                <Cell align="end">
                  <span className="font-medium">{fmt.num(r.total, 0)} kg N/ha</span>
                  <div className="text-xs text-muted">
                    {[r.n0to30, r.n30to60, r.n60to90].map((v) => fmt.num(v, 0)).join(' / ')} · {r.depth}
                  </div>
                </Cell>
                <Cell align="end">{r.year}</Cell>
                <Cell className="text-xs">
                  {/^https?:\/\//.test(r.source) ? (
                    <a href={r.source} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {new URL(r.source).hostname}
                    </a>
                  ) : (
                    <span className="text-fg-2">{r.source}</span>
                  )}
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </ModalDialog>
  )
}

/**
 * Print-friendly sheet of the calculation, rendered next to the app only while printing; the
 * inline print style hides everything else on the page.
 */
function PrintSheet({ need, note }: { need: FertilizerNeed; note: string }) {
  const { t } = useTranslation()
  const i = need.inputs
  const source = (s: NeedSource) => <span className="text-xs text-neutral-500"> ({needSourceLabel(s)})</span>
  const value = (v: number | null | undefined, unit: string, digits = 1) => (v == null ? '—' : `${fmt.num(v, digits)} ${unit}`)
  return createPortal(
    <div className="agmeo-print hidden print:block bg-white text-black p-8 text-sm">
      <style>{'@media print { body > :not(.agmeo-print) { display: none !important } }'}</style>
      <h1 className="text-xl font-semibold">{t('fertilizerNeed.title')}</h1>
      <p className="mt-1">
        {need.fieldName} · {i.cropName} · {fmt.ha(i.areaHa)}
      </p>
      <p className="text-xs text-neutral-500 mt-0.5">{t('fertilizerNeed.printMeta', { ruleset: need.ruleset, date: fmt.dateTime(new Date().toISOString()) })}</p>

      <h2 className="font-semibold mt-6 mb-2">{t('fertilizerNeed.inputs')}</h2>
      <table className="w-full border-collapse">
        <tbody className="[&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1">
          <tr><td>{t('fertilizerNeed.input.expectedYield')}</td><td>{value(i.expectedYieldTHa.value, 't/ha', 2)}{source(i.expectedYieldTHa.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.nmin')}</td><td>{value(i.nmin.value, 'kg N/ha')}{source(i.nmin.source)}{i.nmin.sampledOn ? ` ${fmt.date(i.nmin.sampledOn)}` : ''}</td></tr>
          <tr><td>{t('fertilizerNeed.input.soilTexture')}</td><td>{i.soilTexture.value ? soilTextureLabel(i.soilTexture.value) : '—'}{source(i.soilTexture.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.humus')}</td><td>{value(i.humusPct.value, '%')}{source(i.humusPct.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.previousCrop')}</td><td>{i.previousCrop.name ?? '—'}{source(i.previousCrop.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.catchCrop')}</td><td>{i.catchCrop.name ?? '—'}{source(i.catchCrop.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.organicN')}</td><td>{value(i.organicNPreviousYear.value, 'kg N/ha')}{source(i.organicNPreviousYear.source)}</td></tr>
          <tr><td>{t('fertilizerNeed.input.redZone')}</td><td>{i.nitrateSensitiveZone ? t('common.yes') : t('common.no')}</td></tr>
          <tr><td>{t('fertilizerNeed.input.film')}</td><td>{i.filmOrFleece ? t('common.yes') : t('common.no')}</td></tr>
          <tr><td>{t('fertilizerNeed.input.strawRemoved')}</td><td>{i.strawRemoved ? t('common.yes') : t('common.no')}</td></tr>
          {i.proteinPct != null && <tr><td>{t('fertilizerNeed.input.protein')}</td><td>{value(i.proteinPct, '%')}</td></tr>}
          <tr><td>{t('soil.basicSample')}</td><td>{i.soilSample ? fmt.date(i.soilSample.sampledOn) : '—'}</td></tr>
        </tbody>
      </table>

      <h2 className="font-semibold mt-6 mb-2">{t('fertilizerNeed.n.title')}{need.n ? ` · ${need.n.duevCrop}` : ''}</h2>
      {need.n ? <div className="border border-neutral-300"><NLedger n={need.n} need={need} /></div> : <p>{t('fertilizerNeed.n.none')}</p>}

      <h2 className="font-semibold mt-6 mb-2">{t('fertilizerNeed.pk.title')}</h2>
      {need.pk.length ? <div className="border border-neutral-300"><PkTable rows={need.pk} /></div> : <p>{t('fertilizerNeed.pk.none')}</p>}
      <p className="mt-2">{need.limeDtCaO != null ? t('fertilizerNeed.lime', { value: fmt.num(need.limeDtCaO, 1) }) : t('fertilizerNeed.limeNone')}</p>

      {need.warnings.length > 0 && (
        <ul className="mt-4 list-disc pl-5">
          {need.warnings.map((w) => <li key={w.code}>{warningText(w, need)}</li>)}
        </ul>
      )}
      {note.trim() && <p className="mt-4"><strong>{t('fertilizerNeed.note')}:</strong> {note}</p>}
      <div className="mt-16 grid grid-cols-2 gap-12 text-xs text-neutral-500">
        <div className="border-t border-neutral-400 pt-1">{t('fertilizerNeed.printPlaceDate')}</div>
        <div className="border-t border-neutral-400 pt-1">{t('fertilizerNeed.printSignature')}</div>
      </div>
    </div>,
    document.body,
  )
}
