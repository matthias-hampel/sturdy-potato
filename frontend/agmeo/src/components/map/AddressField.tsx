import type { GeocodeHit, LatLng } from '@agmeo/contracts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ComboBox, Group, Input, ListBox } from 'react-aria-components'
import { api } from '#/lib/api'
import { inputClass, Label, ListPopover, Option } from '#/ui/Field'
import { cx } from '#/ui/utils'

const MIN_LENGTH = 3

interface Props {
  /** The geocoder is organization-scoped; onboarding passes the organization it just created. */
  orgId: string
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onSelect: (hit: GeocodeHit) => void
  /** Only addresses in this country. */
  country?: string
  /** Prefer hits near this point. */
  near?: LatLng | null
}

/** Address input that suggests matching addresses (OpenStreetMap via the API's geocoder) while typing. */
export function AddressField({ orgId, label, placeholder, value, onChange, onSelect, country, near }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(value.trim())
  useEffect(() => {
    const id = setTimeout(() => setQuery(value.trim()), 250)
    return () => clearTimeout(id)
  }, [value])
  // A saved or chosen address is not searched again until the user edits it, so the list stays closed.
  const [chosen, setChosen] = useState<string | null>(value)
  const editing = value !== chosen

  const params = { q: query, country, lat: near?.lat, lng: near?.lng, lang: 'de' }
  const enabled = editing && query.length >= MIN_LENGTH
  const results = useQuery({
    queryKey: ['geocode', orgId, params],
    queryFn: () => api.get<GeocodeHit[]>(`/orgs/${orgId}/geocode/search`, params),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const hits = enabled ? (results.data ?? []) : []
  // Open the list as soon as a search is due, so it shows the search state until the hits arrive.
  const searching = editing && value.trim().length >= MIN_LENGTH
  const pending = searching && (value.trim() !== query || results.isFetching)

  return (
    <ComboBox
      className="flex flex-col gap-1.5 min-w-0"
      items={hits}
      inputValue={value}
      onInputChange={onChange}
      selectedKey={null}
      onSelectionChange={(key) => {
        const hit = hits.find((h) => h.id === key)
        if (!hit) return
        setChosen(hit.address)
        onSelect(hit)
      }}
      allowsCustomValue
      allowsEmptyCollection={searching}
      menuTrigger="input"
    >
      <Label>{label}</Label>
      <Group className="relative">
        <Input placeholder={placeholder} className={cx(inputClass, 'pr-9')} />
        {pending && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted" aria-hidden />}
      </Group>
      <ListPopover>
        <ListBox<GeocodeHit>
          className="outline-none p-1 max-h-80 overflow-auto"
          renderEmptyState={() => <div className="px-2.5 py-1.5 text-sm text-muted">{t(pending ? 'onboarding.farm.addressSearching' : 'onboarding.farm.addressNoResults')}</div>}
        >
          {(hit) => (
            <Option id={hit.id} textValue={hit.address} description={hit.detail}>
              {hit.title}
            </Option>
          )}
        </ListBox>
      </ListPopover>
    </ComboBox>
  )
}

/**
 * Address and location of a farm that fill each other: choosing a suggested address places the
 * location, and placing the location on the map fills in the nearest address unless the user
 * typed or chose one.
 */
export function useFarmPlace(orgId: string | undefined, initial: { address: string | null; location: LatLng | null }) {
  const [address, setAddressValue] = useState(initial.address ?? '')
  const [location, setLocation] = useState<LatLng | null>(initial.location)
  const userAddress = useRef(!!initial.address?.trim())
  // Drops answers of reverse lookups that a newer click or an edit has overtaken.
  const lookup = useRef(0)

  const setAddress = (v: string) => {
    lookup.current++
    userAddress.current = v.trim() !== ''
    setAddressValue(v)
  }

  const select = (hit: GeocodeHit) => {
    lookup.current++
    userAddress.current = true
    setAddressValue(hit.address)
    setLocation(hit.location)
  }

  const pick = (loc: LatLng) => {
    setLocation(loc)
    if (userAddress.current || !orgId) return
    const n = ++lookup.current
    api
      .get<GeocodeHit | null>(`/orgs/${orgId}/geocode/reverse`, { lat: loc.lat, lng: loc.lng, lang: 'de' })
      .then((hit) => {
        if (n === lookup.current && !userAddress.current) setAddressValue(hit?.address ?? '')
      })
      // Without the geocoder the user types the address.
      .catch(() => {})
  }

  return { address, location, setAddress, select, pick }
}
