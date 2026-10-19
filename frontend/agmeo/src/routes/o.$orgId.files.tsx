import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { FileExplorer } from '#/components/files/FileExplorer'
import { t } from '#/i18n'
import { PageHeader } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/files')({
  validateSearch: z.object({ folder: z.uuid().optional().catch(undefined), q: z.string().optional().catch(undefined) }),
  component: Files,
})

function Files() {
  const { folder, q } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <>
      <PageHeader title={t('nav.files')} subtitle={t('files.subtitle')} />
      <FileExplorer
        folderId={folder ?? null}
        search={q ?? ''}
        onNavigate={(id) => void navigate({ search: { folder: id ?? undefined } })}
        onSearch={(value) => void navigate({ search: (s) => ({ ...s, q: value || undefined }), replace: true })}
      />
    </>
  )
}
