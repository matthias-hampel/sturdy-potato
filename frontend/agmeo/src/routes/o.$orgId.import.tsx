import type { Crop, Farm, Field, ImportFieldsResult, LandUseCode } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FeatureCollection } from 'geojson'
import { AlertTriangle, CheckCircle2, FileText, FileUp, type LucideIcon, Shapes, Tractor } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DropZone, FileTrigger, Radio, RadioGroup } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CRS_OPTIONS, type CrsId } from '#/components/import/crs'
import { collectFiles, extension, type SourceFile } from '#/components/import/files'
import { readIsoxml } from '#/components/import/isoxml'
import {
  ANTRAG_ROLES,
  type AntragMapping,
  type ImportRow,
  type ImportSource,
  type ShapeMapping,
  antragRows,
  detectAntragColumns,
  existingField,
  guessShapeMapping,
  isoxmlRows,
  matchCrop,
  propertyKeys,
  shapeRows,
} from '#/components/import/rows'
import { readShapefiles, type ShapeLayer } from '#/components/import/shapefile'
import { FieldMap } from '#/components/map/FieldMap'
import { farmView } from '#/components/map/useMap'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, ComboBox, Option, Select, Switch } from '#/ui/Field'
import { Badge, Card, EmptyState, Notice, PageHeader } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx, focusRing } from '#/ui/utils'

const SOURCES = ['antrag', 'shapefile', 'isoxml'] as const

export const Route = createFileRoute('/o/$orgId/import')({
  validateSearch: z.object({ source: z.enum(SOURCES).optional() }),
  component: DataImportPage,
})

const SOURCE_META: Record<ImportSource, { icon: LucideIcon; accept: string[] }> = {
  antrag: { icon: FileText, accept: ['.zip', '.shp', '.dbf', '.prj', '.cpg'] },
  shapefile: { icon: Shapes, accept: ['.zip', '.shp', '.dbf', '.prj', '.cpg'] },
  isoxml: { icon: Tractor, accept: ['.zip', '.xml', '.XML'] },
}

function DataImportPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { source } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const farms = useOrgQuery<Farm[]>('/farms')
  const fields = useOrgQuery<Field[]>('/fields')

  if (!can('field.write')) return <EmptyState title={t('import.noPermission')} />
  const activeFarms = (farms.data ?? []).filter((f) => !f.archivedAt)

  return (
    <>
      <PageHeader eyebrow={t('nav.section.import')} title={t('import.title')} subtitle={t('import.subtitle')} />
      <RadioGroup
        aria-label={t('import.source')}
        value={source ?? null}
        onChange={(v) => navigate({ search: { source: v as ImportSource }, replace: true })}
        className="grid sm:grid-cols-3 gap-3 mb-6"
      >
        {SOURCES.map((s) => {
          const Icon = SOURCE_META[s].icon
          return (
            <Radio
              key={s}
              value={s}
              className={({ isSelected }) =>
                cx(
                  'rounded-xl border bg-surface p-4 flex gap-3 cursor-pointer transition-colors',
                  isSelected ? 'border-primary ring-1 ring-primary bg-primary-soft/40' : 'border-line hover:border-line-strong',
                  focusRing,
                )
              }
            >
              <span className="size-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{t(`import.source.${s}`)}</span>
                <span className="block text-xs text-muted mt-0.5">{t(`import.source.${s}.description`)}</span>
              </span>
            </Radio>
          )
        })}
      </RadioGroup>
      {!source ? (
        <EmptyState icon={FileUp} title={t('import.chooseSource.title')}>
          {t('import.chooseSource.description')}
        </EmptyState>
      ) : farms.data && activeFarms.length === 0 ? (
        <EmptyState title={t('fields.new.noFarm.title')} action={<Link to="/o/$orgId/settings" params={{ orgId }} variant="primary">{t('fields.new.noFarm.action')}</Link>}>
          {t('fields.new.noFarm.description')}
        </EmptyState>
      ) : (
        farms.data && fields.data && <ImportWizard key={source} source={source} farms={activeFarms} fields={fields.data} />
      )}
    </>
  )
}

type Parsed = { kind: 'shape'; layers: ShapeLayer[] } | { kind: 'isoxml'; rows: ImportRow[] }

