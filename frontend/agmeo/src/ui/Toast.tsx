import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import {
  Button,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from 'react-aria-components'
import { cx } from './utils'
import { t } from '#/i18n'

interface ToastContentValue {
  title: string
  description?: string
  tone?: 'success' | 'error' | 'info'
}

export const toasts = new ToastQueue<ToastContentValue>({ maxVisibleToasts: 4 })

export const toast = {
  success: (title: string, description?: string) => toasts.add({ title, description, tone: 'success' }, { timeout: 4000 }),
  error: (title: string, description?: string) => toasts.add({ title, description, tone: 'error' }, { timeout: 8000 }),
  info: (title: string, description?: string) => toasts.add({ title, description, tone: 'info' }, { timeout: 5000 }),
}

export function Toaster() {
  return (
    <ToastRegion queue={toasts} className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 outline-none w-[min(24rem,calc(100vw-2rem))]">
      {({ toast }) => {
        const tone = toast.content.tone ?? 'info'
        const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertTriangle : Info
        return (
          <AriaToast
            toast={toast}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-overlay)] outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Icon className={cx('size-5 shrink-0 mt-0.5', tone === 'success' ? 'text-success' : tone === 'error' ? 'text-danger' : 'text-info')} aria-hidden />
            <ToastContent className="flex-1 min-w-0">
              <Text slot="title" className="text-sm font-semibold text-fg block">
                {toast.content.title}
              </Text>
              {toast.content.description && (
                <Text slot="description" className="text-sm text-muted block mt-0.5">
                  {toast.content.description}
                </Text>
              )}
            </ToastContent>
            <Button slot="close" aria-label={t('common.dismiss')} className="text-muted hover:text-fg rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              <X className="size-4" />
            </Button>
          </AriaToast>
        )
      }}
    </ToastRegion>
  )
}
