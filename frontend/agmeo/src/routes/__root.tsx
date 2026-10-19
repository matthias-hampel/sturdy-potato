import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useRouter } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { I18nProvider, RouterProvider } from 'react-aria-components'
import { LANGUAGE, LOCALE } from '#/i18n'
import { SessionWatcher } from '#/lib/auth'
import { Toaster } from '#/ui/Toast'
import appCss from '../styles.css?url'

interface RouterContext {
  queryClient: QueryClient
}

const Devtools = import.meta.env.DEV ? lazy(() => import('#/components/Devtools')) : () => null

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#1e2a1b' },
      { name: 'apple-mobile-web-app-title', content: 'agmeo' },
      { title: 'agmeo — Betriebsmanagement' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
      // Installable as an app (reference: public/site.webmanifest).
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The client sets the language before hydrating (it can differ from the server shell).
    <html lang={LANGUAGE} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  const router = useRouter()
  const { queryClient } = Route.useRouteContext()
  return (
    <QueryClientProvider client={queryClient}>
      {/* React Aria links (table rows, menu items) navigate through the router. */}
      <RouterProvider navigate={(to) => router.navigate({ to })} useHref={(to) => router.buildLocation({ to }).href}>
        <I18nProvider locale={LOCALE}>
          <SessionWatcher />
          <Outlet />
          <Toaster />
          <Suspense>
            <Devtools />
          </Suspense>
        </I18nProvider>
      </RouterProvider>
    </QueryClientProvider>
  )
}
