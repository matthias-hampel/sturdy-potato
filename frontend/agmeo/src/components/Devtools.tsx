import { TanStackDevtools } from '@tanstack/react-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

export default function Devtools() {
  return (
    <TanStackDevtools
      config={{ position: 'bottom-right' }}
      plugins={[
        { name: 'Router', render: <TanStackRouterDevtoolsPanel /> },
        { name: 'Query', render: <ReactQueryDevtoolsPanel /> },
      ]}
    />
  )
}
