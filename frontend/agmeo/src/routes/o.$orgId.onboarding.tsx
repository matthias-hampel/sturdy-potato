import type { OnboardingStep } from '@agmeo/contracts'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { LifeBuoy, MapPinned, PartyPopper, Sprout, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CropSetupDialog } from '#/components/onboarding/CropSetupDialog'
import { InviteMembersDialog } from '#/components/onboarding/InviteMembersDialog'
import { OnboardingSteps } from '#/components/onboarding/OnboardingSteps'
import { useOnboardingStep } from '#/components/onboarding/useOnboardingStep'
import { useOrg } from '#/lib/org'
import { Button } from '#/ui/Button'
import { Card, PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/onboarding')({
  validateSearch: z.object({ step: z.enum(['crops', 'fields', 'invite']).optional().catch(undefined) }),
  component: OnboardingPage,
})

/**
 * Setup after the organization and its first farm (reference: app/onboarding): crop rotations
 * with technologies and prices, then fields, then inviting the team. Every step can be skipped;
 * the open step is stored on the organization, so the setup resumes where it was left.
 */
function OnboardingPage() {
  const { t } = useTranslation()
  const { org, orgId, can } = useOrg()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const setStep = useOnboardingStep()
  const step = search.step ?? org.onboardingStep ?? 'invite'
  const [dialog, setDialog] = useState<'crops' | 'invite' | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async (next: OnboardingStep | null) => {
    setBusy(true)
    try {
      await setStep(next)
      if (next === 'fields') await navigate({ to: '/o/$orgId/fields/new', params: { orgId }, search: { onboarding: true } })
      else if (next === null) await navigate({ to: '/o/$orgId/fields', params: { orgId } })
      else await navigate({ to: '/o/$orgId/onboarding', params: { orgId }, search: {} })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title={t('onboarding.title')} subtitle={t('onboarding.subtitle')} />
      <OnboardingSteps current={step} />
      <div className="grid md:grid-cols-[1fr_18rem] gap-6 items-start">
        {step === 'crops' && (
          <Card title={<span className="inline-flex items-center gap-2"><Sprout className="size-4 text-primary" aria-hidden /> {t('onboarding.crops.title')}</span>} description={t('onboarding.crops.description')}>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" isDisabled={!can('crop.write')} onPress={() => setDialog('crops')}>
                {t('onboarding.crops.open')}
              </Button>
              <Button variant="ghost" isPending={busy} onPress={() => void go('fields')}>
                {t('onboarding.skipStep')}
              </Button>
            </div>
          </Card>
        )}
        {step === 'fields' && (
          <Card title={<span className="inline-flex items-center gap-2"><MapPinned className="size-4 text-primary" aria-hidden /> {t('onboarding.fields.title')}</span>} description={t('onboarding.fields.description')}>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onPress={() => void navigate({ to: '/o/$orgId/fields/new', params: { orgId }, search: { onboarding: true } })}>
                {t('onboarding.fields.open')}
              </Button>
              <Button variant="ghost" isPending={busy} onPress={() => void go('invite')}>
                {t('onboarding.skipStep')}
              </Button>
            </div>
          </Card>
        )}
        {step === 'invite' && (
          <Card title={<span className="inline-flex items-center gap-2"><PartyPopper className="size-4 text-primary" aria-hidden /> {t('onboarding.done.title')}</span>} description={t('onboarding.done.description')}>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" isPending={busy} onPress={() => void go(null)}>
                {t('onboarding.done.start')}
              </Button>
              {can('members.manage') && (
                <Button onPress={() => setDialog('invite')}>
                  <Users /> {t('onboarding.done.invite')}
                </Button>
              )}
            </div>
          </Card>
        )}
        <aside className="rounded-xl border border-line bg-surface p-4 flex gap-3 items-start">
          <LifeBuoy className="size-6 text-primary shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="text-fg-2">{t('onboarding.contact.intro')}</p>
            <Link to="/o/$orgId/help" params={{ orgId }} className="mt-1 inline-block text-primary hover:underline">
              {t('onboarding.contact.help')}
            </Link>
          </div>
        </aside>
      </div>
      {step !== 'invite' && (
        <div className="mt-6">
          <Button variant="ghost" isPending={busy} onPress={() => void go(null)}>
            {t('onboarding.skipAll')}
          </Button>
        </div>
      )}
      {dialog === 'crops' && (
        <CropSetupDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            void go('fields')
          }}
        />
      )}
      {dialog === 'invite' && <InviteMembersDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
