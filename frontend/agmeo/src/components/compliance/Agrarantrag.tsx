import { AGRARANTRAG_PRESETS, type AgrarantragPreset, type CropCycle, FEDERAL_STATE_NAMES, type FarmRegulatory, type LandUseCode } from '@agmeo/contracts'
import { FileCode2, Map as MapIcon, Sprout } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { ComboBox, Option, Select } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

/** Subsidy application (Agrarantrag): the field boundaries as a Shapefile for the state portal, and the land-use codes. */
export function AgrarantragTab({ farmId }: { farmId: string }) {
  const { seasonId: workingSeasonId } = useSeason()
  const [seasonId, setSeasonId] = useState<string | undefined>(workingSeasonId)
  const season = seasonId ?? workingSeasonId
  return (
    <div className="space-y-6">
      <AgrarantragCard farmId={farmId} seasonId={season} onSeasonChange={setSeasonId} />
      {season && <LandUseCodes farmId={farmId} seasonId={season} />}
    </div>
  )
}

function AgrarantragCard({ farmId, seasonId, onSeasonChange }: { farmId: string; seasonId: string | undefined; onSeasonChange: (id: string) => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasons } = useSeason()
  const farm = useOrgQuery<FarmRegulatory>(`/farms/${farmId}/regulatory`)
  const [chosen, setChosen] = useState<AgrarantragPreset | null>(null)
  const [downloading, setDownloading] = useState(false)
  // Default to the farm's own state where it has a portal preset.
  const state = farm.data?.federalState
  const preset = chosen ?? (AGRARANTRAG_PRESETS.find((p) => p === state) || null)

  const download = async () => {
    if (!preset || !seasonId) return
    setDownloading(true)
    try {
      await api.download(`/orgs/${orgId}/exports/agrarantrag.zip`, { farmId, seasonId, preset }, `agrarantrag-${preset}.zip`)
    } catch (e) {
      toast.error(t('regulatory.exports.failed'), errorMessage(e))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card title={t('regulatory.exports.agrarantrag.title')} description={t('regulatory.exports.agrarantrag.description')}>
      <div className="flex flex-wrap items-end gap-4">
        <Select
          label={t('regulatory.exports.agrarantrag.portal')}
          placeholder={t('regulatory.farm.choose')}
          items={AGRARANTRAG_PRESETS.map((id) => ({ id, name: FEDERAL_STATE_NAMES[id] }))}
          value={preset}
          onChange={(v) => v && setChosen(v as AgrarantragPreset)}
          className="w-64"
        >
          {(p) => <Option id={p.id}>{p.name}</Option>}
        </Select>
        <Select label={t('regulatory.exports.agrarantrag.season')} items={seasons} value={seasonId ?? null} onChange={(v) => v && onSeasonChange(String(v))} className="w-56">
          {(s) => <Option id={s.id}>{s.name}</Option>}
        </Select>
        <Button variant="primary" onPress={download} isPending={downloading} isDisabled={!preset || !seasonId}>
          {!downloading && <MapIcon />} {t('regulatory.exports.agrarantrag.download')}
        </Button>
      </div>
      <p className="text-xs text-muted mt-3">{t('regulatory.exports.agrarantrag.hint')}</p>
    </Card>
  )
}

/** Nutzungscode per crop of the season; crops default to their crop's code. */
function LandUseCodes({ farmId, seasonId }: { farmId: string; seasonId: string }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const cycles = useOrgQuery<(CropCycle & { landUseCode?: string | null })[]>('/crop-cycles', { seasonId, farmId })
  const codes = useOrgQuery<LandUseCode[]>('/land-use-codes', undefined, { staleTime: Infinity })
  // Codes set here, until the crop-cycle list carries them.
  const [saved, setSaved] = useState<Record<string, string | null>>({})
  const patch = useOrgMutation(
    (base, v: { id: string; landUseCode: string | null }) => api.patch<{ cropCycleId: string; landUseCode: string | null }>(`${base}/crop-cycles/${v.id}/land-use-code`, { landUseCode: v.landUseCode }),
    {
      success: (r) => (r.landUseCode ? t('regulatory.landUse.saved', { code: r.landUseCode }) : t('regulatory.landUse.reset')),
      onSuccess: (r) => setSaved((s) => ({ ...s, [r.cropCycleId]: r.landUseCode })),
    },
  )
  const items = (codes.data ?? []).map((c) => ({ id: c.code, name: `${c.code} – ${c.name}` }))

  if (cycles.isLoading || codes.isLoading) return <Loading />
  if (cycles.error || codes.error) return <ErrorNotice error={cycles.error ?? codes.error} />
  const rows = [...(cycles.data ?? [])].sort((a, b) => a.fieldName.localeCompare(b.fieldName))

  return (
    <Card title={t('regulatory.landUse.title')} description={t('regulatory.landUse.description')} padded={false}>
      <Table aria-label={t('regulatory.landUse.title')}>
        <TableHeader>
          <Column isRowHeader>{t('crops.plan.field')}</Column>
          <Column>{t('crops.plan.crop')}</Column>
          <Column align="end">{t('crops.plan.area')}</Column>
          <Column className="w-96">{t('regulatory.landUse.code')}</Column>
        </TableHeader>
        <TableBody
          items={rows}
          renderEmptyState={() => (
            <EmptyState icon={Sprout} title={t('regulatory.landUse.empty')} />
          )}
        >
          {(c) => {
            const value = c.id in saved ? saved[c.id] : (c.landUseCode ?? null)
            return (
              <Row id={c.id}>
                <Cell>
                  <span className="font-medium">{c.fieldName}</span>
                  {c.fieldPartName && <div className="text-xs text-muted">{c.fieldPartName}</div>}
                </Cell>
                <Cell>
                  <CropTag name={c.cropName} color={c.cropColor} />
                </Cell>
                <Cell align="end">{fmt.ha(c.areaHa)}</Cell>
                <Cell>
                  <ComboBox
                    aria-label={t('regulatory.landUse.codeFor', { field: c.fieldName })}
                    placeholder={t('regulatory.landUse.cropDefault')}
                    items={items}
                    value={value}
                    onChange={(v) => {
                      const next = v == null ? null : String(v)
                      if (next !== value) patch.mutate({ id: c.id, landUseCode: next })
                    }}
                    isDisabled={!can('crop.write') || patch.isPending}
                    menuTrigger="focus"
                  >
                    {(i) => (
                      <Option id={i.id} textValue={i.name}>
                        {i.name}
                      </Option>
                    )}
                  </ComboBox>
                </Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
      <p className="px-4 py-3 border-t border-line text-xs text-muted inline-flex items-center gap-1.5">
        <FileCode2 className="size-3.5" aria-hidden /> {t('regulatory.landUse.hint')}
      </p>
    </Card>
  )
}