function ImportWizard({ source, farms, fields }: { source: ImportSource; farms: Farm[]; fields: Field[] }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const navigate = useNavigate()
  const { seasons, seasonId: workingSeasonId } = useSeason()
  const crops = useOrgQuery<Crop[]>('/crops', undefined, { staleTime: 5 * 60_000 })
  const codes = useOrgQuery<LandUseCode[]>('/land-use-codes', undefined, { staleTime: Infinity })
  const knownCodes = useMemo(() => new Set((codes.data ?? []).map((c) => c.code)), [codes.data])

  const [files, setFiles] = useState<{ label: string; files: SourceFile[] } | null>(null)
  const [crsOverride, setCrsOverride] = useState<CrsId | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [layerName, setLayerName] = useState<string | null>(null)
  const [antragMapping, setAntragMapping] = useState<AntragMapping | null>(null)
  const [shapeMapping, setShapeMapping] = useState<ShapeMapping | null>(null)
  const [excluded, setExcluded] = useState<Set<number> | null>(null)
  const [farmId, setFarmId] = useState<string | null>(farms[0]?.id ?? null)
  const [seasonId, setSeasonId] = useState<string | null>(workingSeasonId ?? null)
  const [assignCrops, setAssignCrops] = useState(true)
  const [cropChoice, setCropChoice] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState<ImportFieldsResult | null>(null)

  // Parse whenever the files or the chosen reference system change.
  useEffect(() => {
    if (!files) return
    let cancelled = false
    setParsing(true)
    setParseError(null)
    const run = async (): Promise<Parsed> => {
      if (source === 'isoxml') return { kind: 'isoxml', rows: isoxmlRows(readIsoxml(files.files)) }
      const layers = (await readShapefiles(files.files, crsOverride)).filter((l) => l.features.length)
      if (!layers.length) {
        const portalXml = files.files.some((f) => ['xml', 'gml'].includes(extension(f)))
        throw new Error(t(source === 'antrag' && portalXml ? 'import.antrag.xmlOnly' : 'import.shapefile.none'))
      }
      return { kind: 'shape', layers }
    }
    run()
      .then((p) => !cancelled && setParsed(p))
      .catch((e) => {
        if (cancelled) return
        setParsed(null)
        setParseError(errorMessage(e))
      })
      .finally(() => !cancelled && setParsing(false))
    return () => {
      cancelled = true
    }
  }, [files, crsOverride, source, t])

  const layers = parsed?.kind === 'shape' ? parsed.layers : []
  const layer = layers.find((l) => l.name === layerName) ?? layers[0] ?? null

  // Column mappings are detected once per layer and can then be changed by the user.
  useEffect(() => {
    if (!layer) return
    if (source === 'antrag') setAntragMapping(detectAntragColumns(layer.features, knownCodes))
    else setShapeMapping(guessShapeMapping(layer.features))
    setExcluded(null)
  }, [layer, source, knownCodes])

  const rows: ImportRow[] = useMemo(() => {
    if (parsed?.kind === 'isoxml') return parsed.rows
    if (!layer || layer.crs.source === 'unknown') return []
    if (source === 'antrag') return antragMapping ? antragRows(layer.features, antragMapping) : []
    return shapeMapping ? shapeRows(layer.features, shapeMapping) : []
  }, [parsed, layer, source, antragMapping, shapeMapping])

  const duplicates = useMemo(() => new Map(rows.map((r) => [r.key, existingField(r, fields, farmId)])), [rows, fields, farmId])
  const invalid = useMemo(() => new Set(rows.filter((r) => !r.geometry).map((r) => r.key)), [rows])
  // By default, rows that already exist on the farm are left out.
  const skip = excluded ?? new Set(rows.filter((r) => duplicates.get(r.key)).map((r) => r.key))
  const selected = rows.filter((r) => !skip.has(r.key) && !invalid.has(r.key))

  const cropKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r.cropKey) counts.set(r.cropKey, (counts.get(r.cropKey) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [rows])
  const resolvedCrop = (key: string) => (key in cropChoice ? cropChoice[key] : (matchCrop(key, crops.data ?? [])?.id ?? null))
  const canAssign = can('crop.write') && cropKeys.length > 0 && seasons.length > 0
  const withCrops = canAssign && assignCrops && !!seasonId

  const importMutation = useOrgMutation(
    (base, _: void) =>
      api.post<ImportFieldsResult>(`${base}/fields/import`, {
        farmId,
        seasonId: withCrops ? seasonId : null,
        features: selected.map((r) => ({
          name: r.name,
          identifier: r.identifier,
          geometry: r.geometry,
          cropId: withCrops && r.cropKey ? resolvedCrop(r.cropKey) : null,
          landUseCode: r.landUseCode,
        })),
      }),
    { success: (r) => t('fields.import.imported', { count: r.created.length }), onSuccess: setResult },
  )

  const load = async (list: File[]) => {
    if (!list.length) return
    setResult(null)
    setParsed(null)
    setLayerName(null)
    setCrsOverride(null)
    setCropChoice({})
    try {
      setFiles({ label: list.map((f) => f.name).join(', '), files: await collectFiles(list) })
    } catch (e) {
      setParseError(errorMessage(e))
    }
  }
  const reset = () => {
    setFiles(null)
    setParsed(null)
    setResult(null)
    setExcluded(null)
  }

  const preview: FeatureCollection = {
    type: 'FeatureCollection',
    features: selected.map((r) => ({ type: 'Feature', geometry: r.geometry!, properties: {} })),
  }
  const keys = layer ? propertyKeys(layer.features) : []
  const keyItems = [{ id: '__none', name: t('fields.import.noAttribute') }, ...keys.map((k) => ({ id: k, name: k }))]
  const totalHa = selected.reduce((s, r) => s + (r.areaHa ?? 0), 0)

  return (
    <div className="grid xl:grid-cols-[1fr_26rem] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <FieldMap fields={fields} highlight={selected.length ? preview : null} view={farmView(farms.find((f) => f.id === farmId))} className="h-[50vh] min-h-80" />
        {rows.length > 0 && !result && (
          <Card
            title={t('import.rows.title')}
            description={t('import.rows.summary', { count: selected.length, total: rows.length, area: fmt.ha(totalHa, 1) })}
            padded={false}
          >
            <div className="max-h-[32rem] overflow-y-auto">
              <Table
                aria-label={t('import.rows.title')}
                selectionMode="multiple"
                selectedKeys={new Set(selected.map((r) => r.key))}
                disabledKeys={invalid}
                onSelectionChange={(keys) =>
                  setExcluded(keys === 'all' ? new Set() : new Set(rows.filter((r) => !keys.has(r.key)).map((r) => r.key)))
                }
              >
                <TableHeader>
                  <Column className="w-10">
                    <Checkbox slot="selection" />
                  </Column>
                  <Column isRowHeader>{t('common.name')}</Column>
                  <Column>{t('fields.identifier')}</Column>
                  {cropKeys.length > 0 && <Column>{t('import.rows.crop')}</Column>}
                  {source === 'isoxml' && <Column>{t('import.rows.origin')}</Column>}
                  <Column align="end">{t('import.rows.area')}</Column>
                  <Column>{t('import.rows.status')}</Column>
                </TableHeader>
                <TableBody items={rows}>
                  {(r) => {
                    const dup = duplicates.get(r.key)
                    const cropId = r.cropKey ? resolvedCrop(r.cropKey) : null
                    return (
                      <Row id={r.key}>
                        <Cell>
                          <Checkbox slot="selection" />
                        </Cell>
                        <Cell className="max-w-64 truncate">{r.name}</Cell>
                        <Cell className="text-muted">{r.identifier}</Cell>
                        {cropKeys.length > 0 && (
                          <Cell>
                            {r.cropKey && (
                              <span className="whitespace-nowrap">
                                {crops.data?.find((c) => c.id === cropId)?.name ?? <span className="text-muted">{r.cropKey}</span>}
                              </span>
                            )}
                          </Cell>
                        )}
                        {source === 'isoxml' && <Cell className="text-muted">{r.origin}</Cell>}
                        <Cell align="end">{r.areaHa != null ? fmt.ha(r.areaHa, 2) : '–'}</Cell>
                        <Cell>
                          {!r.geometry ? (
                            <Badge tone="danger">{t('import.rows.noBoundary')}</Badge>
                          ) : dup ? (
                            <Badge tone="warning">{t('import.rows.exists', { name: dup.name })}</Badge>
                          ) : (
                            <Badge tone="success">{t('import.rows.new')}</Badge>
                          )}
                        </Cell>
                      </Row>
                    )
                  }}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title={t(`import.file.${source}`)}>
          <DropZone
            onDrop={async (e) => {
              const items = e.items.filter((i) => i.kind === 'file')
              await load(await Promise.all(items.map((i) => (i.kind === 'file' ? i.getFile() : Promise.reject()))))
            }}
            className="rounded-xl border-2 border-dashed border-line-strong p-6 text-center outline-none drop-target:border-primary drop-target:bg-primary-soft focus-visible:border-primary"
          >
            <FileUp className="size-8 text-muted mx-auto" aria-hidden />
            <p className="text-sm mt-2">{t('import.drop')}</p>
            <FileTrigger allowsMultiple acceptedFileTypes={SOURCE_META[source].accept} onSelect={(list) => list && load(Array.from(list))}>
              <Button size="sm" className="mt-2">{t('fields.import.choose')}</Button>
            </FileTrigger>
            <p className="text-xs text-muted mt-3">{t(`import.formats.${source}`)}</p>
          </DropZone>
          {parsing && <p className="text-sm text-muted mt-3">{t('import.reading')}</p>}
          {parseError && <Notice tone="danger" className="mt-3">{parseError}</Notice>}
          {files && parsed && (
            <p className="text-sm mt-3 break-words">
              <strong>{files.label}</strong> ·{' '}
              {parsed.kind === 'isoxml'
                ? t('import.isoxml.partfields', { count: parsed.rows.length })
                : layer && (layer.skipped ? t('fields.import.polygonsSkipped', { count: layer.features.length, skipped: layer.skipped }) : t('fields.import.polygons', { count: layer.features.length }))}
            </p>
          )}
        </Card>

        {layer && !result && (
          <Card title={t('import.mapping.title')} description={source === 'antrag' ? t('import.mapping.antragHint') : undefined}>
            <div className="space-y-4">
              {layers.length > 1 && (
                <Select label={t('import.mapping.layer')} items={layers.map((l) => ({ id: l.name, name: `${l.name} (${l.features.length})` }))} value={layer.name} onChange={(v) => setLayerName(v ? String(v) : null)}>
                  {(l) => <Option id={l.id}>{l.name}</Option>}
                </Select>
              )}
              {layer.crs.source !== 'prj' && (
                <>
                  {layer.crs.source === 'unknown' && <Notice tone="danger" icon={AlertTriangle}>{t('import.crs.unknown')}</Notice>}
                  {layer.crs.source === 'guessed' && !layer.crs.certain && <Notice tone="warning" icon={AlertTriangle}>{t('import.crs.uncertain')}</Notice>}
                  <Select
                    label={t('import.crs.label')}
                    description={t('import.crs.description')}
                    items={CRS_OPTIONS.map((c) => ({ id: c.id, name: c.label }))}
                    value={crsOverride ?? layer.crs.id}
                    onChange={(v) => setCrsOverride(v ? (String(v) as CrsId) : null)}
                  >
                    {(c) => <Option id={c.id}>{c.name}</Option>}
                  </Select>
                </>
              )}
              {source === 'antrag' && antragMapping &&
                ANTRAG_ROLES.map((role) => (
                  <Select
                    key={role}
                    label={t(`import.antrag.column.${role}`)}
                    items={keyItems}
                    value={antragMapping[role] ?? '__none'}
                    onChange={(v) => {
                      setAntragMapping({ ...antragMapping, [role]: v === '__none' || v == null ? null : String(v) })
                      setCropChoice({})
                    }}
                  >
                    {(k) => <Option id={k.id}>{k.name}</Option>}
                  </Select>
                ))}
              {source === 'shapefile' && shapeMapping && (
                <>
                  <Select label={t('fields.import.nameAttribute')} items={[{ id: '__none', name: t('fields.import.numbered') }, ...keyItems.slice(1)]} value={shapeMapping.name ?? '__none'} onChange={(v) => setShapeMapping({ ...shapeMapping, name: v === '__none' || v == null ? null : String(v) })}>
                    {(k) => <Option id={k.id}>{k.name}</Option>}
                  </Select>
                  <Select label={t('fields.import.identifierAttribute')} items={keyItems} value={shapeMapping.identifier ?? '__none'} onChange={(v) => setShapeMapping({ ...shapeMapping, identifier: v === '__none' || v == null ? null : String(v) })}>
                    {(k) => <Option id={k.id}>{k.name}</Option>}
                  </Select>
                  <Select label={t('import.mapping.cropAttribute')} items={keyItems} value={shapeMapping.crop ?? '__none'} onChange={(v) => { setShapeMapping({ ...shapeMapping, crop: v === '__none' || v == null ? null : String(v) }); setCropChoice({}) }}>
                    {(k) => <Option id={k.id}>{k.name}</Option>}
                  </Select>
                </>
              )}
            </div>
          </Card>
        )}

        {rows.length > 0 && !result && (
          <Card title={t('import.target.title')}>
            <div className="space-y-4">
              <Select label={t('fields.farm')} items={farms} value={farmId} onChange={(v) => { setFarmId(v ? String(v) : null); setExcluded(null) }}>
                {(f) => <Option id={f.id}>{f.name}</Option>}
              </Select>
              {cropKeys.length > 0 && !can('crop.write') && <Notice tone="info">{t('import.crops.noPermission')}</Notice>}
              {cropKeys.length > 0 && can('crop.write') && seasons.length === 0 && <Notice tone="info">{t('import.crops.noSeason')}</Notice>}
              {canAssign && (
                <>
                  <Switch isSelected={assignCrops} onChange={setAssignCrops}>{t('import.crops.assign')}</Switch>
                  {assignCrops && (
                    <>
                      <Select label={t('nav.season')} items={seasons.map((s) => ({ id: s.id, name: String(s.harvestYear) }))} value={seasonId} onChange={(v) => setSeasonId(v ? String(v) : null)}>
                        {(s) => <Option id={s.id}>{s.name}</Option>}
                      </Select>
                      <div>
                        <div className="text-sm font-medium text-fg mb-1">{t('import.crops.mapping')}</div>
                        <p className="text-xs text-muted mb-2">{t('import.crops.mappingHint')}</p>
                        <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                          {cropKeys.map(([key, count]) => {
                            const code = codes.data?.find((c) => c.code === key)
                            return (
                              <li key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 items-center">
                                <span className="text-sm min-w-0">
                                  <span className="block truncate">{code ? `${key} · ${code.name}` : key}</span>
                                  <span className="block text-xs text-muted">{t('import.crops.rows', { count })}</span>
                                </span>
                                <ComboBox
                                  aria-label={t('import.crops.cropFor', { key })}
                                  placeholder={t('import.crops.none')}
                                  items={crops.data ?? []}
                                  value={resolvedCrop(key)}
                                  onChange={(v) => setCropChoice({ ...cropChoice, [key]: v ? String(v) : null })}
                                >
                                  {(c) => <Option id={c.id}>{c.name}</Option>}
                                </ComboBox>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    </>
                  )}
                </>
              )}
              <Button variant="primary" className="w-full" isDisabled={!farmId || !selected.length || (withCrops && !seasonId)} isPending={importMutation.isPending} onPress={() => importMutation.mutate()}>
                {t('fields.import.submit', { count: selected.length })}
              </Button>
            </div>
          </Card>
        )}

        {result && (
          <Card title={t('fields.import.result')}>
            <div className="space-y-3 text-sm">
              <Notice tone="success" icon={CheckCircle2}>
                {t('fields.import.resultSummary', { count: result.created.length, area: fmt.ha(result.created.reduce((s, c) => s + c.areaHa, 0), 1) })}
                {result.cropsAssigned > 0 && <> {t('import.result.crops', { count: result.cropsAssigned })}</>}
              </Notice>
              {result.errors.length > 0 && (
                <Notice tone="danger" icon={AlertTriangle}>
                  <strong>{t('fields.import.notImported', { count: result.errors.length })}</strong>
                  <ul className="mt-1 list-disc pl-4">{result.errors.slice(0, 20).map((e) => <li key={e.index}>{e.name}: {e.message}</li>)}</ul>
                </Notice>
              )}
              {result.overlaps.length > 0 && (
                <Notice tone="warning" icon={AlertTriangle}>
                  {t('fields.import.overlaps', { count: result.overlaps.length, names: result.overlaps.map((o) => o.name).join(', ') })}
                </Notice>
              )}
              <div className="flex gap-2 justify-end">
                <Button onPress={reset}>{t('fields.import.another')}</Button>
                <Button variant="primary" onPress={() => navigate({ to: '/o/$orgId/fields', params: { orgId } })}>{t('fields.import.viewFields')}</Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
