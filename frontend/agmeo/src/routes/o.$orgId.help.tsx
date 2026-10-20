import { createFileRoute, Link as RouterLink } from '@tanstack/react-router'
import { ArrowUpRight, Bell, Building2, ChevronRight, FileDown, FileText, HelpCircle, type LucideIcon, Mail, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '#/ui/Layout'
import { cx, focusRing } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/help')({ component: HelpPage })

type HelpLink = { key: string; icon: LucideIcon } & ({ href: string } | { tab: 'notifications' | 'export' | 'dataProcessing' })

/** AGVOLUTION's pages for agmeo (reference: app/help). */
const LINKS: HelpLink[] = [
  { key: 'faq', icon: HelpCircle, href: 'https://www.agvolution.com/help/agmeo/' },
  { key: 'contact', icon: Mail, href: 'https://www.agvolution.com/kontakt/' },
  { key: 'notifications', icon: Bell, tab: 'notifications' },
  { key: 'export', icon: FileDown, tab: 'export' },
  { key: 'dataProcessing', icon: ShieldCheck, tab: 'dataProcessing' },
  { key: 'privacy', icon: ShieldCheck, href: 'https://www.agvolution.com/datenschutz-agmeo/' },
  { key: 'terms', icon: FileText, href: 'https://agvolution.com/agb/' },
  { key: 'imprint', icon: Building2, href: 'https://www.agvolution.com/unternehmen/impressum' },
]

/** Help: FAQ and contact, the settings people look for, and the legal pages. */
function HelpPage() {
  const { t } = useTranslation()
  const { orgId } = Route.useParams()
  const tile = (link: HelpLink, external: boolean) => (
    <span className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition group-hover:border-line-strong group-hover:shadow-xs">
      <span className="size-10 shrink-0 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
        <link.icon className="size-5" aria-hidden />
      </span>
      <span className="flex-1 font-medium">{t(`help.link.${link.key}`)}</span>
      {external ? <ArrowUpRight className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
    </span>
  )
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />
      <ul className="grid gap-3">
        {LINKS.map((link) => (
          <li key={link.key}>
            {'href' in link ? (
              <a href={link.href} target="_blank" rel="noreferrer" className={cx('group block rounded-xl', focusRing)}>
                {tile(link, true)}
              </a>
            ) : (
              <RouterLink to="/o/$orgId/settings" params={{ orgId }} search={{ tab: link.tab }} className={cx('group block rounded-xl', focusRing)}>
                {tile(link, false)}
              </RouterLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
