import type { Operation, PsmAttestations, PsmFinding, PsmProductInfo } from '@agmeo/contracts'
import { CheckCircle2, Circle, Droplets, ExternalLink, Info, Link2, Shield, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger, Popover } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Badge, Loading, Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx, focusRing } from '#/ui/utils'

/** A button that opens a small dialog next to it. */
export function InfoPopover({ trigger, label, children, className }: { trigger: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <DialogTrigger>
      <AriaButton aria-label={label} className={cx('inline-flex items-center rounded-sm text-muted hover:text-fg', focusRing, className)}>
        {trigger}
      </AriaButton>
      <Popover placement="bottom start" offset={6} className="rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-overlay)]">
        <AriaDialog aria-label={label} className="outline-none p-4 w-80 max-h-[70vh] overflow-y-auto space-y-3 text-sm">
          {children}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  )
}

/** Plant-protection products mixed in one pass (reference MixBadge): the operation's products are its mix partners. */
export function MixBadge({ op }: { op: Operation }) {
  const { t } = useTranslation()
  const products = op.inputs.filter((i) => i.category === 'crop_protection')
  if (products.length < 2) return null
  return (
    <InfoPopover
      label={t('protection.tankMix.title', { count: products.length })}
      trigger={
        <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-series-5)_18%,transparent)] px-2 py-0.5 text-xs font-medium text-fg-2">
          <Link2 className="size-3" aria-hidden /> {t('protection.tankMix.badge', { number: products.length })}
        </span>
      }
    >
      <p className="font-semibold text-fg">{t('protection.tankMix.title', { count: products.length })}</p>
      <p className="rounded-md bg-surface-2 p-2 text-xs text-fg-2">{t('protection.tankMix.unknown')}</p>
      <div>
        <p className="text-xs font-medium text-muted mb-1">{t('protection.tankMix.partners')}</p>
        <ul className="space-y-0.5">
          {products.map((p) => (
            <li key={p.id}>
              {p.productName} <span className="text-muted tabular">· {fmt.qty(p.ratePerHa, p.baseUnit)}/ha</span>
            </li>
          ))}
        </ul>
      </div>
    </InfoPopover>
  )
}

/** Approval, approved use and Auflagen of one product (reference ProductInfoPopover). */
export function ProductInfo({ productId, productName, awgId }: { productId: string; productName: string; awgId?: string | null }) {
  const { t } = useTranslation()
  return (
    <InfoPopover label={t('protection.productInfo.label', { product: productName })} trigger={<Info className="size-3.5" aria-hidden />}>
      <ProductInfoBody productId={productId} productName={productName} awgId={awgId} />
    </InfoPopover>
  )
}

