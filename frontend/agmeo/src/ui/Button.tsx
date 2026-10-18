import { createLink } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonGroupProps,
  type ToggleButtonProps,
  composeRenderProps,
} from 'react-aria-components'
import { composeClass, cx, focusRing } from './utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm' | 'icon-xs'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover pressed:bg-primary-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-2 pressed:bg-surface-3 shadow-xs',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg pressed:bg-surface-3',
  quiet: 'text-primary hover:bg-primary-soft pressed:bg-primary-soft',
  danger: 'bg-danger text-white hover:brightness-95 pressed:brightness-90 shadow-sm',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  icon: 'size-9.5 justify-center',
  'icon-sm': 'size-8 justify-center',
  'icon-xs': 'size-6 justify-center',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return cx(
    'inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-colors cursor-pointer select-none',
    'disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
    variants[variant],
    sizes[size],
  )
}

export interface ButtonProps extends AriaButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant, size, className, children, ...props }: ButtonProps) {
  return (
    <AriaButton {...props} className={composeClass(className, buttonClass(variant, size))}>
      {composeRenderProps(children, (children, { isPending }) => (
        <>
          {isPending && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      ))}
    </AriaButton>
  )
}

interface StyledLinkProps extends AriaLinkProps {
  variant?: ButtonVariant | 'link'
  size?: ButtonSize
}

function StyledLink({ variant = 'link', size, className, ...props }: StyledLinkProps) {
  const base =
    variant === 'link'
      ? cx('text-primary hover:underline underline-offset-2 rounded-sm cursor-pointer', focusRing)
      : buttonClass(variant, size)
  return <AriaLink {...props} className={composeClass(className, base)} />
}

/** Type-safe router link rendered with React Aria (press handling, focus ring). */
export const Link = createLink(StyledLink)

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ...props
}: Omit<ToggleButtonGroupProps, 'selectedKeys' | 'onSelectionChange' | 'selectionMode'> & {
  items: { id: T; label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <AriaToggleButtonGroup
      {...props}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [first] = keys
        if (first != null) onChange(first as T)
      }}
      className="inline-flex rounded-[var(--radius-control)] bg-surface-2 p-0.5 border border-line"
    >
      {items.map((item) => (
        <SegmentButton key={item.id} id={item.id}>
          {item.label}
        </SegmentButton>
      ))}
    </AriaToggleButtonGroup>
  )
}

function SegmentButton(props: ToggleButtonProps) {
  return (
    <AriaToggleButton
      {...props}
      className={cx(
        'h-7.5 px-3 text-sm rounded-md text-fg-2 cursor-pointer inline-flex items-center gap-1.5 [&_svg]:size-4',
        'hover:text-fg selected:bg-surface selected:text-fg selected:shadow-sm font-medium',
        focusRing,
      )}
    />
  )
}
