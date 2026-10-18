import { useTranslation } from 'react-i18next'
import { Button } from '#/ui/Button'

/** Select key standing for "no value" in optional selects. */
export const NONE = '__none'

/** `{ id, name }` items for a Select from a list of enum values and their labels. */
export function enumItems<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return values.map((id) => ({ id, name: labels[id] }))
}

/** Trimmed text or null when blank (the API treats empty optional text as absent). */
export const textOrNull = (v: string) => (v.trim() ? v.trim() : null)

/** Select key → id or null for the NONE option. */
export const keyOrNull = (v: string | null | undefined) => (v == null || v === NONE ? null : v)

/** Cancel + submit buttons at the bottom of a dialog form. */
export function FormActions({ close, isPending, submitLabel, isDisabled }: { close: () => void; isPending: boolean; submitLabel: string; isDisabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button onPress={close}>{t('common.cancel')}</Button>
      <Button type="submit" variant="primary" isPending={isPending} isDisabled={isDisabled}>
        {submitLabel}
      </Button>
    </div>
  )
}
