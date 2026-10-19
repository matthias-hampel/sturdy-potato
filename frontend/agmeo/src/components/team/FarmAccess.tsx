import type { Farm, Member } from '@agmeo/contracts'
import { useTranslation } from 'react-i18next'
import { useOrgQuery } from '#/lib/queries'
import { Checkbox, Switch } from '#/ui/Field'

/**
 * Which farms a member may see: every farm (null) or only the checked ones. The limit is
 * enforced by the API's row policies; owners are never limited.
 */
export function FarmAccessPicker({ value, onChange, isDisabled }: { value: string[] | null; onChange: (v: string[] | null) => void; isDisabled?: boolean }) {
  const { t } = useTranslation()
  const farms = useOrgQuery<Farm[]>('/farms')
  const list = farms.data ?? []
  return (
    <fieldset className="space-y-2" disabled={isDisabled}>
      <legend className="text-sm font-medium text-fg-2 mb-1">{t('team.farmAccess.label')}</legend>
      <Switch isSelected={value === null} isDisabled={isDisabled} onChange={(all) => onChange(all ? null : list.map((f) => f.id))}>
        {t('team.farmAccess.all')}
      </Switch>
      {value !== null && (
        <div className="rounded-lg border border-line p-2 space-y-1 max-h-48 overflow-y-auto">
          {list.map((f) => (
            <Checkbox
              key={f.id}
              isDisabled={isDisabled}
              isSelected={value.includes(f.id)}
              onChange={(on) => onChange(on ? [...value, f.id] : value.filter((id) => id !== f.id))}
            >
              {f.name}
            </Checkbox>
          ))}
          {!list.length && <p className="text-sm text-muted">{t('team.farmAccess.noFarms')}</p>}
        </div>
      )}
      <p className="text-xs text-muted">{t('team.farmAccess.hint')}</p>
    </fieldset>
  )
}

/** "All farms" or the farm names of a member's limit. */
export function farmAccessText(member: Pick<Member, 'farmIds'>, farms: Farm[], t: (k: string, o?: Record<string, unknown>) => string): string {
  if (member.farmIds === null) return t('team.farmAccess.allShort')
  if (!member.farmIds.length) return t('team.farmAccess.none')
  const names = farms.filter((f) => member.farmIds!.includes(f.id)).map((f) => f.name)
  return names.join(', ')
}