function ProductInfoBody({ productId, productName, awgId }: { productId: string; productName: string; awgId?: string | null }) {
  const { t } = useTranslation()
  const info = useOrgQuery<PsmProductInfo>(`/products/${productId}/psm-info`, awgId ? { awgId } : undefined, { staleTime: 60 * 60_000 })
  if (info.isLoading) return <Loading />
  const d = info.data
  if (!d) return null
  const waiting = d.use ? Object.values(d.use.waitingDays).filter((v): v is number => v != null) : []
  return (
    <>
      <div>
        <p className="font-semibold text-fg">{d.bvlName ?? productName}</p>
        <p className="text-xs text-muted">
          {d.kennr ? `${t('protection.productInfo.kennr')} ${d.kennr}` : t('protection.productInfo.noKennr')}
          {d.approvalEndsOn && ` · ${t('protection.productInfo.approvedUntil', { date: fmt.date(d.approvalEndsOn) })}`}
        </p>
      </div>
      {d.use && (
        <div className="flex flex-wrap gap-1.5">
          {d.use.doseMax != null && <Badge>{`${t('protection.productInfo.doseMax')} ${fmt.num(d.use.doseMax, 2)} ${d.use.doseUnit ?? ''}`}</Badge>}
          {d.use.targets.slice(0, 3).map((x) => (
            <Badge key={x}>{x}</Badge>
          ))}
          {waiting.length > 0 && <Badge tone="danger">{t('protection.productInfo.waiting', { days: Math.max(...waiting) })}</Badge>}
          {d.use.maxApplications != null && <Badge>{t('protection.productInfo.maxApplications', { number: d.use.maxApplications })}</Badge>}
          {(d.use.waterMinLHa != null || d.use.waterMaxLHa != null) && <Badge>{t('protection.productInfo.water', { min: fmt.num(d.use.waterMinLHa), max: fmt.num(d.use.waterMaxLHa) })}</Badge>}
        </div>
      )}
      {d.kennr && !d.use && <p className="text-xs text-muted">{t('protection.productInfo.noUse')}</p>}
      <div>
        <p className="text-xs font-medium text-muted mb-1">{t('protection.auflagen.title')}</p>
        {d.restrictions.length === 0 ? (
          <p className="text-xs text-muted">{t('protection.auflagen.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {d.restrictions.map((r) => (
              <li key={r.auflagenr} className="text-xs">
                <span className="font-mono font-semibold text-fg">{r.code}</span>
                {r.waterBufferM != null && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--color-series-1)]">
                    <Droplets className="size-3" aria-hidden /> {fmt.num(r.waterBufferM)} m
                  </span>
                )}
                {r.driftReductionPct != null && <span className="ml-1.5 text-[var(--color-series-5)]">{r.driftReductionPct} %</span>}
                {r.text && <span className="block text-fg-2">{r.text}</span>}
                {r.tiers.length > 0 && (
                  <span className="block text-muted">
                    {r.tiers.map((x) => `${x.reductionPct} %: ${x.distanceM == null ? '—' : `${fmt.num(x.distanceM)} m`}`).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

const FINDING_TONE = { deviation: 'text-danger', notice: 'text-warning' } as const

/** The approval findings of one operation as a warning icon with the messages on press. */
export function FindingsFlag({ findings }: { findings: PsmFinding[] }) {
  const { t } = useTranslation()
  if (!findings.length) return <CheckCircle2 className="size-4 text-success" aria-label={t('protection.checks.ok')} />
  const worst = findings.some((f) => f.severity === 'deviation') ? 'deviation' : 'notice'
  return (
    <InfoPopover label={t('protection.checks.title', { count: findings.length })} trigger={<TriangleAlert className={cx('size-4', FINDING_TONE[worst])} aria-hidden />}>
      <p className="font-semibold text-fg">{t('protection.checks.title', { count: findings.length })}</p>
      <ul className="space-y-1.5 text-xs">
        {findings.map((f, i) => (
          <li key={i} className={FINDING_TONE[f.severity]}>
            <span className="font-medium">{f.productName}</span>
            {f.fieldName && <span className="text-muted"> · {f.fieldName}</span>}
            <span className="block text-fg-2">{t(`protection.finding.${f.code}`, { ...f.params, defaultValue: f.message })}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t('protection.checks.disclaimer')}</p>
    </InfoPopover>
  )
}

const RECORD_FIELDS = ['product', 'zulassung', 'dose', 'crop', 'fieldArea', 'dateTime', 'bbch', 'targetOrganism', 'applicator', 'machine', 'water', 'weather'] as const

/** Legal requirements of plant-protection records (reference ComplianceInfoContent): checklist, certificates, links. */
export function ComplianceInfoButton() {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      <Button size="sm">
        <Shield /> {t('protection.compliance.button')}
      </Button>
      <ComplianceDialog />
    </DialogTrigger>
  )
}

function ComplianceDialog() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const attestations = useOrgQuery<PsmAttestations>('/protection/attestations')
  const a = attestations.data
  const today = new Date().toISOString().slice(0, 10)
  const sprayerOld = a?.sprayerInspectedOn ? Date.parse(a.sprayerInspectedOn) < Date.now() - 3 * 365.25 * 86_400_000 : false
  return (
    <ModalDialog isOpen={undefined as unknown as boolean} onOpenChange={() => {}} title={t('protection.compliance.title')} size="lg">
      <div className="space-y-5 text-sm">
        <section className="space-y-1">
          <h3 className="font-semibold text-fg">{t('protection.compliance.overviewTitle')}</h3>
          <p className="text-fg-2">{t('protection.compliance.overviewBody')}</p>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-fg">{t('protection.compliance.checklistTitle')}</h3>
          <ul className="grid sm:grid-cols-2 gap-1">
            {RECORD_FIELDS.map((f) => (
              <li key={f} className="flex items-center gap-2 text-fg-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden /> {t(`protection.compliance.field.${f}`)}
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2 rounded-md border border-line p-3">
          <h3 className="font-semibold text-fg">{t('protection.compliance.sachkundeTitle')}</h3>
          <p className="text-fg-2">{t('protection.compliance.sachkundeBody')}</p>
          {attestations.isLoading ? (
            <Loading />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">{t('protection.compliance.sachkundeName')}</dt>
              <dd>{a?.certificateHolder ?? <NotSet />}</dd>
              <dt className="text-muted">{t('protection.compliance.sachkundeNr')}</dt>
              <dd>{a?.certificateNumber ?? <NotSet />}</dd>
              <dt className="text-muted">{t('protection.compliance.sachkundeExpiry')}</dt>
              <dd>
                {a?.certificateValidUntil ? fmt.date(a.certificateValidUntil) : <NotSet />}
                {a?.certificateValidUntil && a.certificateValidUntil < today && <span className="ml-2 text-danger">{t('protection.compliance.expired')}</span>}
              </dd>
              <dt className="text-muted">{t('protection.compliance.spritzenPruefnr')}</dt>
              <dd>{a?.sprayerInspectionNumber ?? <NotSet />}</dd>
              <dt className="text-muted">{t('protection.compliance.spritzenPruefDatum')}</dt>
              <dd>
                {a?.sprayerInspectedOn ? fmt.date(a.sprayerInspectedOn) : <NotSet />}
                {sprayerOld && <span className="ml-2 text-warning">{t('protection.compliance.testTooOld')}</span>}
              </dd>
            </dl>
          )}
          <Link to="/o/$orgId/compliance/psm-record" params={{ orgId }} size="sm">
            {a?.certificateNumber ? t('protection.compliance.edit') : t('protection.compliance.add')}
          </Link>
        </section>
        <section className="space-y-1">
          <h3 className="font-semibold text-fg">{t('protection.compliance.linksTitle')}</h3>
          <ul className="space-y-1">
            {[
              ['https://psm-zulassung.bvl.bund.de/psm/jsp/', t('protection.compliance.bvlLink')],
              ['https://eur-lex.europa.eu/eli/reg_impl/2023/564/oj', t('protection.compliance.eurlexLink')],
              ['https://www.gesetze-im-internet.de/pflschg_2012/__11.html', t('protection.compliance.pflschgLink')],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                  {label} <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <Notice tone="info">{t('protection.compliance.disclaimer')}</Notice>
      </div>
    </ModalDialog>
  )
}

const NotSet = () => {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <Circle className="size-3" aria-hidden /> {t('protection.compliance.notSet')}
    </span>
  )
}
