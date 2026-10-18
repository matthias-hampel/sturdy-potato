import { FIELD_PART_USAGES, FIELD_PART_USAGE_COLORS, type Field, type FieldPart, type FieldPartUsage, type FieldSplitPreview } from '@agmeo/contracts'
import type { FeatureCollection, Polygon } from 'geojson'
import { Copy, PenLine, Plus, Scissors, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { DrawParts, type PartGeometry } from '#/components/map/DrawParts'
import { FieldMap } from '#/components/map/FieldMap'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { Badge, Card, EmptyState, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export function PartUsageBadge({ usage }: { usage: FieldPartUsage }) {
  const { t } = useTranslation()
  return <Badge dot={FIELD_PART_USAGE_COLORS[usage]}>{t(`fieldParts.usage.${usage}`)}</Badge>
}

/** The part fields (Teilschläge) of a field in the selected season. */
export function FieldPartsTab({ field }: { field: Field }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const { season, seasons } = useSeason()
  const parts = useOrgQuery<FieldPart[]>(`/fields/${field.id}/parts`, { seasonId: season?.id }, { enabled: !!season })
  const previousSeason = season ? seasons.filter((s) => s.harvestYear < season.harvestYear).sort((a, b) => b.harvestYear - a.harvestYear)[0] : undefined
  const previous = useOrgQuery<FieldPart[]>(`/fields/${field.id}/parts`, { seasonId: previousSeason?.id }, { enabled: !!previousSeason && parts.data?.length === 0 })
  const [editing, setEditing] = useState<FieldPart[] | null>(null)

  const overlay = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (parts.data ?? []).map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { color: FIELD_PART_USAGE_COLORS[p.usage] } })),
    }),
    [parts.data],
  )

  if (!season) return <Notice>{t('fieldParts.noSeason')}</Notice>
  if (parts.isLoading) return <Loading />
  const list = parts.data ?? []
  const canWrite = can('field.write')

  if (list.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Scissors}
          title={t('fieldParts.empty.title', { season: season.name })}
          action={
            canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onPress={() => setEditing([])}>
                  <Scissors /> {t('fieldParts.divide')}
                </Button>
                {previousSeason && (previous.data?.length ?? 0) > 0 && (
                  <Button onPress={() => setEditing(previous.data!.map((p) => ({ ...p, id: '', crops: [] })))}>
                    <Copy /> {t('fieldParts.copyFrom', { season: previousSeason.name })}
                  </Button>
                )}
              </div>
            )
          }
        >
          {t('fieldParts.empty.description')}
        </EmptyState>
        {editing && <SplitFieldDialog field={field} seasonId={season.id} seasonName={season.name} initial={editing} onClose={() => setEditing(null)} />}
      </Card>
    )
  }

  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
      <FieldMap fields={[field]} fillOpacity={0} overlay={overlay} labels={false} className="h-96" />
      <Card
        title={t('fieldParts.title', { season: season.name })}
        description={t('fieldParts.summary', { count: list.length, area: fmt.ha(list.filter((p) => p.usage === 'cropped').reduce((sum, p) => sum + p.areaHa, 0), 2) })}
        padded={false}
        actions={canWrite && <Button size="sm" onPress={() => setEditing(list)}><PenLine /> {t('fieldParts.edit')}</Button>}
      >
        {list.some((p) => p.outdated) && (
          <div className="p-3">
            <Notice tone="warning" icon={TriangleAlert}>{t('fieldParts.outdated')}</Notice>
          </div>
        )}
        <Table aria-label={t('fieldParts.tab')}>
          <TableHeader>
            <Column isRowHeader>{t('common.name')}</Column>
            <Column>{t('fieldParts.usageLabel')}</Column>
            <Column align="end">{t('fieldParts.area')}</Column>
            <Column>{t('fieldParts.crop')}</Column>
          </TableHeader>
          <TableBody items={list}>
            {(p) => (
              <Row id={p.id}>
                <Cell>
                  <div className="font-medium">{p.name}</div>
                  {p.notes && <div className="text-xs text-muted">{p.notes}</div>}
                </Cell>
                <Cell><PartUsageBadge usage={p.usage} /></Cell>
                <Cell align="end">
                  <div className="tabular">{fmt.ha(p.areaHa, 2)}</div>
                  <div className="text-xs text-muted tabular">{fmt.pct((p.areaHa / field.areaHa) * 100, 1)}</div>
                </Cell>
                <Cell>{p.crops.length ? p.crops.map((c) => <CropTag key={c.cropCycleId} name={c.cropName} color={c.color} />) : <span className="text-muted">—</span>}</Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>
      {editing && <SplitFieldDialog field={field} seasonId={season.id} seasonName={season.name} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

interface EditorPart {
  key: string
  id?: string
  name: string
  usage: FieldPartUsage
  notes: string
  /** Null for the remainder: the rest of the field. */
  geometry: PartGeometry | null
}

function SplitFieldDialog({ field, seasonId, seasonName, initial, onClose }: { field: Field; seasonId: string; seasonName: string; initial: FieldPart[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [parts, setParts] = useState<EditorPart[]>(() => {
    const rows: EditorPart[] = initial.map((p) => ({
      key: crypto.randomUUID(),
      id: p.id || undefined,
      name: p.name,
      usage: p.usage,
      notes: p.notes ?? '',
      geometry: p.isRemainder ? null : p.geometry,
    }))
    // The remainder goes last: it takes what the drawn parts leave.
    rows.sort((a, b) => Number(a.geometry === null) - Number(b.geometry === null))
    if (!rows.some((r) => r.geometry === null)) rows.push({ key: crypto.randomUUID(), name: t('fieldParts.defaultMain'), usage: 'cropped', notes: '', geometry: null })
    return rows
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [preview, setPreview] = useState<FieldSplitPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const hadParts = initial.some((p) => p.id)

  const payload = () => ({
    seasonId,
    parts: parts.map((p) => ({ id: p.id, name: p.name.trim(), usage: p.usage, notes: p.notes.trim() || null, geometry: p.geometry })),
  })
  const incomplete = parts.some((p) => !p.name.trim())

  // Server-side clipping preview, debounced while drawing.
  const seq = useRef(0)
  useEffect(() => {
    if (incomplete) return
    const n = ++seq.current
    const timer = setTimeout(() => {
      api
        .post<FieldSplitPreview>(`/orgs/${orgId}/fields/${field.id}/parts/preview`, payload())
        .then((r) => {
          if (n !== seq.current) return
          setPreview(r)
          setPreviewError(null)
        })
        .catch((e) => {
          if (n !== seq.current) return
          setPreview(null)
          setPreviewError(errorMessage(e))
        })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, orgId, field.id, seasonId])

  const previewCollection = useMemo<FeatureCollection | null>(
    () =>
      preview && {
        type: 'FeatureCollection',
        features: preview.parts.map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { color: FIELD_PART_USAGE_COLORS[p.usage] } })),
      },
    [preview],
  )
  const areaOf = (index: number) => preview?.parts.find((p) => p.index === index)?.areaHa

  const save = useOrgMutation((base, body: ReturnType<typeof payload>) => api.put<FieldPart[]>(`${base}/fields/${field.id}/parts`, body), {
    success: (r) => (r.length ? t('fieldParts.saved', { count: r.length }) : t('fieldParts.removed')),
    onSuccess: onClose,
  })

  const update = (key: string, patch: Partial<EditorPart>) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const create = (geometry: Polygon) => {
    const key = crypto.randomUUID()
    setParts((ps) => {
      const n = ps.length + 1
      const drawn = ps.filter((p) => p.geometry !== null)
      const rest = ps.filter((p) => p.geometry === null)
      return [...drawn, { key, name: t('fieldParts.defaultName', { n }), usage: 'other', notes: '', geometry }, ...rest]
    })
    setDrawing(false)
    setSelected(key)
    return key
  }
  const hasRemainder = parts.some((p) => p.geometry === null)
  const usageItems = FIELD_PART_USAGES.map((u) => ({ id: u, name: t(`fieldParts.usage.${u}`) }))

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldParts.dialogTitle', { field: field.name, season: seasonName })} description={t('fieldParts.dialogDescription')} size="xl">
      <div className="grid lg:grid-cols-[1fr_22rem] gap-4">
        <div className="relative">
          <DrawParts
            boundary={field.geometry}
            parts={parts}
            preview={previewCollection}
            selectedKey={selected}
            drawing={drawing}
            onSelect={setSelected}
            onGeometry={(key, geometry) => update(key, { geometry: geometry })}
            onCreate={create}
            className="h-[60vh] min-h-80"
          />
          <div className="absolute top-3 left-3 z-10 flex gap-1 rounded-[var(--radius-control)] bg-surface/95 p-1 shadow-[var(--shadow-overlay)] border border-line">
            <Button size="sm" variant={drawing ? 'primary' : 'ghost'} onPress={() => setDrawing((d) => !d)}>
              <PenLine /> {drawing ? t('fieldParts.drawing') : t('fieldParts.drawPart')}
            </Button>
          </div>
          {drawing && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 rounded-full bg-surface/95 border border-line shadow-[var(--shadow-overlay)] px-4 py-1.5 text-sm">
              {t('fieldParts.drawHint')}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 min-h-0">
          <ul className="space-y-2 overflow-y-auto max-h-[52vh] pr-1">
            {parts.map((p) => {
              const index = parts.indexOf(p)
              const area = areaOf(index)
              return (
                <li
                  key={p.key}
                  className={cx('rounded-lg border p-3 space-y-2', selected === p.key ? 'border-primary bg-primary-soft/40' : 'border-line')}
                  onClick={() => p.geometry && setSelected(p.key)}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full shrink-0" style={{ background: FIELD_PART_USAGE_COLORS[p.usage] }} aria-hidden />
                    <TextField aria-label={t('common.name')} value={p.name} onChange={(name) => update(p.key, { name })} className="flex-1" />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('fieldParts.removePart', { name: p.name })}
                      onPress={() => {
                        setParts((ps) => ps.filter((x) => x.key !== p.key))
                        if (selected === p.key) setSelected(null)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Select aria-label={t('fieldParts.usageLabel')} items={usageItems} value={p.usage} onChange={(v) => v && update(p.key, { usage: v as FieldPartUsage })}>
                    {(u) => <Option id={u.id}>{u.name}</Option>}
                  </Select>
                  <div className="flex justify-between text-xs text-muted">
                    <span>{p.geometry ? (p.id ? t('fieldParts.drawn') : t('fieldParts.new')) : t('fieldParts.remainder')}</span>
                    <span className="tabular">{area != null ? `${fmt.ha(area, 2)} · ${fmt.pct((area / field.areaHa) * 100, 1)}` : '—'}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {!hasRemainder && (
            <Button size="sm" variant="secondary" onPress={() => setParts((ps) => [...ps, { key: crypto.randomUUID(), name: t('fieldParts.defaultMain'), usage: 'cropped', notes: '', geometry: null }])}>
              <Plus /> {t('fieldParts.addRemainder')}
            </Button>
          )}
          {previewError && <Notice tone="danger">{previewError}</Notice>}
          {preview && !previewError && (
            <p className="text-xs text-muted">{t('fieldParts.previewSummary', { count: preview.parts.length, area: fmt.ha(preview.fieldAreaHa, 2) })}</p>
          )}
          <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
            {hadParts && (
              <ConfirmButton
                title={t('fieldParts.undivideTitle')}
                message={t('fieldParts.undivideMessage')}
                confirmLabel={t('fieldParts.undivide')}
                onConfirm={() => save.mutateAsync({ seasonId, parts: [] })}
                trigger={<Button variant="ghost" className="text-danger">{t('fieldParts.undivide')}</Button>}
              />
            )}
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" isPending={save.isPending} isDisabled={incomplete || !!previewError || parts.length < 2} onPress={() => save.mutate(payload())}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  )
}
