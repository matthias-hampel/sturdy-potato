import { DEFAULT_RESULT_COLS, SOIL_EXPORT_FORMATS, type SoilExportFormat, type SoilExportInput, type SoilExportResult } from '@agmeo/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Radio, RadioGroup } from 'react-aria-components'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, TextField, num } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

const CUSTOMER_KEY = 'agmeo.soil.customerNumber'
const readCustomer = () => {
  try {
    return window.localStorage.getItem(CUSTOMER_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * Exports of the soil planner (reference: ExportZonationsModal): the lab's sample card, zonation
 * and results PDFs, GeoJSON and a shapefile. The file is downloaded and archived under "Soil exports".
 */
export function ExportDialog({ fieldIds, isOpen, onOpenChange }: { fieldIds: string[]; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [format, setFormat] = useState<SoilExportFormat>('sampleCard')
  const [customer, setCustomer] = useState(readCustomer)
  const [start, setStart] = useState<number | null>(null)
  const [result, setResult] = useState<SoilExportResult | null>(null)

  const run = useOrgMutation((base, input: SoilExportInput) => api.post<SoilExportResult>(`${base}/soil/exports`, input), {
    onSuccess: async (r) => {
      setResult(r)
      try {
        window.localStorage.setItem(CUSTOMER_KEY, customer)
      } catch {
        // Private mode: the number is simply not remembered.
      }
      await api.download(`/orgs/${orgId}/files/${r.file.id}/content`, undefined, r.file.name)
    },
  })
  const close = (open: boolean) => {
    if (!open) setResult(null)
    onOpenChange(open)
  }

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={close}
      size="lg"
      title={t('soil.export.title', { count: fieldIds.length })}
      footer={(closeDialog) =>
        result ? (
          <>
            <Button onPress={() => setResult(null)}>{t('soil.export.again')}</Button>
            <Button variant="primary" onPress={closeDialog}>
              {t('soil.done')}
            </Button>
          </>
        ) : (
          <>
            <Button onPress={closeDialog}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              isPending={run.isPending}
              onPress={() =>
                run.mutate({
                  fieldIds,
                  format,
                  customerNumber: customer || null,
                  startProbeNr: start,
                  params: format === 'resultsPdf' ? [...DEFAULT_RESULT_COLS] : null,
                })
              }
            >
              {t('soil.export.run')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="success">{t('soil.export.done', { name: result.file.name })}</Notice>
          {result.skippedFieldIds.length > 0 && <Notice tone="warning">{t('soil.export.skipped', { count: result.skippedFieldIds.length })}</Notice>}
          {result.probeNumbers > 0 && <p className="text-sm text-muted">{t('soil.export.sampleCard.autoAssignedHint', { count: result.probeNumbers })}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          <RadioGroup aria-label={t('soil.export.format')} value={format} onChange={(v) => setFormat(v as SoilExportFormat)} className="grid sm:grid-cols-2 gap-2">
            {SOIL_EXPORT_FORMATS.map((f) => (
              <Radio
                key={f}
                value={f}
                className={({ isSelected, isFocusVisible }) =>
                  cx('rounded-lg border px-3 py-2.5 cursor-pointer outline-none', isSelected ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2', isFocusVisible && 'ring-2 ring-primary/50')
                }
              >
                <span className="block text-sm font-medium text-fg">{t(`soil.export.${f}`)}</span>
                <span className="block text-xs text-muted mt-0.5">{t(`soil.export.${f}.hint`)}</span>
              </Radio>
            ))}
          </RadioGroup>
          {format === 'sampleCard' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField label={t('soil.export.sampleCard.customerNumber')} value={customer} onChange={setCustomer} maxLength={10} />
              <NumberField
                label={t('soil.export.sampleCard.startProbeNr')}
                description={t('soil.page.startHint')}
                minValue={1}
                formatOptions={{ useGrouping: false }}
                value={start ?? NaN}
                onChange={(v) => setStart(num(v))}
              />
            </div>
          )}
          <p className="text-xs text-muted">{t('soil.export.archiveHint')}</p>
        </div>
      )}
    </ModalDialog>
  )
}
