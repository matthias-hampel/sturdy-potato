import type { Organization } from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { cx } from '#/ui/utils'

/**
 * Object URL of the organization's logo, or null without one. The image needs the access token,
 * so it is fetched as a blob; `logoUpdatedAt` versions the cache.
 */
export function useOrgLogo(org: Pick<Organization, 'id' | 'logoUpdatedAt'> | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ['org', org?.id, 'logo', org?.logoUpdatedAt],
    queryFn: () => api.blob(`/orgs/${org!.id}/logo`),
    enabled: !!org?.logoUpdatedAt,
    staleTime: Infinity,
  })
  const src = useMemo(() => (data ? URL.createObjectURL(data) : null), [data])
  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src)
  }, [src])
  return org?.logoUpdatedAt ? src : null
}

/** The organization's logo, kept inside its box; nothing without a logo. */
export function OrgLogo({ org, className, alt = '' }: { org: Pick<Organization, 'id' | 'logoUpdatedAt' | 'name'>; className?: string; alt?: string }) {
  const src = useOrgLogo(org)
  if (!src) return null
  return <img src={src} alt={alt} className={cx('object-contain', className)} />
}

/** Logo of the current organization for print views (top right of the sheet). */
export function PrintLogo({ className }: { className?: string }) {
  const { org } = useOrg()
  return <OrgLogo org={org} className={cx('h-12 max-w-44', className)} />
}
