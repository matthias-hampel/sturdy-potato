import { type Organization, type Permission, type Season, can } from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { today } from './format'

interface OrgContextValue {
  orgId: string
  org: Organization
  can: (permission: Permission) => boolean
}

const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({ org, children }: { org: Organization; children: ReactNode }) {
  const value = useMemo(() => ({ orgId: org.id, org, can: (p: Permission) => can(org.role, p) }), [org])
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used inside an organization route')
  return ctx
}

// ---------------------------------------------------------------------------
// Working season: selected once in the header and used by all season-aware pages.
// ---------------------------------------------------------------------------

interface SeasonContextValue {
  seasons: Season[]
  season: Season | null
  seasonId: string | undefined
  setSeasonId: (id: string) => void
  isLoading: boolean
}

const SeasonContext = createContext<SeasonContextValue | null>(null)

/** Same rule as the API: the season containing today, else the latest one that started. */
export function defaultSeason(seasons: Season[]): Season | null {
  const now = today()
  return (
    seasons.find((s) => s.startDate <= now && now <= s.endDate) ??
    [...seasons].filter((s) => s.startDate <= now).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
    seasons[seasons.length - 1] ??
    null
  )
}

export function SeasonProvider({ children }: { children: ReactNode }) {
  const { orgId } = useOrg()
  const storageKey = `agmeo.season.${orgId}`
  const { data: seasons = [], isLoading } = useQuery<Season[]>({
    queryKey: ['org', orgId, '/seasons', {}],
    queryFn: () => api.get<Season[]>(`/orgs/${orgId}/seasons`),
    staleTime: 15_000,
  })
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(storageKey)
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      if (selected) window.localStorage.setItem(storageKey, selected)
    } catch {
      // Storage unavailable (private mode); the selection lasts for this page only.
    }
  }, [selected, storageKey])

  const season = seasons.find((s) => s.id === selected) ?? defaultSeason(seasons)
  const value = useMemo(
    () => ({ seasons, season, seasonId: season?.id, setSeasonId: setSelected, isLoading }),
    [seasons, season, isLoading],
  )
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

export function useSeason() {
  const ctx = useContext(SeasonContext)
  if (!ctx) throw new Error('useSeason must be used inside SeasonProvider')
  return ctx
}
