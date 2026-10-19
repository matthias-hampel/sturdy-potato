import type { DmcOffsetBasis, DmcOffsetBatch, DmcOffsetVariety } from '@agmeo/contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { addDays, fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, TextField, num } from '#/ui/Field'
import { Badge, Card } from '#/ui/Layout'
import { ConfirmButton } from '#/ui/Overlay'
import { offsetPts } from './format'

/**
 * Variety offsets (the reference's region-offsets wizard, per variety): pool the measurements of
 * the selected varieties in a date range, see their mean offset, apply one offset to all of them.
 * Cycles of these varieties without their own measurement are forecast with it.
 */
export function VarietyOffsets({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const varieties = useOrgQuery<DmcOffsetVariety[]>('/maize-dmc/offsets/varieties', { harvestYear })
  const batches = useOrgQuery<DmcOffsetBatch[]>('/maize-dmc/offsets', { harvestYear })
  const [selected, setSelected] = useState<string[]>([])
  const [from, setFrom] = useState<string | null>(addDays(today(), -30))
  const [to, setTo] = useState<string | null>(today())
  const [offset, setOffset] = useState<number>(NaN)
  const [comment, setComment] = useState('')
  const basis = useOrgQuery<DmcOffsetBasis>(
    selected.length && from && to ? '/maize-dmc/offsets/basis' : null,
    { harvestYear, varietyIds: selected.join(','), from, to },
    { keepPrevious: true },
  )
  // Start from the suggestion whenever the basis changes.
  const suggested = basis.data?.suggestedOffset ?? null
  useEffect(() => {
    if (suggested != null) setOffset(Math.round(suggested * 1000) / 10)
  }, [suggested])

  const apply = useOrgMutation(
    (org, _: void) =>
      api.post(`${org}/maize-dmc/offsets`, {
        harvestYear,
        varietyIds: selected,
        offset: (num(offset) ?? 0) / 100,
        suggestedOffset: suggested,
        basis: { from, to, calibrationIds: basis.data?.points.map((p) => p.calibrationId) ?? [] },
        comment: comment.trim() || null,
      }),
    { success: t('dmc.offsets.applied'), onSuccess: () => setComment('') },
  )
  const revoke = useOrgMutation((org, ids: string[]) => api.post(`${org}/maize-dmc/offsets/revoke`, { ids }), { success: t('dmc.offsets.revoked') })

  if (!varieties.data?.length && !batches.data?.length) return null
  const editable = can('crop.write')
  return (
    <Card title={t('dmc.offsets.title')} description={t('dmc.offsets.description')}>
      <div className="space-y-5">
        {editable && (varieties.data?.length ?? 0) > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {varieties.data!.map((v) => (
                <Checkbox
                  key={v.varietyId}
                  isSelected={selected.includes(v.varietyId)}
                  onChange={(on) => setSelected((s) => (on ? [...s, v.varietyId] : s.filter((x) => x !== v.varietyId)))}
                >
                  {v.variety} <span className="text-xs text-muted">{t('dmc.offsets.varietyCounts', { cycles: v.cycleCount, measurements: v.measurementCount })}</span>
                </Checkbox>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <DatePicker label={t('dmc.offsets.from')} value={from} onChange={setFrom} className="w-44" />
              <DatePicker label={t('dmc.offsets.to')} value={to} onChange={setTo} className="w-44" />
              <NumberField
                label={t('dmc.offsets.offset')}
                unit={t('dmc.offsets.points')}
                minValue={-30}
                maxValue={30}
                step={0.1}
                value={offset}
                onChange={setOffset}
                className="w-40"
                description={
                  selected.length
                    ? t('dmc.offsets.suggestion', { count: basis.data?.points.length ?? 0, offset: offsetPts(suggested) })
                    : undefined
                }
              />
              <TextField label={t('dmc.offsets.comment')} value={comment} onChange={setComment} className="flex-1 min-w-40" />
              <Button
                variant="primary"
                isDisabled={!selected.length || num(offset) == null || !from || !to}
                isPending={apply.isPending}
                onPress={() => apply.mutate()}
                className="mb-px"
              >
                {t('dmc.offsets.apply', { count: selected.length })}
              </Button>
            </div>
          </div>
        )}
        {batches.data && batches.data.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {batches.data.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-16 font-medium tabular">{offsetPts(b.offset)}</span>
                <span className="flex flex-1 flex-wrap gap-1">
                  {b.varieties.map((v) => (
                    <Badge key={v.rowId}>{v.variety ?? v.varietyId}</Badge>
                  ))}
                </span>
                <span className="text-xs text-muted">
                  {t('dmc.offsets.batchMeta', {
                    by: b.appliedBy ?? '—',
                    at: fmt.dateTime(b.appliedAt),
                    count: b.basisCount,
                    suggested: offsetPts(b.suggestedOffset),
                  })}
                  {b.comment && ` · ${b.comment}`}
                </span>
                {b.supersededAt ? (
                  <Badge>{t('dmc.offsets.superseded')}</Badge>
                ) : (
                  <>
                    <Badge tone="primary">{t('dmc.offsets.active')}</Badge>
                    {editable && (
                      <ConfirmButton
                        title={t('dmc.offsets.revokeTitle')}
                        message={t('dmc.offsets.revokeMessage')}
                        confirmLabel={t('dmc.offsets.revoke')}
                        onConfirm={() => revoke.mutateAsync(b.varieties.map((v) => v.rowId))}
                        trigger={
                          <Button variant="ghost" size="sm">
                            {t('dmc.offsets.revoke')}
                          </Button>
                        }
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
