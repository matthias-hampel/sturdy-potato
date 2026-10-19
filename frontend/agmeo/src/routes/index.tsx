import { createFileRoute, Navigate } from '@tanstack/react-router'
import { tokenStore } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { Loading } from '#/ui/Layout'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { user, isLoading } = useAuth()
  if (!tokenStore.get()) return <Navigate to="/login" />
  if (isLoading || !user) return <div className="p-8 max-w-md"><Loading /></div>
  const org = user.organizations[0]
  if (!org) return <Navigate to="/onboarding" />
  // An unfinished setup resumes where it was left.
  return org.onboardingStep ? <Navigate to="/o/$orgId/onboarding" params={{ orgId: org.id }} /> : <Navigate to="/o/$orgId" params={{ orgId: org.id }} />
}
