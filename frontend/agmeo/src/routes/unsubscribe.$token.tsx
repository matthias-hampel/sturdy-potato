import type { UnsubscribeResult } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { BellOff, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '#/components/Logo'
import { Button } from '#/ui/Button'
import { Notice } from '#/ui/Layout'

export const Route = createFileRoute('/unsubscribe/$token')({ component: UnsubscribePage })

/**
 * Unsubscribe link of a notification e-mail (reference: app/unsubscribe/[token]). No sign-in:
 * the signed token names the user and the notification. Asks before switching off, so link
 * scanners that open the page do not unsubscribe anyone.
 */
function UnsubscribePage() {
  const { t } = useTranslation()
  const { token } = Route.useParams()
  const [state, setState] = useState<'ask' | 'pending' | 'invalid' | UnsubscribeResult>('ask')
  const confirm = async () => {
    setState('pending')
    const res = await fetch('/api/v1/notifications/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    setState(res.ok ? ((await res.json()) as UnsubscribeResult) : 'invalid')
  }
  return (
    <div className="min-h-dvh bg-canvas flex flex-col items-center px-4 py-12">
      <Logo />
      <div className="mt-10 w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xs space-y-4">
        {typeof state === 'object' ? (
          <div className="flex gap-3 items-start">
            <CheckCircle2 className="size-6 text-primary shrink-0" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold">{t(`unsubscribe.done.${state.key}`)}</h1>
              <p className="text-sm text-muted mt-1">{t('unsubscribe.doneHint', { email: state.email })}</p>
            </div>
          </div>
        ) : state === 'invalid' ? (
          <Notice tone="danger">{t('unsubscribe.invalid')}</Notice>
        ) : (
          <>
            <div className="flex gap-3 items-start">
              <BellOff className="size-6 text-muted shrink-0" aria-hidden />
              <h1 className="text-lg font-semibold">{t('unsubscribe.title')}</h1>
            </div>
            <p className="text-sm text-fg-2">{t('unsubscribe.body')}</p>
            <div className="flex justify-end">
              <Button variant="primary" isPending={state === 'pending'} onPress={() => void confirm()}>
                {t('unsubscribe.confirm')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
