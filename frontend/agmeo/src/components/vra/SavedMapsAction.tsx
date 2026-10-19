import type { VraMapSummary } from '@agmeo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '#/lib/org'
import { Button, Link } from '#/ui/Button'
import { Menu, MenuItem, MenuTrigger } from '#/ui/Overlay'

/**
 * The saved application maps of a field as a menu, or a link to create one (reference
 * SavedApplicationMapsAction on the cultivation overview).
 */
export function SavedMapsAction({ fieldId, maps }: { fieldId: string; maps: VraMapSummary[] }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  if (!maps.length)
    return (
      <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId }} search={{ tab: 'maps' }} variant="secondary">
        <Layers /> {t('vra.saved.create')}
      </Link>
    )
  return (
    <MenuTrigger>
      <Button>
        <Layers /> {t('vra.saved.menu', { count: maps.length })} <ChevronDown />
      </Button>
      <Menu onAction={(key) => void navigate({ to: '/o/$orgId/fields/$fieldId', params: { orgId, fieldId }, search: { tab: 'maps', map: String(key) } })}>
        {maps.map((m) => (
          <MenuItem key={m.id} id={m.id}>
            {m.title}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  )
}
