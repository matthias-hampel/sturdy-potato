import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SearchX } from 'lucide-react'
import { AppShell } from '#/components/AppShell'
import { tokenStore } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { OrgProvider, SeasonProvider } from '#/lib/org'
import { Link } from '#/ui/Button'
import { EmptyState, Loading } from '#/ui/Layout'
import { t } from '#/i18n'

export const Route = createFileRoute('/o/$orgId')({
  beforeLoad: () => {
    if (!tokenStore.get()) throw redirect({ to: '/login' })
  },
  component: OrgLayout,
})

function OrgLayout() {
  const { orgId } = Route.useParams()
  const { user, isLoading } = useAuth()
  if (isLoading || !user) {
    return (
      <div className="p-8 max-w-xl">
        <Loading />
      </div>
    )
  }
  const org = user.organizations.find((o) => o.id === orgId)
  if (!org) {
    return (
      <EmptyState icon={SearchX} title={t('org.notFound')} action={<Link to="/" variant="primary">{t('org.goToFarms')}</Link>}>
        {t('org.notFoundHint')}
      </EmptyState>
    )
  }
  return (
    <OrgProvider org={org}>
      <SeasonProvider>
        <AppShell user={user}>
          <Outlet />
        </AppShell>
      </SeasonProvider>
    </OrgProvider>
  )
}
