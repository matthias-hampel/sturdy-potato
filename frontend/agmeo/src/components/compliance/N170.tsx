import type { N170Balance, N170Data, N170Input } from '@agmeo/contracts'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Info, Leaf, Plus, Trash2, Warehouse } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, TextField, num } from '#/ui/Field'
import { Badge, Card, ErrorNotice, Loading, Notice, Stat } from '#/ui/Layout'
import { cx } from '#/ui/utils'

type Livestock = N170Data['livestock'][number]
type Transfer = N170Data['intake'][number] & { to?: string | null }

/** Organic N per ha against the 170 kg N limit, as a bar; the limit sits at 85 % of the track. */
export function N170Bar({ perHa, limit }: { perHa: number; limit: number }) {
  const { t } = useTranslation()
  const max = limit / 0.85
  const pct = Math.min(100, (perHa / max) * 100)
  const tone = perHa > limit ? 'bg-danger' : perHa > limit * 0.9 ? 'bg-warning' : 'bg-success'
  return (
    <div>
      <div className="relative h-3 rounded-full bg-surface-3 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={perHa} aria-label={t('regulatory.n170.perHa')}>
        <div className={cx('h-full rounded-full transition-[width]', tone)} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: '85%' }} aria-hidden />
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted tabular">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: '85%' }}>
          {t('regulatory.n170.limit', { limit })}
        </span>
      </div>
    </div>
  )
}

/** The balance: what was applied, what the farm had, and the result per ha. Also used in the printed report. */
export function N170Summary({ balance, preview }: { balance: N170Balance; preview?: { livestockN: number; intakeN: number; deliveryN: number; perHa: number } }) {
  const { t } = useTranslation()
  const v = preview ?? balance
  const exceeded = v.perHa > balance.limit
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={Leaf} label={t('regulatory.n170.applied')} value={fmt.qty(balance.appliedOrganicN, 'kg N')} hint={t('regulatory.n170.appliedHint')} />
        <Stat icon={Warehouse} label={t('regulatory.n170.livestock')} value={fmt.qty(v.livestockN, 'kg N')} hint={t('regulatory.n170.livestockHint')} />
        <Stat icon={ArrowDownToLine} label={t('regulatory.n170.intake')} value={fmt.qty(v.intakeN, 'kg N')} />
        <Stat icon={ArrowUpFromLine} label={t('regulatory.n170.delivery')} value={fmt.qty(v.deliveryN, 'kg N')} />
      </div>
      <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div>
            <div className="text-xs font-medium text-muted">{t('regulatory.n170.perHa')}</div>
            <div className="text-2xl font-semibold tabular">
              {fmt.num(v.perHa, 1)} <span className="text-sm font-normal text-muted">kg N/ha</span>
            </div>
          </div>
          {exceeded ? (
            <Badge tone="danger">
              <AlertTriangle className="size-3" aria-hidden />
              {t('regulatory.n170.exceeded')}
            </Badge>
          ) : (
            <Badge tone="success">{t('regulatory.n170.within')}</Badge>
          )}
        </div>
        <N170Bar perHa={v.perHa} limit={balance.limit} />
        <p className="text-xs text-muted mt-2">{t('regulatory.n170.rule', { area: fmt.ha(balance.areaHa) })}</p>
      </div>
    </div>
  )
}

export function N170Tab({ farmId, year }: { farmId: string; year: number }) {
  const balance = useOrgQuery<N170Balance>('/regulatory/n170', { farmId, year })
  if (balance.isLoading) return <Loading />
  if (balance.error) return <ErrorNotice error={balance.error} />
  return balance.data ? <N170Editor key={`${farmId}:${year}`} balance={balance.data} /> : null
}

const blankTransfer = (): Transfer => ({ name: '', date: today(), from: '', to: '', quantity: 0, nPerUnit: 0, p2o5PerUnit: null })

