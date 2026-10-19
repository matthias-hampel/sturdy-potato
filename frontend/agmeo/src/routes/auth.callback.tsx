import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { CurrentUser } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '#/components/Logo'
import { api, errorMessage, tokenStore } from '#/lib/api'
import { completeSignIn } from '#/lib/oidc'
import { Link } from '#/ui/Button'
import { Loading, Notice } from '#/ui/Layout'

export const Route = createFileRoute('/auth/callback')({ component: AuthCallback })

/** Keycloak redirects here after sign-in or registration. */
function AuthCallback() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  // The authorization code is single-use; React's development double effect must not redeem it twice.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const { token, returnTo } = await completeSignIn()
        tokenStore.set(token)
        qc.clear()
        const user = await api.get<CurrentUser>('/me')
        qc.setQueryData(['me'], user)
        if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
          window.location.replace(returnTo)
          return
        }
        const org = user.organizations[0]
        await navigate({ replace: true, ...(org ? { to: '/o/$orgId', params: { orgId: org.id } } : { to: '/onboarding' }) })
      } catch (e) {
        tokenStore.clear()
        setError(errorMessage(e))
      }
    })()
  }, [navigate, qc])

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Logo />
        {error ? (
          <>
            <Notice tone="danger">
              {t('auth.callbackFailed')} {error}
            </Notice>
            <Link to="/login" variant="primary">{t('auth.backToSignIn')}</Link>
          </>
        ) : (
          <Loading label={t('auth.completing')} />
        )}
      </div>
    </div>
  )
}
