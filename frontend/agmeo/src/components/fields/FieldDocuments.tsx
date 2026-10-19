import type { FieldDocument } from '@agmeo/contracts'
import { Download, FileUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FileTrigger } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#/components/files/upload'
import { LOCALE } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Badge, Card } from '#/ui/Layout'
import { Button } from '#/ui/Button'
import { Checkbox } from '#/ui/Field'
import { ConfirmButton } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { useQueryClient } from '@tanstack/react-query'

/** Documents of a field (contracts, plans, lab reports), for the selected harvest year and the field as a whole. */
export function FieldDocuments({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { season } = useSeason()
  const year = season?.harvestYear
  const base = `/fields/${fieldId}/documents`
  const docs = useOrgQuery<FieldDocument[]>(base, year ? { harvestYear: year } : undefined)
  const [forYear, setForYear] = useState(true)
  const [uploading, setUploading] = useState(false)
  const qc = useQueryClient()
  const canWrite = can('files.write')

  const remove = useOrgMutation((org, id: string) => api.delete(`${org}${base}/${id}`), { success: t('fieldDocuments.removed') })

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    const form = new FormData()
    form.append('names', JSON.stringify(files.map((f) => f.name)))
    if (forYear && year) form.append('harvestYear', String(year))
    for (const f of files) form.append('files', f)
    setUploading(true)
    try {
      await api.upload(`/orgs/${orgId}${base}`, form)
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
      toast.success(t('fieldDocuments.uploaded', { count: files.length }))
    } catch (e) {
      toast.error(t('fieldDocuments.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card
      title={t('fieldDocuments.title')}
      description={t('fieldDocuments.description')}
      actions={
        canWrite && (
          <FileTrigger allowsMultiple onSelect={(list) => void upload(list)}>
            <Button size="sm" isPending={uploading}>
              <FileUp /> {t('fieldDocuments.upload')}
            </Button>
          </FileTrigger>
        )
      }
    >
      {canWrite && year && (
        <Checkbox isSelected={forYear} onChange={setForYear} className="mb-3">
          {t('fieldDocuments.forYear', { year })}
        </Checkbox>
      )}
      {docs.data?.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {docs.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{d.name}</p>
                <p className="text-xs text-muted">
                  {formatBytes(d.sizeBytes, LOCALE)} · {fmt.date(d.linkedAt)}
                </p>
              </div>
              <Badge>{d.harvestYear ? t('fieldDocuments.harvest', { year: d.harvestYear }) : t('fieldDocuments.wholeField')}</Badge>
              <Button variant="ghost" size="icon-sm" aria-label={t('fieldDocuments.download', { name: d.name })} onPress={() => api.download(`/orgs/${orgId}/files/${d.id}/content`, undefined, d.name)}>
                <Download />
              </Button>
              {canWrite && (
                <ConfirmButton
                  title={t('fieldDocuments.removeTitle')}
                  message={t('fieldDocuments.removeMessage', { name: d.name })}
                  confirmLabel={t('fieldDocuments.remove')}
                  onConfirm={() => remove.mutateAsync(d.id)}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={t('fieldDocuments.removeNamed', { name: d.name })}>
                      <Trash2 />
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        !docs.isLoading && <p className="text-sm text-muted">{t('fieldDocuments.none')}</p>
      )}
    </Card>
  )
}
