import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ClipboardList, Map, Satellite, ShieldAlert, Sprout } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Form } from 'react-aria-components'
import { z } from 'zod'
import { Logo } from '#/components/Logo'
import { roleLabel } from '#/i18n/labels'
import { errorMessage } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { Button } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ expired: z.boolean().optional() }),
  component: Login,
})

const PERSONAS = [
  { email: 'anna@example.com', name: 'Anna Bauer', role: 'owner' },
  { email: 'jonas@example.com', name: 'Jonas Meyer', role: 'manager' },
  { email: 'lena@example.com', name: 'Lena Schulz', role: 'worker' },
  { email: 'paul@example.com', name: 'Paul Krüger', role: 'accountant' },
] as const

function Login() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const { expired } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const go = async (address: string, displayName?: string) => {
    setPending(address)
    setError(null)
    try {
      const user = await signIn(address, displayName)
      const org = user.organizations[0]
      await navigate(org ? { to: '/o/$orgId', params: { orgId: org.id } } : { to: '/onboarding' })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-fg p-12 relative overflow-hidden">
        <FieldPattern />
        <Logo light className="relative" />
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold tracking-tight text-white leading-tight">{t('login.headline')}</h1>
          <p className="mt-4 text-lg text-sidebar-fg/80">{t('login.subline')}</p>
          <ul className="mt-10 space-y-4 text-sm">
            {[
              [Map, t('login.feature.fields')],
              [Sprout, t('login.feature.crops')],
              [ClipboardList, t('login.feature.records')],
              [Satellite, t('login.feature.monitoring')],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Map
              return (
                <li key={i} className="flex gap-3 items-start">
                  <span className="size-8 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                    <I className="size-4 text-[#a8d08d]" aria-hidden />
                  </span>
                  <span className="pt-1.5">{text as string}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">{t('login.footer')}</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <Logo className="lg:hidden mb-10" />
          <h2 className="text-2xl font-semibold tracking-tight">{t('login.title')}</h2>
          <p className="text-sm text-muted mt-1">{t('login.hint')}</p>

          {expired && <Notice tone="warning" className="mt-5">{t('login.expired')}</Notice>}

          <Form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void go(email, name)
            }}
          >
            <TextField label={t('login.email')} type="email" name="email" isRequired autoFocus value={email} onChange={setEmail} placeholder={t('login.emailPlaceholder')} />
            <TextField label={t('common.name')} name="name" value={name} onChange={setName} description={t('login.nameHint')} placeholder={t('common.optional')} />
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" className="w-full" isPending={pending === email && !!email}>
              {t('login.continue')}
            </Button>
          </Form>

          <div className="mt-8">
            <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2">{t('login.demoAccounts')}</div>
            <div className="grid grid-cols-2 gap-2">
              {PERSONAS.map((p) => (
                <Button key={p.email} variant="secondary" className="h-auto py-2 flex-col items-start text-left" isPending={pending === p.email} onPress={() => go(p.email, p.name)}>
                  <span className="text-sm font-medium text-fg">{p.name}</span>
                  <span className="text-xs text-muted font-normal">{roleLabel(p.role)}</span>
                </Button>
              ))}
            </div>
          </div>

          <Notice tone="warning" icon={ShieldAlert} className="mt-8">
            <Trans i18nKey="login.devNotice" components={{ b: <strong /> }} />
          </Notice>
        </div>
      </section>
    </div>
  )
}

/** Abstract strip-field pattern for the sign-in panel. */
function FieldPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-[0.07]" aria-hidden preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 800">
      <g fill="none" stroke="#cfe6bf" strokeWidth="1.5">
        {Array.from({ length: 28 }, (_, i) => (
          <path key={i} d={`M${-200 + i * 40} 900 L${200 + i * 40} -100`} />
        ))}
        <path d="M0 520 C 200 470, 420 600, 800 500" strokeWidth="3" />
        <path d="M0 260 C 260 300, 500 180, 800 240" strokeWidth="3" />
      </g>
    </svg>
  )
}
