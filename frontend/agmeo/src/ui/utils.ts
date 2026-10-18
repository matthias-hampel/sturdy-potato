import { composeRenderProps } from 'react-aria-components'

type ClassValue = string | false | null | undefined | 0

export function cx(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ')
}

export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

/** Merge a static class string with a React Aria className render prop. */
export function composeClass<T>(
  className: string | ((v: T) => string) | undefined,
  base: string | ((v: T) => string),
): string | ((v: T) => string) {
  return composeRenderProps(className, (cls, renderProps) =>
    cx(typeof base === 'function' ? base(renderProps) : base, cls),
  )
}
