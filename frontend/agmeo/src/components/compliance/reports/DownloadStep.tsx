import type { ExportPreflight, FederalExportFormat, RegulatoryExportFile, RegulatoryFormatOffer } from '@agmeo/contracts'
import { Download, ExternalLink, FileArchive, Info, Loader2, Mail, OctagonAlert, Phone } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#/components/files/upload'
import { LOCALE } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, buttonClass } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'
import { formatAuthority, formatDeadline, formatShortName, formatTitle, uploadSteps } from './formats'
import { RecordReportCard } from './RegionStep'

/** Step 4: the file (refused by the API while blocking findings remain), where it goes, and earlier exports. */
export function DownloadStep({ farmId, year, format, offer }: { farmId: string; year: number; format: FederalExportFormat; offer: RegulatoryFormatOffer }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const preflight = useOrgQuery<ExportPreflight>('/regulatory/preflight', { format, farmId, year })
  const history = useOrgQuery<RegulatoryExportFile[]>('/regulatory/exports/history', { year })
  const [downloading, setDownloading] = useState(false)
  const p = preflight.data
  const blocked = !p?.ready

  const download = async () => {
    if (!p) return
    setDownloading(true)
    try {
      await api.download(`/orgs/${orgId}/exports/${format}.${offer.upload.fileType}`, { farmId, year }, p.fileName)
      toast.success(t('fertilizerReports.download.success'), p.fileName)
      void history.refetch()
    } catch (e) {
      toast.error(t('regulatory.exports.failed'), errorMessage(e))
      // The records may have changed since the check; show the current state.
      void preflight.refetch()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      {preflight.isLoading ? (
        <Notice tone="info" icon={Loader2}>
          {t('fertilizerReports.download.blockedPending')}
        </Notice>
      ) : preflight.error ? (
        <ErrorNotice error={preflight.error} />
      ) : (
        blocked && (
          <Notice tone="danger" icon={OctagonAlert}>
            <p className="font-medium text-fg">{t('fertilizerReports.download.blockedTitle')}</p>
            <p className="mt-0.5">{t('fertilizerReports.download.fixFirst')}</p>
          </Notice>
        )
      )}

      <Card title={formatTitle(format)} description={t('fertilizerReports.download.hint', { year })}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onPress={download} isPending={downloading} isDisabled={blocked || preflight.isFetching}>
            {!downloading && <Download />} {t('fertilizerReports.download.button', { format: formatShortName(format), type: offer.upload.fileType.toUpperCase() })}
          </Button>
          {p && (
            <span className="text-xs text-muted font-mono truncate" title={p.fileName}>
              {p.fileName}
            </span>
          )}
        </div>
      </Card>

      <UploadGuide format={format} offer={offer} />
      <RecordReportCard farmId={farmId} year={year} />
      <ExportHistory year={year} files={history.data} isLoading={history.isLoading} error={history.error} />
    </div>
  )
}

/** "What happens next": how the file gets to the authority, and who answers questions. */
function UploadGuide({ format, offer }: { format: FederalExportFormat; offer: RegulatoryFormatOffer }) {
  const { t } = useTranslation()
  const { upload } = offer
  const date = offer.deadline ? formatDeadline(offer.deadline) : ''
  return (
    <Card title={t('fertilizerReports.download.whatNext')} description={formatAuthority(format)}>
      <div className="space-y-4">
        <ol className="list-decimal list-outside pl-5 space-y-1.5 text-sm text-fg-2">
          {uploadSteps(format, date).map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
        {format === 'besyd' && (
          <Notice tone="info" icon={Info}>
            {t('fertilizerReports.formats.besyd.sunset')}
          </Notice>
        )}
        {(upload.hotline || upload.contactEmail) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {upload.hotline && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" aria-hidden /> {t('fertilizerReports.download.hotline', { phone: upload.hotline })}
              </span>
            )}
            {upload.contactEmail && (
              <a href={`mailto:${upload.contactEmail}`} className="inline-flex items-center gap-1.5 text-primary hover:underline underline-offset-2">
                <Mail className="size-3.5" aria-hidden /> {upload.contactEmail}
              </a>
            )}
          </p>
        )}
        {(upload.portalUrl || upload.email) && (
          <div className="flex flex-wrap gap-2">
            {upload.portalUrl && (
              <a href={upload.portalUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                {t('fertilizerReports.download.openPortal')} <ExternalLink aria-hidden />
              </a>
            )}
            {upload.email && (
              <a href={`mailto:${upload.email}`} className={buttonClass('secondary', 'sm')}>
                {t('fertilizerReports.download.sendEmail')} <Mail aria-hidden />
              </a>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

/** Exports of the year archived in Files ("Exporte"), newest first; each can be downloaded again. */
function ExportHistory({ year, files, isLoading, error }: { year: number; files: RegulatoryExportFile[] | undefined; isLoading: boolean; error: unknown }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [busy, setBusy] = useState<string | null>(null)

  const download = async (file: RegulatoryExportFile) => {
    setBusy(file.id)
    try {
      await api.download(`/orgs/${orgId}/files/${file.id}/content`, undefined, file.name)
    } catch (e) {
      toast.error(t('regulatory.exports.failed'), errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('fertilizerReports.download.history')} padded={false}>
      {isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorNotice error={error} />
        </div>
      ) : (
        <Table aria-label={t('fertilizerReports.download.history')}>
          <TableHeader>
            <Column isRowHeader>{t('fertilizerReports.download.historyFile')}</Column>
            <Column>{t('fertilizerReports.download.historyDate')}</Column>
            <Column align="end">{t('fertilizerReports.download.historySize')}</Column>
            <Column aria-label={t('common.actions')}> </Column>
          </TableHeader>
          <TableBody items={files ?? []} renderEmptyState={() => <EmptyState icon={FileArchive} title={t('fertilizerReports.download.historyEmpty', { year })} />}>
            {(f) => (
              <Row id={f.id}>
                <Cell className="font-mono text-xs">{f.name}</Cell>
                <Cell className="whitespace-nowrap tabular">{fmt.dateTime(f.createdAt)}</Cell>
                <Cell align="end" className="whitespace-nowrap tabular">
                  {formatBytes(f.sizeBytes, LOCALE)}
                </Cell>
                <Cell align="end">
                  <Button size="icon-sm" variant="ghost" onPress={() => download(f)} isPending={busy === f.id} aria-label={t('fertilizerReports.download.again', { file: f.name })}>
                    {busy !== f.id && <Download />}
                  </Button>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
