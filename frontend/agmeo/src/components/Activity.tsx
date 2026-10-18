import type { AuditEvent } from '@agmeo/contracts'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Card, Loading } from '#/ui/Layout'

/** Audit trail of one record. */
export function Activity({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { t } = useTranslation()
  const events = useOrgQuery<AuditEvent[]>('/audit', { entityType, entityId })
  if (events.isLoading) return <Loading />
  return (
    <Card title={t('activity.title')} description={t('activity.description')}>
      {(events.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('activity.empty')}</p>
      ) : (
        <ol className="relative border-l border-line ml-2 space-y-4">
          {events.data!.map((e) => (
            <li key={e.id} className="pl-5 relative">
              <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
              <div className="text-sm">
                <strong className="font-medium">{e.actorName ?? t('activity.system')}</strong> <span className="text-fg-2">{t(`activity.action.${e.action}`, { defaultValue: e.action.replace(/[_.]/g, ' ') })}</span>
              </div>
              <div className="text-xs text-muted">{fmt.dateTime(e.createdAt)}</div>
              {Object.keys(e.changes).length > 0 && (
                <pre className="mt-1.5 text-xs bg-surface-2 rounded-md p-2 overflow-x-auto text-fg-2">{JSON.stringify(e.changes, null, 1)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
