import type { CurrentUser, SignInResult } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { SESSION_EXPIRED_EVENT, api, tokenStore } from './api'

/**
 * Development authentication: sign in with any email address. The API issues a signed
 * token; the Keycloak integration will replace this with an OIDC (PKCE) redirect flow and
 * keep the same `useAuth` surface.
 */
export function useAuth() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const hasToken = tokenStore.get() != null

  const me = useQuery<CurrentUser>({
    queryKey: ['me'],
    queryFn: () => api.get<CurrentUser>('/me'),
    enabled: hasToken,
    staleTime: 60_000,
    retry: false,
  })

  const signIn = useCallback(
    async (email: string, displayName?: string) => {
      const result = await api.post<SignInResult>('/auth/dev/sign-in', { email, displayName: displayName || undefined })
      tokenStore.set(result.accessToken)
      qc.clear()
      qc.setQueryData(['me'], result.user)
      return result.user
    },
    [qc],
  )

  const signOut = useCallback(() => {
    tokenStore.clear()
    qc.clear()
    void navigate({ to: '/login' })
  }, [qc, navigate])

  return { user: me.data ?? null, isLoading: hasToken && me.isLoading, isAuthenticated: hasToken, signIn, signOut, refresh: me.refetch }
}

/** Sends the user to sign-in when the API reports an expired session. */
export function SessionWatcher() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  useEffect(() => {
    const onExpired = () => {
      tokenStore.clear()
      qc.clear()
      void navigate({ to: '/login', search: { expired: true } })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [navigate, qc])
  return null
}
