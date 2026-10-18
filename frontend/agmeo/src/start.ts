import { createStart } from '@tanstack/react-start'

// agmeo is an authenticated application backed by a separate API; pages render on the
// client. The document shell is still server-rendered.
export const startInstance = createStart(() => ({ defaultSsr: false }))
