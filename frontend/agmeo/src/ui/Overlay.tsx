import { X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps,
  type MenuProps,
  MenuTrigger,
  Modal,
  ModalOverlay,
  OverlayArrow,
  Popover,
  Separator,
  Tooltip as AriaTooltip,
  TooltipTrigger,
} from 'react-aria-components'
import { Button } from './Button'
import { cx } from './utils'
import { t } from '#/i18n'

export { DialogTrigger, MenuTrigger }

interface DialogProps {
  title: ReactNode
  description?: ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  footer?: (close: () => void) => ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isDismissable?: boolean
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

/** Modal dialog; place inside a DialogTrigger, or control with isOpen on ModalDialog. */
export function Dialog({ title, description, children, footer, size = 'md', isDismissable = true }: DialogProps) {
  return (
    <ModalOverlay
      isDismissable={isDismissable}
      className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
    >
      <Modal className={cx('w-full rounded-2xl bg-surface shadow-[var(--shadow-overlay)] border border-line my-8', widths[size])}>
        <AriaDialog className="outline-none flex flex-col max-h-[calc(100dvh-4rem)]">
          {({ close }) => (
            <>
              <header className="flex items-start gap-4 px-5 pt-5 pb-3">
                <div className="flex-1 min-w-0">
                  <Heading slot="title" className="text-lg font-semibold text-fg">
                    {title}
                  </Heading>
                  {description && <p className="text-sm text-muted mt-1">{description}</p>}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.close')} onPress={close}>
                  <X />
                </Button>
              </header>
              <div className="px-5 pb-5 overflow-y-auto">{typeof children === 'function' ? children(close) : children}</div>
              {footer && <footer className="flex justify-end gap-2 px-5 py-4 border-t border-line bg-surface-2/50 rounded-b-2xl">{footer(close)}</footer>}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

/** Dialog controlled by state instead of a trigger. */
export function ModalDialog({ isOpen, onOpenChange, ...props }: DialogProps & { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <span hidden />
      <Dialog {...props} />
    </DialogTrigger>
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  variant?: 'primary' | 'danger'
  onConfirm: () => Promise<unknown> | void
  trigger: ReactNode
}

export function ConfirmButton({ title, message, confirmLabel, variant = 'danger', onConfirm, trigger }: ConfirmProps) {
  const [pending, setPending] = useState(false)
  return (
    <DialogTrigger>
      {trigger}
      <Dialog
        title={title}
        size="sm"
        footer={(close) => (
          <>
            <Button onPress={close}>{t('common.cancel')}</Button>
            <Button
              variant={variant}
              isPending={pending}
              onPress={async () => {
                setPending(true)
                try {
                  await onConfirm()
                  close()
                } finally {
                  setPending(false)
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        )}
      >
        <div className="text-sm text-fg-2">{message}</div>
      </Dialog>
    </DialogTrigger>
  )
}

export function Menu<T extends object>({ children, ...props }: MenuProps<T>) {
  return (
    <Popover offset={4} placement="bottom end" className="min-w-48 rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-overlay)]">
      <AriaMenu {...props} className="outline-none p-1 max-h-96 overflow-auto">
        {children}
      </AriaMenu>
    </Popover>
  )
}

export function MenuItem({ className, danger, ...props }: MenuItemProps & { danger?: boolean }) {
  return (
    <AriaMenuItem
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none cursor-default [&_svg]:size-4 [&_svg]:text-muted',
        danger ? 'text-danger focus:bg-danger-soft' : 'text-fg focus:bg-surface-2',
        'disabled:opacity-50',
        className as string,
      )}
    />
  )
}

export function MenuSeparator() {
  return <Separator className="my-1 border-t border-line" />
}

export function Tooltip({ content, children }: { content: ReactNode; children: React.ReactElement }) {
  return (
    <TooltipTrigger delay={400}>
      {children}
      <AriaTooltip offset={6} className="rounded-md bg-fg text-canvas text-xs px-2 py-1 shadow-lg max-w-64">
        <OverlayArrow>
          <svg width={8} height={8} viewBox="0 0 8 8" className="fill-fg group-placement-bottom:rotate-180">
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  )
}
