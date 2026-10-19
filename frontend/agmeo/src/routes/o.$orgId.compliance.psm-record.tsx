import { PSM_RECORD_FIRST_YEAR } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FarmDataStep, PSM_RECORD_STEPS, type PsmRecordStep, ReadinessStep, RecordStep } from '#/components/compliance/PsmRecord'
import { today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { Link } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'

export const Route = createFileRoute('/o/$orgId/compliance/psm-record')({
  // Year, step and the readiness row the farm-data step was opened from live in the URL.
  validateSearch: z.object({ year: z.number().int().optional(), step: z.enum(PSM_RECORD_STEPS).optional(), issue: z.string().optional() }),
  component: PsmRecordPage,
})

const STEP_LABEL_KEYS = {
  readiness: 'psmRecord.step.readiness',
  'farm-data': 'psmRecord.step.farmData',
  record: 'psmRecord.step.record',
} as const satisfies Record<PsmRecordStep, string>

/** Plant-protection record under §11 PflSchG / EU 2023/564: check, farm data, files. */
function PsmRecordPage() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const currentYear = Number(today().slice(0, 4))
  // The record of EU 2023/564 applies from 2026; earlier years were recorded under the previous rules.
  const years = Array.from({ length: Math.max(currentYear + 1, PSM_RECORD_FIRST_YEAR) - PSM_RECORD_FIRST_YEAR + 1 }, (_, i) => PSM_RECORD_FIRST_YEAR + i).reverse()
  const defaultYear = Math.max(currentYear, PSM_RECORD_FIRST_YEAR)
  const year = search.year && years.includes(search.year) ? search.year : defaultYear
  const step = search.step ?? 'readiness'
  const goTo = (next: PsmRecordStep, issue?: string) => navigate({ search: (s) => ({ ...s, step: next === 'readiness' ? undefined : next, issue }) })

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/o/$orgId/compliance" params={{ orgId }} search={{}} className="inline-flex items-center gap-1 normal-case tracking-normal">
            <ArrowLeft className="size-3.5" aria-hidden /> {t('compliance.title')}
          </Link>
        }
        title={t('psmRecord.title')}
        subtitle={t('psmRecord.subtitle')}
        actions={
          <Select
            label={t('psmRecord.year')}
            items={years.map((y) => ({ id: y, name: String(y) }))}
            value={year}
            onChange={(v) => v != null && navigate({ search: (s) => ({ ...s, year: Number(v) === defaultYear ? undefined : Number(v) }), replace: true })}
            className="w-32"
          >
            {(y) => <Option id={y.id}>{y.name}</Option>}
          </Select>
        }
      />
      <Tabs selectedKey={step} onSelectionChange={(key) => goTo(key as PsmRecordStep)}>
        <TabList aria-label={t('psmRecord.steps')}>
          {PSM_RECORD_STEPS.map((s, index) => (
            <Tab key={s} id={s}>
              <span className="inline-flex items-center gap-2">
                <span className="size-5 rounded-full bg-surface-2 text-xs flex items-center justify-center tabular">{index + 1}</span>
                {t(STEP_LABEL_KEYS[s])}
              </span>
            </Tab>
          ))}
        </TabList>
        <TabPanel id="readiness">
          <ReadinessStep year={year} onFixFarmData={(code) => goTo('farm-data', code)} onContinue={() => goTo('farm-data')} />
        </TabPanel>
        <TabPanel id="farm-data">
          <FarmDataStep year={year} issueCode={search.issue} onContinue={() => goTo('record')} />
        </TabPanel>
        <TabPanel id="record">
          <RecordStep year={year} />
        </TabPanel>
      </Tabs>
    </>
  )
}