function N170Editor({ balance }: { balance: N170Balance }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const editable = can('farm.write')
  const [livestock, setLivestock] = useState<Livestock[]>(balance.data.livestock)
  const [intake, setIntake] = useState<Transfer[]>(balance.data.intake)
  const [delivery, setDelivery] = useState<Transfer[]>(balance.data.delivery)
  const [biogas, setBiogas] = useState(balance.data.onFarmBiogasPlant)
  const save = useOrgMutation((base, input: N170Input) => api.put<N170Balance>(`${base}/regulatory/n170`, input), { success: t('regulatory.n170.saved') })

  // Same arithmetic as the API, so the result follows the lists while editing.
  const livestockN = livestock.reduce((s, l) => s + l.animals * l.nPerAnimalYear, 0)
  const intakeN = intake.reduce((s, x) => s + x.quantity * x.nPerUnit, 0)
  const deliveryN = delivery.reduce((s, x) => s + x.quantity * x.nPerUnit, 0)
  const organic = Math.max(balance.appliedOrganicN, livestockN + intakeN - deliveryN)
  const preview = { livestockN, intakeN, deliveryN, perHa: balance.areaHa ? organic / balance.areaHa : 0 }

  const valid = livestock.every((l) => l.name.trim()) && [...intake, ...delivery].every((x) => x.name.trim() && x.date)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    save.mutate({
      farmId: balance.farmId,
      year: balance.year,
      livestock,
      intake: intake.map(({ to: _, ...x }) => x),
      delivery: delivery.map(({ from: _, ...x }) => ({ ...x, to: x.to ?? null })),
      onFarmBiogasPlant: biogas,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <N170Summary balance={balance} preview={preview} />
      {!editable && (
        <Notice tone="info" icon={Info}>
          {t('regulatory.n170.readOnly')}
        </Notice>
      )}

      <ListCard
        title={t('regulatory.n170.livestock.title')}
        description={t('regulatory.n170.livestock.description')}
        empty={t('regulatory.n170.livestock.empty')}
        count={livestock.length}
        onAdd={editable ? () => setLivestock((l) => [...l, { name: '', animals: 0, nPerAnimalYear: 0, grazingDays: null }]) : undefined}
      >
        {livestock.map((l, i) => {
          const update = (patch: Partial<Livestock>) => setLivestock((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <ListRow key={i} onRemove={editable ? () => setLivestock((all) => all.filter((_, j) => j !== i)) : undefined} total={l.animals * l.nPerAnimalYear}>
              <TextField label={t('regulatory.n170.livestock.name')} value={l.name} onChange={(name) => update({ name })} isRequired isReadOnly={!editable} className="sm:col-span-2" />
              <NumberField label={t('regulatory.n170.livestock.animals')} minValue={0} value={l.animals} onChange={(v) => update({ animals: num(v) ?? 0 })} isReadOnly={!editable} />
              <NumberField label={t('regulatory.n170.livestock.nPerAnimal')} unit="kg N" minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={l.nPerAnimalYear} onChange={(v) => update({ nPerAnimalYear: num(v) ?? 0 })} isReadOnly={!editable} />
              <NumberField label={t('regulatory.n170.livestock.grazingDays')} minValue={0} maxValue={366} value={l.grazingDays ?? NaN} onChange={(v) => update({ grazingDays: num(v) })} isReadOnly={!editable} />
            </ListRow>
          )
        })}
      </ListCard>

      <TransferList kind="intake" rows={intake} setRows={setIntake} editable={editable} />
      <TransferList kind="delivery" rows={delivery} setRows={setDelivery} editable={editable} />

      <Card>
        <Checkbox isSelected={biogas} onChange={setBiogas} isDisabled={!editable}>
          {t('regulatory.n170.biogas')}
        </Checkbox>
        <p className="text-xs text-muted mt-1.5 ml-6.5">{t('regulatory.n170.biogasHint')}</p>
      </Card>

      {editable && (
        <div className="flex items-center justify-end gap-3">
          {!valid && <span className="text-xs text-danger">{t('regulatory.n170.incomplete')}</span>}
          <Button type="submit" variant="primary" isPending={save.isPending} isDisabled={!valid}>
            {t('common.saveChanges')}
          </Button>
        </div>
      )}
    </form>
  )
}

/** Intake (Aufnahme) or delivery (Abgabe) of organic fertilizers. */
function TransferList({ kind, rows, setRows, editable }: { kind: 'intake' | 'delivery'; rows: Transfer[]; setRows: (fn: (rows: Transfer[]) => Transfer[]) => void; editable: boolean }) {
  const { t } = useTranslation()
  const party = kind === 'intake' ? 'from' : 'to'
  return (
    <ListCard
      title={t(`regulatory.n170.${kind}.title`)}
      description={t('regulatory.n170.transfer.description')}
      empty={t(`regulatory.n170.${kind}.empty`)}
      count={rows.length}
      onAdd={editable ? () => setRows((r) => [...r, blankTransfer()]) : undefined}
    >
      {rows.map((x, i) => {
        const update = (patch: Partial<Transfer>) => setRows((all) => all.map((y, j) => (j === i ? { ...y, ...patch } : y)))
        return (
          <ListRow key={i} onRemove={editable ? () => setRows((all) => all.filter((_, j) => j !== i)) : undefined} total={x.quantity * x.nPerUnit}>
            <TextField label={t('regulatory.n170.transfer.name')} value={x.name} onChange={(name) => update({ name })} isRequired isReadOnly={!editable} />
            <DatePicker label={t('common.date')} value={x.date} onChange={(date) => update({ date: date ?? '' })} isRequired isDisabled={!editable} />
            <TextField label={t(`regulatory.n170.transfer.${party}`)} value={x[party] ?? ''} onChange={(v) => update(party === 'from' ? { from: v } : { to: v })} isReadOnly={!editable} />
            <NumberField label={t('regulatory.n170.transfer.quantity')} unit={t('regulatory.n170.transfer.quantityUnit')} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={x.quantity} onChange={(v) => update({ quantity: num(v) ?? 0 })} isReadOnly={!editable} />
            <NumberField label={t('regulatory.n170.transfer.nPerUnit')} unit="kg N" minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={x.nPerUnit} onChange={(v) => update({ nPerUnit: num(v) ?? 0 })} isReadOnly={!editable} />
            <NumberField label={t('regulatory.n170.transfer.p2o5PerUnit')} unit="kg" minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={x.p2o5PerUnit ?? NaN} onChange={(v) => update({ p2o5PerUnit: num(v) })} isReadOnly={!editable} />
          </ListRow>
        )
      })}
    </ListCard>
  )
}

function ListCard({ title, description, empty, count, onAdd, children }: { title: string; description: string; empty: string; count: number; onAdd?: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Card
      title={title}
      description={description}
      padded={false}
      actions={
        onAdd && (
          <Button size="sm" variant="quiet" onPress={onAdd}>
            <Plus /> {t('common.add')}
          </Button>
        )
      }
    >
      {count === 0 ? <p className="p-4 text-sm text-muted">{empty}</p> : <div className="divide-y divide-line">{children}</div>}
    </Card>
  )
}

function ListRow({ children, onRemove, total }: { children: ReactNode; onRemove?: () => void; total: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap lg:flex-nowrap items-end gap-3 p-4">
      <div className="grid flex-1 grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 min-w-0">{children}</div>
      <div className="text-sm pb-2 w-24 text-right">
        <div className="text-xs text-muted">{t('common.total')}</div>
        <div className="tabular font-medium whitespace-nowrap">{fmt.qty(total, 'kg N')}</div>
      </div>
      {onRemove && (
        <Button size="icon" variant="ghost" onPress={onRemove} aria-label={t('common.remove')}>
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
