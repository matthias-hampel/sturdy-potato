import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cx } from '#/ui/utils'

export const ONBOARDING_FLOW = ['organization', 'farm', 'crops', 'fields', 'invite'] as const
export type OnboardingFlowStep = (typeof ONBOARDING_FLOW)[number]

/** Progress of the setup: organization, farm, crop setup, fields, team. */
export function OnboardingSteps({ current }: { current: OnboardingFlowStep }) {
  const { t } = useTranslation()
  const index = ONBOARDING_FLOW.indexOf(current)
  return (
    <ol className="flex flex-wrap items-center gap-3 mb-8 text-sm" aria-label={t('onboarding.steps')}>
      {ONBOARDING_FLOW.map((step, i) => {
        const done = i < index
        const active = i === index
        return (
          <li key={step} className="flex items-center gap-3">
            <span className={cx('size-7 rounded-full flex items-center justify-center text-xs font-semibold border', done ? 'bg-primary border-primary text-primary-fg' : active ? 'border-primary text-primary bg-primary-soft' : 'border-line-strong text-muted')}>
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cx(active ? 'text-fg font-medium' : 'text-muted')} aria-current={active ? 'step' : undefined}>
              {t(`onboarding.step.${step}`)}
            </span>
            {i < ONBOARDING_FLOW.length - 1 && <span className="w-8 h-px bg-line-strong" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
