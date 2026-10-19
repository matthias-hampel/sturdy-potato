import { type CadastralParcel, LEASE_TYPES, type LeaseBucket, type LeaseType, leaseBucket, type ParcelLeaseInput, RENT_BASES, type RentBasis } from '@agmeo/contracts'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { DatePicker, NumberField, Option, Select, TextField } from '#/ui/Field'
import { Badge, type BadgeTone } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { parcelTitle } from './ParcelPicker'

/** Map colours by lease status: owned green, leased amber, exchange indigo, given up grey. */
export const BUCKET_COLOR: Record<LeaseBucket, string> = {
  ownership: '#10b981',
  leased: '#f59e0b',
  land_exchange: '#6366f1',
  abandoned: '#94a3b8',
  unknown: '#cbd5e1',
}

const BUCKET_TONE: Record<LeaseBucket, BadgeTone> = { ownership: 'success', leased: 'warning', land_exchange: 'info', abandoned: 'neutral', unknown: 'neutral' }

export function LeaseBadge({ type }: { type: LeaseType | null | undefined }) {
  const { t } = useTranslation()
  const bucket = leaseBucket(type)
  return (
    <Badge tone={BUCKET_TONE[bucket]} dot={BUCKET_COLOR[bucket]}>
      {type ? t(`cadastral.leaseType.${type}`) : t('cadastral.bucket.unknown')}
    </Badge>
  )
}

/** "1.200 € / Jahr" or "300 € / ha" as entered. */
export function rentText(p: CadastralParcel, currency: string) {
  const l = p.lease
  if (!l || l.rentAmount == null) return '—'
  return `${fmt.money(l.rentAmount, currency, l.rentAmount % 1 ? 2 : 0)} ${l.rentBasis === 'per_ha' ? '/ ha' : ''}`.trim()
}

type FormState = Required<{ [K in keyof ParcelLeaseInput]: Exclude<ParcelLeaseInput[K], undefined> }>

const initial = (p: CadastralParcel): FormState => ({
  leaseType: p.lease?.leaseType ?? 'ownership',
  ownerName: p.lease?.ownerName ?? '',
  ownerAddress: p.lease?.ownerAddress ?? '',
  leaseholderName: p.lease?.leaseholderName ?? '',
  rentAmount: p.lease?.rentAmount ?? null,
  rentBasis: p.lease?.rentBasis ?? 'per_year',
  startsOn: p.lease?.startsOn ?? null,
  endsOn: p.lease?.endsOn ?? null,
  landRegisterVolume: p.lease?.landRegisterVolume ?? '',
  landRegisterSheet: p.lease?.landRegisterSheet ?? '',
  landRegisterNumber: p.lease?.landRegisterNumber ?? '',
  notes: p.lease?.notes ?? '',
})

/** Lease record of a parcel: owner, leaseholder, kind of tenure, rent, term and land register. */
export function LeaseDialog({ parcel, onClose }: { parcel: CadastralParcel; onClose: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [form, setForm] = useState<FormState>(() => initial(parcel))
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const save = useOrgMutation((base, _: void) => api.put(`${base}/cadastral/parcels/${parcel.id}/lease`, form), { success: t('cadastral.lease.saved'), onSuccess: onClose })
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/cadastral/parcels/${parcel.id}`), { success: t('cadastral.parcel.removed'), onSuccess: onClose })
  const isLease = form.leaseType !== 'ownership'
  const invalidTerm = !!form.startsOn && !!form.endsOn && form.endsOn < form.startsOn
  const perYear = form.rentAmount == null ? null : form.rentBasis === 'per_ha' ? (form.rentAmount * parcel.areaM2) / 10_000 : form.rentAmount

  return (
    <ModalDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={t('cadastral.lease.title', { parcel: parcelTitle(parcel) })}
      description={[parcel.officialId, fmt.ha(parcel.areaM2 / 10_000, 4), parcel.fieldName].filter(Boolean).join(' · ')}
      footer={() => (
        <div className="flex w-full justify-between gap-2">
          <ConfirmButton
            title={t('cadastral.parcel.removeTitle')}
            message={t('cadastral.parcel.removeMessage', { parcel: parcelTitle(parcel) })}
            confirmLabel={t('common.delete')}
            onConfirm={() => remove.mutate()}
            trigger={<Button variant="ghost"><Trash2 /> {t('cadastral.parcel.remove')}</Button>}
          />
          <div className="flex gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" isDisabled={invalidTerm} isPending={save.isPending} onPress={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    >
      <Form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalidTerm) save.mutate() }}>
        <Select label={t('cadastral.lease.type')} items={LEASE_TYPES.map((id) => ({ id, name: t(`cadastral.leaseType.${id}`) }))} value={form.leaseType} onChange={(v) => v && set('leaseType', v as LeaseType)}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <div className="grid sm:grid-cols-2 gap-3">
          <TextField label={t('cadastral.lease.owner')} value={form.ownerName ?? ''} onChange={(v) => set('ownerName', v)} />
          <TextField label={t('cadastral.lease.ownerAddress')} value={form.ownerAddress ?? ''} onChange={(v) => set('ownerAddress', v)} />
        </div>
        {isLease && (
          <>
            <TextField label={t('cadastral.lease.leaseholder')} value={form.leaseholderName ?? ''} onChange={(v) => set('leaseholderName', v)} />
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField
                label={t('cadastral.lease.rent')}
                value={form.rentAmount ?? NaN}
                minValue={0}
                formatOptions={{ style: 'currency', currency: org.currency, maximumFractionDigits: 2 }}
                onChange={(v) => set('rentAmount', Number.isNaN(v) ? null : v)}
                description={perYear != null && form.rentBasis === 'per_ha' ? t('cadastral.lease.perYearHint', { amount: fmt.money(perYear, org.currency, 2) }) : undefined}
              />
              <Select label={t('cadastral.lease.rentBasis')} items={RENT_BASES.map((id) => ({ id, name: t(`cadastral.rentBasis.${id}`) }))} value={form.rentBasis} onChange={(v) => v && set('rentBasis', v as RentBasis)}>
                {(o) => <Option id={o.id}>{o.name}</Option>}
              </Select>
              <DatePicker label={t('cadastral.lease.startsOn')} value={form.startsOn} onChange={(v) => set('startsOn', v)} />
              <DatePicker label={t('cadastral.lease.endsOn')} value={form.endsOn} onChange={(v) => set('endsOn', v)} errorMessage={invalidTerm ? t('cadastral.lease.invalidTerm') : undefined} />
            </div>
          </>
        )}
        <div className="grid grid-cols-3 gap-3">
          <TextField label={t('cadastral.lease.landRegisterVolume')} value={form.landRegisterVolume ?? ''} onChange={(v) => set('landRegisterVolume', v)} />
          <TextField label={t('cadastral.lease.landRegisterSheet')} value={form.landRegisterSheet ?? ''} onChange={(v) => set('landRegisterSheet', v)} />
          <TextField label={t('cadastral.lease.landRegisterNumber')} value={form.landRegisterNumber ?? ''} onChange={(v) => set('landRegisterNumber', v)} />
        </div>
        <TextField label={t('cadastral.lease.notes')} multiline value={form.notes ?? ''} onChange={(v) => set('notes', v)} />
      </Form>
    </ModalDialog>
  )
}
