import type { Crop, Farm, Field, ImportFieldsResult, LandUseCode } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FeatureCollection, Geometry } from 'geojson'
import { AlertTriangle, CheckCircle2, FileText, FileUp, type LucideIcon, Shapes, Tractor } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button as AriaButton, DropZone, FileTrigger, Radio, RadioGroup } from 'react-aria-components'
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
  harvestYearFromName,
  isoxmlRows,
  matchCrop,
  propertyKeys,
  repeatedRows,
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
// The import preview frames only the file's fields, not the farm's existing ones.
const NO_FIELDS: string[] = []

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

/**
 * The layer of an uploaded file to read by default: for application data one with land-use codes
 * (portal exports also carry landscape elements), otherwise the one with the most polygons.
 */
function defaultLayer(layers: ShapeLayer[], source: ImportSource, knownCodes: Set<string>) {
  const largest = [...layers].sort((a, b) => b.features.length - a.features.length)
  return (source === 'antrag' && largest.find((l) => detectAntragColumns(l.features, knownCodes).code)) || largest[0]
}

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
  // The layer read from each uploaded file, by file; otherwise the default from `defaultLayer`.
  const [layerChoice, setLayerChoice] = useState<Record<string, string>>({})
  const [antragMapping, setAntragMapping] = useState<AntragMapping | null>(null)
  const [shapeMapping, setShapeMapping] = useState<ShapeMapping | null>(null)
  const [excluded, setExcluded] = useState<Set<number> | null>(null)
  const [farmId, setFarmId] = useState<string | null>(farms[0]?.id ?? null)
  // The season each file's crops go to, by file, where the user changed it.
  const [seasonChoice, setSeasonChoice] = useState<Record<string, string | null>>({})
  const [assignCrops, setAssignCrops] = useState(true)
  const [cropChoice, setCropChoice] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState<ImportFieldsResult | null>(null)
  // What the map moves to: all fields of a newly read file, or the row clicked in the table.
  const [focus, setFocus] = useState<Geometry | FeatureCollection | null>(null)

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

  const layers = useMemo(() => (parsed?.kind === 'shape' ? parsed.layers : []), [parsed])
  const layersByFile = useMemo(() => {
    const byFile = new Map<string, ShapeLayer[]>()
    for (const l of layers) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l])
    return byFile
  }, [layers])
  // One layer per uploaded file; all of them make up the import.
  const chosen = useMemo(
    () => [...layersByFile.values()].map((ls) => ls.find((l) => l.id === layerChoice[ls[0].file]) ?? defaultLayer(ls, source, knownCodes)),
    [layersByFile, layerChoice, source, knownCodes],
  )
  const usable = useMemo(() => chosen.filter((l) => l.crs.source !== 'unknown'), [chosen])
  const chosenKey = chosen.map((l) => l.id).join('|')

  // Column mappings are detected once per set of layers and can then be changed by the user.
  useEffect(() => {
    if (!chosen.length) return
    const features = chosen.flatMap((l) => l.features)
    if (source === 'antrag') setAntragMapping(detectAntragColumns(features, knownCodes))
    else setShapeMapping(guessShapeMapping(features))
    setExcluded(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, parsed, source, knownCodes])

  const rows: ImportRow[] = useMemo(() => {
    if (parsed?.kind === 'isoxml') return parsed.rows
    const mapping = source === 'antrag' ? antragMapping : shapeMapping
    if (!mapping) return []
    let next = 0
    return usable.flatMap((l) =>
      (source === 'antrag' ? antragRows(l.features, antragMapping!) : shapeRows(l.features, shapeMapping!)).map((r) => ({ ...r, key: next++, file: l.file })),
    )
  }, [parsed, usable, source, antragMapping, shapeMapping])

  // New files, layers or a reference system frame all their fields; a changed column mapping keeps the camera.
  useEffect(() => {
    const geometries = parsed?.kind === 'isoxml' ? parsed.rows.flatMap((r) => (r.geometry ? [r.geometry] : [])) : usable.flatMap((l) => l.features.map((f) => f.geometry))
    const features = geometries.map((geometry) => ({ type: 'Feature' as const, geometry, properties: {} }))
    setFocus(features.length ? { type: 'FeatureCollection', features } : null)
  }, [parsed, usable])

  const duplicates = useMemo(() => new Map(rows.map((r) => [r.key, existingField(r, fields, farmId)])), [rows, fields, farmId])
  const repeated = useMemo(() => repeatedRows(rows), [rows])
  const invalid = useMemo(() => new Set(rows.filter((r) => !r.geometry).map((r) => r.key)), [rows])
  const severalFiles = new Set(rows.map((r) => r.file)).size > 1
  // By default, rows that already exist on the farm or come again in a later file are left out.
  const skip = excluded ?? new Set(rows.filter((r) => duplicates.get(r.key) || repeated.has(r.key)).map((r) => r.key))
  const selected = rows.filter((r) => !skip.has(r.key) && !invalid.has(r.key))

  const cropKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r.cropKey) counts.set(r.cropKey, (counts.get(r.cropKey) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [rows])
  const resolvedCrop = (key: string) => (key in cropChoice ? cropChoice[key] : (matchCrop(key, crops.data ?? [])?.id ?? null))
  const canAssign = can('crop.write') && cropKeys.length > 0 && seasons.length > 0
  // Crops go to the season of the year in their file's name, e.g. "Antrag 2026.zip"; without a year to the working season.
  const cropFiles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r.cropKey) counts.set(r.file ?? '', (counts.get(r.file ?? '') ?? 0) + 1)
    return [...counts].map(([file, count]) => {
      const year = harvestYearFromName(file)
      return { file, count, year, detected: year == null ? (workingSeasonId ?? null) : (seasons.find((s) => s.harvestYear === year)?.id ?? null) }
    })
  }, [rows, seasons, workingSeasonId])
  const seasonFor = (file: string | null) => {
    const f = file ?? ''
    return f in seasonChoice ? seasonChoice[f] : (cropFiles.find((c) => c.file === f)?.detected ?? null)
  }
  const withCrops = (r: ImportRow) => canAssign && assignCrops && !!r.cropKey && !!seasonFor(r.file)
  const seasonItems = [{ id: '__none', name: t('import.crops.noSeasonOption') }, ...[...seasons].sort((a, b) => b.harvestYear - a.harvestYear).map((s) => ({ id: s.id, name: String(s.harvestYear) }))]

  const importMutation = useOrgMutation(
    (base, _: void) =>
      api.post<ImportFieldsResult>(`${base}/fields/import`, {
        farmId,
        features: selected.map((r) => {
          const cropId = withCrops(r) ? resolvedCrop(r.cropKey!) : null
          return { name: r.name, identifier: r.identifier, geometry: r.geometry, cropId, seasonId: cropId ? seasonFor(r.file) : null, landUseCode: r.landUseCode }
        }),
      }),
    { success: (r) => t('fields.import.imported', { count: r.created.length }), onSuccess: setResult },
  )

  const load = async (list: File[]) => {
    if (!list.length) return
    setResult(null)
    setParsed(null)
    setLayerChoice({})
    setCrsOverride(null)
    setCropChoice({})
    setSeasonChoice({})
    try {
      // Name order puts the export of a later year after the earlier one (see repeatedRows).
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      setFiles({ label: sorted.map((f) => f.name).join(', '), files: await collectFiles(sorted) })
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
  const keys = propertyKeys(chosen.flatMap((l) => l.features))
  const withoutPrj = chosen.filter((l) => l.crs.source !== 'prj')
  const keyItems = [{ id: '__none', name: t('fields.import.noAttribute') }, ...keys.map((k) => ({ id: k, name: k }))]
  const totalHa = selected.reduce((s, r) => s + (r.areaHa ?? 0), 0)

  return (
    <div className="grid xl:grid-cols-[1fr_26rem] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <FieldMap
          fields={fields}
          fitIds={NO_FIELDS}
          highlight={selected.length ? preview : null}
          focus={focus}
          view={farmView(farms.find((f) => f.id === farmId))}
          className="h-[50vh] min-h-80"
        />
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
                  {severalFiles && <Column>{t('import.rows.file')}</Column>}
                  <Column align="end">{t('import.rows.area')}</Column>
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
                        <Cell>
                          <span className="flex items-center gap-2 min-w-0">
                            {r.geometry ? (
                              // A press on the name moves the map there (also again, after panning away); the rest of the row toggles the selection.
                              <AriaButton
                                className="truncate max-w-64 text-left cursor-pointer hover:underline underline-offset-2 outline-none focus-visible:underline"
                                onPress={() => setFocus({ ...r.geometry! })}
                              >
                                {r.name}
                              </AriaButton>
                            ) : (
                              <span className="truncate max-w-64">{r.name}</span>
                            )}
                            {!r.geometry ? (
                              <Badge tone="danger">{t('import.rows.noBoundary')}</Badge>
                            ) : dup ? (
                              <Badge tone="warning">{t('import.rows.exists', { name: dup.name })}</Badge>
                            ) : (
                              repeated.has(r.key) && <Badge tone="warning">{t('import.rows.repeated', { file: repeated.get(r.key)!.file ?? '' })}</Badge>
                            )}
                          </span>
                        </Cell>
                        <Cell className="text-muted">{r.identifier}</Cell>
                        {cropKeys.length > 0 && (
                          <Cell>
                            {r.cropKey && (
                              <span className="whitespace-nowrap">
                                {/* Muted where the row's file gets no crops. */}
                                <span className={cx(!withCrops(r) && 'text-muted')}>{crops.data?.find((c) => c.id === cropId)?.name ?? r.cropKey}</span>
                              </span>
                            )}
                          </Cell>
                        )}
                        {source === 'isoxml' && <Cell className="text-muted">{r.origin}</Cell>}
                        {severalFiles && <Cell className="text-muted max-w-48 truncate">{r.file}</Cell>}
                        <Cell align="end">{r.areaHa != null ? fmt.ha(r.areaHa, 2) : '–'}</Cell>
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
                : (() => {
                    const count = chosen.reduce((n, l) => n + l.features.length, 0)
                    const skipped = chosen.reduce((n, l) => n + l.skipped, 0)
                    return skipped ? t('fields.import.polygonsSkipped', { count, skipped }) : t('fields.import.polygons', { count })
                  })()}
            </p>
          )}
        </Card>

        {chosen.length > 0 && !result && (
          <Card title={t('import.mapping.title')} description={source === 'antrag' ? t('import.mapping.antragHint') : undefined}>
            <div className="space-y-4">
              {[...layersByFile].map(
                ([file, ls]) =>
                  ls.length > 1 && (
                    <Select
                      key={file}
                      label={layersByFile.size > 1 ? `${t('import.mapping.layer')} · ${file}` : t('import.mapping.layer')}
                      items={ls.map((l) => ({ id: l.id, name: `${l.name} (${l.features.length})` }))}
                      value={chosen.find((l) => l.file === file)?.id ?? null}
                      onChange={(v) => v && setLayerChoice({ ...layerChoice, [file]: String(v) })}
                    >
                      {(l) => <Option id={l.id}>{l.name}</Option>}
                    </Select>
                  ),
              )}
              {withoutPrj.length > 0 && (
                <>
                  {withoutPrj.some((l) => l.crs.source === 'unknown') && <Notice tone="danger" icon={AlertTriangle}>{t('import.crs.unknown')}</Notice>}
                  {withoutPrj.some((l) => l.crs.source === 'guessed' && !l.crs.certain) && <Notice tone="warning" icon={AlertTriangle}>{t('import.crs.uncertain')}</Notice>}
                  <Select
                    label={t('import.crs.label')}
                    description={t('import.crs.description')}
                    items={CRS_OPTIONS.map((c) => ({ id: c.id, name: c.label }))}
                    value={crsOverride ?? withoutPrj[0].crs.id}
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
                      <div>
                        <div className="text-sm font-medium text-fg mb-1">{t('import.crops.season')}</div>
                        <p className="text-xs text-muted mb-2">{t('import.crops.seasonHint')}</p>
                        <div className="space-y-3">
                          {cropFiles.map(({ file, count, year, detected }) => (
                            <Select
                              key={file}
                              label={cropFiles.length > 1 ? file : t('nav.season')}
                              description={[
                                t('import.crops.rows', { count }),
                                year != null && !detected && t('import.crops.noSeasonForYear', { year }),
                              ].filter(Boolean).join(' · ')}
                              items={seasonItems}
                              value={seasonFor(file) ?? '__none'}
                              onChange={(v) => setSeasonChoice({ ...seasonChoice, [file]: v && v !== '__none' ? String(v) : null })}
                            >
                              {(s) => <Option id={s.id}>{s.name}</Option>}
                            </Select>
                          ))}
                        </div>
                      </div>
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
              <Button variant="primary" className="w-full" isDisabled={!farmId || !selected.length} isPending={importMutation.isPending} onPress={() => importMutation.mutate()}>
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
