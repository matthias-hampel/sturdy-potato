import { LOCALES, type CurrentUser, type Locale } from '@agmeo/contracts'
import { Link as RouterLink, useLocation, useNavigate } from '@tanstack/react-router'
import {
  BarChart3,
  BookOpen,
  Boxes,
  Coins,
  Building2,
  CalendarCheck2,
  CalendarRange,
  Check,
  ChevronsUpDown,
  ClipboardList,
  CloudSun,
  FileUp,
  FlaskConical,
  FolderOpen,
  Grid2x2,
  Languages,
  LayoutDashboard,
  Leaf,
  Mic,
  Newspaper,
  ListChecks,
  LogOut,
  Map,
  Menu as MenuIcon,
  Plus,
  Repeat,
  Settings,
  Shovel,
  ShieldCheck,
  Sprout,
  Tractor,
  Users,
  Wheat,
  X,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton, Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components'
import { LANGUAGE, setLanguage } from '#/i18n'
import { roleLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useOrg, useSeason } from '#/lib/org'
import { Button } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '#/ui/Overlay'
import { cx, focusRing } from '#/ui/utils'
import { GlobalSearch } from './GlobalSearch'
import { Logo } from './Logo'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  exact?: boolean
  permission?: Parameters<ReturnType<typeof useOrg>['can']>[0]
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'nav.section.workspace',
    items: [
      { to: '/o/$orgId', label: 'nav.overview', icon: LayoutDashboard, exact: true },
      { to: '/o/$orgId/news', label: 'nav.news', icon: Newspaper },
      { to: '/o/$orgId/fields', label: 'nav.fields', icon: Map },
      { to: '/o/$orgId/crops', label: 'nav.crops', icon: Sprout },
      { to: '/o/$orgId/nutrients', label: 'nav.nutrients', icon: FlaskConical },
      { to: '/o/$orgId/soil', label: 'nav.soil', icon: Shovel },
      { to: '/o/$orgId/vra-maps', label: 'nav.vraMaps', icon: Layers },
      { to: '/o/$orgId/calendar', label: 'nav.calendar', icon: CalendarRange },
      { to: '/o/$orgId/templates', label: 'nav.templates', icon: ListChecks },
      { to: '/o/$orgId/rotations', label: 'nav.rotations', icon: Repeat },
      { to: '/o/$orgId/operations', label: 'nav.operations', icon: ClipboardList },
      { to: '/o/$orgId/voice', label: 'nav.voice', icon: Mic },
      { to: '/o/$orgId/tasks', label: 'nav.tasks', icon: CalendarCheck2 },
    ],
  },
  {
    title: 'nav.section.resources',
    items: [
      { to: '/o/$orgId/inventory', label: 'nav.inventory', icon: Boxes },
      { to: '/o/$orgId/prices', label: 'nav.prices', icon: Coins },
      { to: '/o/$orgId/machinery', label: 'nav.machinery', icon: Tractor },
      { to: '/o/$orgId/varieties', label: 'nav.varieties', icon: BookOpen },
      { to: '/o/$orgId/team', label: 'nav.team', icon: Users },
      { to: '/o/$orgId/files', label: 'nav.files', icon: FolderOpen },
    ],
  },
  {
    title: 'nav.section.insights',
    items: [
      { to: '/o/$orgId/weather', label: 'nav.weather', icon: CloudSun },
      { to: '/o/$orgId/maize-dmc', label: 'nav.maizeDmc', icon: Wheat },
      { to: '/o/$orgId/economics', label: 'nav.economics', icon: BarChart3, permission: 'finance.read' },
      { to: '/o/$orgId/carbon', label: 'nav.carbon', icon: Leaf },
      { to: '/o/$orgId/compliance', label: 'nav.compliance', icon: ShieldCheck },
    ],
  },
  {
    title: 'nav.section.import',
    items: [{ to: '/o/$orgId/import', label: 'nav.dataImport', icon: FileUp, permission: 'field.write' }],
  },
]

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden lg:flex flex-col bg-sidebar text-sidebar-fg sticky top-0 h-dvh">
        <Sidebar user={user} />
      </aside>
      <ModalOverlay isOpen={mobileOpen} onOpenChange={setMobileOpen} isDismissable className="fixed inset-0 z-50 bg-black/40 lg:hidden">
        <Modal className="h-full w-72 max-w-[85vw] bg-sidebar text-sidebar-fg shadow-2xl">
          <AriaDialog aria-label={t('nav.navigation')} className="h-full flex flex-col outline-none">
            <div className="flex justify-end p-2">
              <AriaButton slot="close" aria-label={t('nav.closeNavigation')} className="p-2 rounded-md text-sidebar-muted hover:text-white outline-none">
                <X className="size-5" />
              </AriaButton>
            </div>
            <Sidebar user={user} onNavigate={() => setMobileOpen(false)} />
          </AriaDialog>
        </Modal>
      </ModalOverlay>
      <div className="min-w-0 flex flex-col">
        <TopBar user={user} onOpenNav={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 w-full min-w-0">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { pathname } = useLocation()
  return (
    <>
      <div className="px-5 pt-5 pb-4">
        <Logo light />
      </div>
      <OrgSwitcher user={user} />
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={t('nav.main')}>
        {NAV.map((group) => (
          <div key={group.title} className="mt-5 first:mt-3">
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{t(group.title)}</div>
            <ul className="space-y-0.5">
              {group.items
                .filter((i) => !i.permission || can(i.permission))
                .map((item) => {
                  const href = item.to.replace('$orgId', orgId)
                  const active = item.exact ? pathname === href || pathname === `${href}/` : pathname.startsWith(href)
                  return (
                    <li key={item.to}>
                      <RouterLink
                        to={item.to}
                        params={{ orgId }}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                          active ? 'bg-sidebar-active text-white font-medium' : 'text-sidebar-fg/85 hover:bg-sidebar-active/60 hover:text-white',
                          focusRing,
                          'focus-visible:ring-offset-sidebar',
                        )}
                      >
                        <item.icon className={cx('size-4.5 shrink-0', active ? 'text-[#a8d08d]' : 'text-sidebar-muted')} aria-hidden />
                        {t(item.label)}
                      </RouterLink>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-3 py-3">
        <RouterLink
          to="/o/$orgId/settings"
          params={{ orgId }}
          onClick={onNavigate}
          className={cx(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-fg/85 hover:bg-sidebar-active/60 hover:text-white',
            pathname.startsWith(`/o/${orgId}/settings`) && 'bg-sidebar-active text-white',
            focusRing,
          )}
        >
          <Settings className="size-4.5 text-sidebar-muted" aria-hidden />
          {t('nav.settings')}
        </RouterLink>
      </div>
    </>
  )
}

function OrgSwitcher({ user }: { user: CurrentUser }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const navigate = useNavigate()
  return (
    <div className="px-3">
      <MenuTrigger>
        <AriaButton className={cx('w-full flex items-center gap-3 rounded-lg bg-white/6 hover:bg-white/10 px-3 py-2.5 text-left', focusRing)}>
          <span className="size-8 rounded-md bg-[#a8d08d]/20 text-[#cfe6bf] flex items-center justify-center shrink-0">
            <Building2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white truncate">{org.name}</span>
            <span className="block text-xs text-sidebar-muted">{roleLabel(org.role)}</span>
          </span>
          <ChevronsUpDown className="size-4 text-sidebar-muted shrink-0" aria-hidden />
        </AriaButton>
        <Menu
          onAction={(key) => {
            if (key === '__new') void navigate({ to: '/onboarding' })
            else void navigate({ to: '/o/$orgId', params: { orgId: String(key) } })
          }}
        >
          {user.organizations.map((o) => (
            <MenuItem key={o.id} id={o.id} textValue={o.name}>
              <Check className={cx(o.id !== org.id && 'invisible')} />
              <span className="flex-1 truncate">{o.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem id="__new">
            <Plus /> {t('nav.newOrganization')}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </div>
  )
}

/** Each language in its own name, so it can be found whatever language is active. */
const LANGUAGE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
  cs: 'Čeština',
  es: 'Español',
  et: 'Eesti',
  fr: 'Français',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  pl: 'Polski',
  ro: 'Română',
  uk: 'Українська',
}

/** Saves the language on the account (it follows the user to other devices), then reloads in it. */
async function switchLanguage(locale: Locale) {
  try {
    await api.patch('/me', { locale })
  } catch {
    // The choice still applies on this browser.
  }
  setLanguage(locale)
}

function TopBar({ user, onOpenNav }: { user: CurrentUser; onOpenNav: () => void }) {
  const { t } = useTranslation()
  const { seasons, seasonId, setSeasonId } = useSeason()
  const { signOut } = useAuth()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <header className="sticky top-0 z-30 h-15 border-b border-line bg-canvas/90 backdrop-blur flex items-center gap-3 px-4 sm:px-6 lg:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden -ml-2" aria-label={t('nav.openNavigation')} onPress={onOpenNav}>
        <MenuIcon />
      </Button>
      <div className="flex-1 min-w-0 flex">
        <GlobalSearch />
      </div>
      {seasons.length > 0 ? (
        <Select
          aria-label={t('nav.season')}
          className="w-44"
          items={seasons}
          value={seasonId ?? null}
          onChange={(v) => v && setSeasonId(String(v))}
        >
          {(s) => (
            <Option id={s.id} textValue={String(s.harvestYear)} description={`${s.startDate.slice(0, 7)} – ${s.endDate.slice(0, 7)}`}>
              {s.harvestYear}
            </Option>
          )}
        </Select>
      ) : (
        <Button size="sm" variant="quiet" onPress={() => navigate({ to: '/o/$orgId/crops', params: { orgId } })}>
          <Grid2x2 /> {t('nav.setUpSeason')}
        </Button>
      )}
      <MenuTrigger>
        <AriaButton aria-label={t('nav.account')} className={cx('size-9 rounded-full bg-primary text-primary-fg text-sm font-semibold flex items-center justify-center', focusRing)}>
          {initials}
        </AriaButton>
        <Menu
          onAction={(key) => {
            if (key === 'signout') void signOut()
            else if (typeof key === 'string' && key.startsWith('lang:')) void switchLanguage(key.slice(5) as Locale)
          }}
        >
          <MenuItem id="me" isDisabled textValue={user.displayName}>
            <span className="flex flex-col">
              <span className="font-medium text-fg">{user.displayName}</span>
              <span className="text-xs text-muted">{user.email}</span>
            </span>
          </MenuItem>
          <MenuSeparator />
          {LOCALES.map((l) => (
            <MenuItem key={l} id={`lang:${l}`} textValue={LANGUAGE_NAMES[l]}>
              {l === LANGUAGE ? <Check /> : <Languages className="opacity-0" />} {LANGUAGE_NAMES[l]}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem id="signout">
            <LogOut /> {t('nav.signOut')}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </header>
  )
}
