import type { OnboardingStep, Organization } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { toast } from '#/ui/Toast'

/** Saves the open onboarding step (null = finished) and refreshes the organization. */
export function useOnboardingStep() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return async (step: OnboardingStep | null) => {
    try {
      await api.patch<Organization>(`/orgs/${orgId}`, { onboardingStep: step })
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }
}

