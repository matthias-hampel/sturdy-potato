import type { CurrentUser, SignInResult } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { applyUserLanguage } from '#/i18n'
import { SESSION_EXPIRED_EVENT, api, tokenStore } from './api'
import { authConfig, redirectToSignIn, redirectToSignOut, watchTokens } from './oidc'

/**
 * Authentication state. In production the API expects Keycloak tokens (see `./oidc`); in
 * development (AUTH_MODE=dev) `signInDev` signs in with any e-mail address. Either way the
 * access token sits in `tokenStore`, which the API client reads.
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

  const signInDev = useCallback(
    async (email: string, displayName?: string) => {
      const result = await api.post<SignInResult>('/auth/dev/sign-in', { email, displayName: displayName || undefined })
      tokenStore.set(result.accessToken)
      qc.clear()
      qc.setQueryData(['me'], result.user)
      return result.user
    },
    [qc],
  )

  const signOut = useCallback(async () => {
    tokenStore.clear()
    qc.clear()
    // Keycloak ends its own session and redirects back to /login.
    if (!(await redirectToSignOut())) void navigate({ to: '/login' })
  }, [qc, navigate])

  return {
    user: me.data ?? null,
    isLoading: hasToken && me.isLoading,
    isAuthenticated: hasToken,
    signInDev,
    signIn: redirectToSignIn,
    signOut,
    refresh: me.refetch,
  }
}

/**
 * Keeps the session alive (token renewal), sends the user to sign-in when the API reports an
 * expired session, and switches to the user's saved language.
 */
export function SessionWatcher() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const hasToken = tokenStore.get() != null
  const me = useQuery<CurrentUser>({ queryKey: ['me'], queryFn: () => api.get<CurrentUser>('/me'), enabled: hasToken, staleTime: 60_000, retry: false })

  useEffect(() => {
    const onExpired = () => {
      tokenStore.clear()
      qc.clear()
      void navigate({ to: '/login', search: { expired: true } })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [navigate, qc])

  useEffect(() => {
    let stop = () => {}
    let cancelled = false
    void authConfig()
      .then(() => watchTokens((token) => (token ? tokenStore.set(token) : tokenStore.clear())))
      .then((s) => (cancelled ? s() : (stop = s)))
      .catch(() => {})
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const locale = me.data?.locale
  useEffect(() => {
    if (locale) applyUserLanguage(locale)
  }, [locale])

  return null
}
