import type { Farm, Field, ImportFieldsResult } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FeatureCollection } from 'geojson'
import { AlertTriangle, CheckCircle2, FileUp, Landmark, PenLine, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DropZone, FileTrigger, Form } from 'react-aria-components'
import { Trans, useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ParcelPicker } from '#/components/cadastral/ParcelPicker'
import { FieldDetailsForm, detailsPayload, emptyDetails, type FieldDetails } from '#/components/fields/FieldDetailsForm'
import { guessProperty, parseBoundaryFile, propertyKeys, type ImportCandidate } from '#/components/fields/importFile'
import { useGeometryCheck } from '#/components/fields/useGeometryCheck'
import { useOnboardingStep } from '#/components/onboarding/useOnboardingStep'
import { DrawField, type DrawnGeometry } from '#/components/map/DrawField'
import { FieldMap } from '#/components/map/FieldMap'
import { farmView } from '#/components/map/useMap'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Card, EmptyState, Notice, PageHeader } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/fields/new')({
  validateSearch: z.object({ onboarding: z.boolean().optional(), mode: z.enum(['draw', 'import', 'parcels']).optional() }),
  component: NewField,
})

function NewField() {
  const { orgId, can } = useOrg()
  const { t } = useTranslation()
  const { onboarding, mode: initialMode } = Route.useSearch()
  const [mode, setMode] = useState<'draw' | 'import' | 'parcels'>(initialMode ?? 'draw')
  const farms = useOrgQuery<Farm[]>('/farms')
  const fields = useOrgQuery<Field[]>('/fields')

  if (!can('field.write')) return <EmptyState title={t('fields.new.noPermission')} />
  if (farms.data && farms.data.length === 0) {
    return (
      <EmptyState title={t('fields.new.noFarm.title')} action={<Link to="/o/$orgId/settings" params={{ orgId }} variant="primary">{t('fields.new.noFarm.action')}</Link>}>
        {t('fields.new.noFarm.description')}
      </EmptyState>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={onboarding ? t('fields.new.onboardingStep', { step: 4, total: 5 }) : <Link to="/o/$orgId/fields" params={{ orgId }}>{t('fields.list')}</Link>}
        title={t('fields.new.title')}
        subtitle={t('fields.new.subtitle')}
        actions={
          <SegmentedControl
            aria-label={t('fields.new.mode')}
            value={mode}
            onChange={setMode}
            items={[
              { id: 'draw', label: <><PenLine aria-hidden /> {t('fields.new.modeDraw')}</> },
              { id: 'parcels', label: <><Landmark aria-hidden /> {t('fields.new.modeParcels')}</> },
              { id: 'import', label: <><Upload aria-hidden /> {t('fields.new.modeImport')}</> },
            ]}
          />
        }
      />
      {farms.data && fields.data &&
        (mode === 'draw' ? (
          <DrawMode farms={farms.data} fields={fields.data} onboarding={!!onboarding} />
        ) : mode === 'parcels' ? (
          <ParcelPicker farms={farms.data} fields={fields.data} />
        ) : (
          <ImportMode farms={farms.data} fields={fields.data} onboarding={!!onboarding} />
        ))}
    </>
  )
}

function DrawMode({ farms, fields, onboarding }: { farms: Farm[]; fields: Field[]; onboarding: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const setStep = useOnboardingStep()
  const finishStep = () => setStep('invite')
  const [geometry, setGeometry] = useState<DrawnGeometry | null>(null)
  const [details, setDetails] = useState<FieldDetails>(() => emptyDetails(farms[0]?.id ?? null))
  const { result, checking } = useGeometryCheck(geometry)
  const farm = farms.find((f) => f.id === details.farmId) ?? farms[0]
  const create = useOrgMutation((base, _: void) => api.post<Field>(`${base}/fields`, { farmId: details.farmId, geometry, ...detailsPayload(details) }), {
    success: (f) => t('fields.new.saved', { name: f.name, area: fmt.ha(f.areaHa) }),
    onSuccess: (f) =>
      onboarding
        ? finishStep().then(() => navigate({ to: '/o/$orgId/onboarding', params: { orgId } }))
        : navigate({ to: '/o/$orgId/fields/$fieldId', params: { orgId, fieldId: f.id } }),
  })
  const canSave = geometry && result?.valid && details.name.trim() && details.farmId

  return (
    <div className="grid xl:grid-cols-[1fr_24rem] gap-4 items-start">
      <DrawField
        context={fields}
        view={farmView(farm) ?? (!fields.length && farm?.location ? { center: [farm.location.lng, farm.location.lat], zoom: 15 } : null)}
        onChange={setGeometry} className="h-[60vh] xl:h-[calc(100dvh-12rem)] min-h-96" />
      <Card title={t('fields.new.details')}>
        <Form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) create.mutate()
          }}
        >
          <FieldDetailsForm value={details} onChange={setDetails} farms={farms} />
          <GeometryStatus geometry={geometry} result={result} checking={checking} />
          <div className="flex justify-end gap-2 pt-2">
            {onboarding && <Button variant="ghost" onPress={() => void finishStep().then(() => navigate({ to: '/o/$orgId/onboarding', params: { orgId } }))}>{t('fields.new.skip')}</Button>}
            <Button type="submit" variant="primary" isDisabled={!canSave} isPending={create.isPending}>
              {t('fields.new.save')}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  )
}

