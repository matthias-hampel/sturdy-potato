import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { ApiRequestError } from './lib/api'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Do not retry client errors (403/404/validation); retry transient failures once.
        retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  })

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