function GeometryStatus({ geometry, result, checking }: { geometry: DrawnGeometry | null; result: ReturnType<typeof useGeometryCheck>['result']; checking: boolean }) {
  const { t } = useTranslation()
  if (!geometry) return <Notice tone="info">{t('fields.geometry.drawHint')}</Notice>
  if (checking && !result) return <p className="text-sm text-muted">{t('fields.geometry.checking')}</p>
  if (!result) return null
  if (!result.valid) return <Notice tone="danger" icon={AlertTriangle}><Trans i18nKey="fields.geometry.invalid" values={{ reason: result.reason }} components={{ b: <strong /> }} /></Notice>
  return (
    <div className="space-y-2">
      <Notice tone="success" icon={CheckCircle2}>
        <Trans i18nKey="fields.geometry.valid" values={{ area: fmt.ha(result.areaHa, 2) }} components={{ b: <strong className="tabular" /> }} />
      </Notice>
      {result.overlaps.length > 0 && (
        <Notice tone="warning" icon={AlertTriangle}>
          {t('fields.geometry.overlaps', { fields: result.overlaps.map((o) => `${o.fieldName} (${fmt.ha(o.overlapHa, 2)})`).join(', ') })}
        </Notice>
      )}
    </div>
  )
}

function ImportMode({ farms, fields, onboarding }: { farms: Farm[]; fields: Field[]; onboarding: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const setStep = useOnboardingStep()
  const finishStep = () => setStep('invite')
  const [file, setFile] = useState<{ name: string; format: string; skipped: number } | null>(null)
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [nameKey, setNameKey] = useState<string | null>(null)
  const [idKey, setIdKey] = useState<string | null>(null)
  const [farmId, setFarmId] = useState<string | null>(farms[0]?.id ?? null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportFieldsResult | null>(null)

  const load = async (f: File) => {
    setParseError(null)
    setResult(null)
    try {
      const parsed = await parseBoundaryFile(f)
      if (!parsed.candidates.length) throw new Error(t('fields.import.noPolygons'))
      setCandidates(parsed.candidates)
      setFile({ name: f.name, format: parsed.format, skipped: parsed.skipped })
      setNameKey(guessProperty(parsed.candidates, 'name'))
      setIdKey(guessProperty(parsed.candidates, 'identifier'))
    } catch (e) {
      setCandidates([])
      setFile(null)
      setParseError(errorMessage(e))
    }
  }

  const keys = useMemo(() => propertyKeys(candidates), [candidates])
  const features = candidates.map((c, i) => ({
    name: String((nameKey && c.properties[nameKey]) || t('fields.import.defaultName', { number: i + 1 })).slice(0, 200),
    identifier: idKey && c.properties[idKey] != null ? String(c.properties[idKey]).slice(0, 200) : null,
    geometry: c.geometry,
  }))
  const preview: FeatureCollection = { type: 'FeatureCollection', features: features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {} })) }

  const importMutation = useOrgMutation((base, _: void) => api.post<ImportFieldsResult>(`${base}/fields/import`, { farmId, features }), {
    success: (r) => t('fields.import.imported', { count: r.created.length }),
    onSuccess: setResult,
  })

  return (
    <div className="grid xl:grid-cols-[1fr_26rem] gap-4 items-start">
      <FieldMap fields={fields} highlight={candidates.length ? preview : null} view={farmView(farms.find((f) => f.id === farmId))} className="h-[60vh] xl:h-[calc(100dvh-12rem)] min-h-96" />
      <div className="space-y-4">
        <Card title={t('fields.import.file')}>
          <DropZone
            onDrop={async (e) => {
              const item = e.items.find((i) => i.kind === 'file')
              if (item && item.kind === 'file') await load(await item.getFile())
            }}
            className={cx('rounded-xl border-2 border-dashed border-line-strong p-6 text-center outline-none drop-target:border-primary drop-target:bg-primary-soft focus-visible:border-primary')}
          >
            <FileUp className="size-8 text-muted mx-auto" aria-hidden />
            <p className="text-sm mt-2">{t('fields.import.drop')}</p>
            <FileTrigger acceptedFileTypes={['.geojson', '.json', '.kml', '.zip', 'application/geo+json', 'application/json', 'application/zip', 'application/vnd.google-earth.kml+xml']} onSelect={(files) => files?.[0] && load(files[0])}>
              <Button size="sm" className="mt-2">{t('fields.import.choose')}</Button>
            </FileTrigger>
            <p className="text-xs text-muted mt-3">{t('fields.import.formats')}</p>
          </DropZone>
          {parseError && <Notice tone="danger" className="mt-3">{parseError}</Notice>}
          {file && (
            <p className="text-sm mt-3">
              <strong>{file.name}</strong> · {file.format} · {file.skipped ? t('fields.import.polygonsSkipped', { count: candidates.length, skipped: file.skipped }) : t('fields.import.polygons', { count: candidates.length })}
            </p>
          )}
        </Card>

        {candidates.length > 0 && !result && (
          <Card title={t('fields.import.settings')}>
            <div className="space-y-4">
              <Select label={t('fields.farm')} items={farms} value={farmId} onChange={(v) => setFarmId(v ? String(v) : null)}>
                {(f) => <Option id={f.id}>{f.name}</Option>}
              </Select>
              <Select label={t('fields.import.nameAttribute')} items={[{ id: '__none', name: t('fields.import.numbered') }, ...keys.map((k) => ({ id: k, name: k }))]} value={nameKey ?? '__none'} onChange={(v) => setNameKey(v === '__none' ? null : String(v))}>
                {(k) => <Option id={k.id}>{k.name}</Option>}
              </Select>
              <Select label={t('fields.import.identifierAttribute')} items={[{ id: '__none', name: t('fields.import.noAttribute') }, ...keys.map((k) => ({ id: k, name: k }))]} value={idKey ?? '__none'} onChange={(v) => setIdKey(v === '__none' ? null : String(v))}>
                {(k) => <Option id={k.id}>{k.name}</Option>}
              </Select>
              <ul className="max-h-48 overflow-y-auto text-sm divide-y divide-line border border-line rounded-lg">
                {features.slice(0, 100).map((f, i) => (
                  <li key={i} className="px-3 py-1.5 flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="text-muted truncate">{f.identifier}</span>
                  </li>
                ))}
              </ul>
              <Button variant="primary" className="w-full" isDisabled={!farmId} isPending={importMutation.isPending} onPress={() => importMutation.mutate()}>
                {t('fields.import.submit', { count: features.length })}
              </Button>
            </div>
          </Card>
        )}

        {result && (
          <Card title={t('fields.import.result')}>
            <div className="space-y-3 text-sm">
              <Notice tone="success" icon={CheckCircle2}>
                {t('fields.import.resultSummary', { count: result.created.length, area: fmt.ha(result.created.reduce((s, c) => s + c.areaHa, 0), 1) })}
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
                <Button onPress={() => { setResult(null); setCandidates([]); setFile(null) }}>{t('fields.import.another')}</Button>
                <Button variant="primary" onPress={() => (onboarding ? void finishStep().then(() => navigate({ to: '/o/$orgId/onboarding', params: { orgId } })) : void navigate({ to: '/o/$orgId/fields', params: { orgId } }))}>
                  {onboarding ? t('fields.import.continueToCrops') : t('fields.import.viewFields')}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
