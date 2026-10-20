import { ANNOTATION_COLORS, type AnnotationGeometry, type AnnotationInput, type AnnotationKind, type SatelliteAnnotation } from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { MapPin, Pencil, Pentagon, Square } from 'lucide-react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawFreehandLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { api } from '#/lib/api'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { TextField } from '#/ui/Field'
import { ModalDialog, Tooltip } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

const TOOLS: { kind: AnnotationKind; mode: string; icon: typeof MapPin }[] = [
  { kind: 'marker', mode: 'point', icon: MapPin },
  { kind: 'freehand', mode: 'freehand-linestring', icon: Pencil },
  { kind: 'polygon', mode: 'polygon', icon: Pentagon },
  { kind: 'rectangle', mode: 'rectangle', icon: Square },
]

interface Pending {
  kind: AnnotationKind
  geometry: AnnotationGeometry
}

/**
 * Notes drawn on one satellite scene: the map data, the drawing toolbar (shown on the map) and the
 * note dialogs. Drawing runs through terra-draw only while a tool is chosen.
 */
export function useSceneAnnotations({
  fieldId,
  date,
  layer,
  map,
  canEdit,
}: {
  fieldId: string
  date: string | null
  layer: string
  map: MapLibreMap | null
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const base = `/fields/${fieldId}/annotations`
  const list = useOrgQuery<SatelliteAnnotation[]>(base, date ? { date } : undefined, { enabled: !!date })
  const notes = date ? (list.data ?? []) : []
  const [tool, setTool] = useState<AnnotationKind | null>(null)
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const [pending, setPending] = useState<Pending | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = notes.find((n) => n.id === editingId) ?? null

  const create = useOrgMutation((org, input: AnnotationInput) => api.post<SatelliteAnnotation>(`${org}${base}`, input), { success: t('annotations.saved') })
  const update = useOrgMutation((org, v: { id: string; note: string }) => api.patch<SatelliteAnnotation>(`${org}${base}/${v.id}`, { note: v.note || null }), {
    success: t('annotations.saved'),
  })
  const remove = useOrgMutation((org, id: string) => api.delete(`${org}${base}/${id}`), { success: t('annotations.deleted') })

  // A tool stays chosen for one shape; a new date ends drawing.
  useEffect(() => setTool(null), [date])

  const onPending = useRef((p: Pending) => setPending(p))
  useEffect(() => {
    if (!map || !tool) return
    const style = { fillColor: color as `#${string}`, outlineColor: color as `#${string}` }
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode({ styles: { pointColor: color as `#${string}`, pointWidth: 7, pointOutlineColor: '#ffffff', pointOutlineWidth: 2 } }),
        new TerraDrawFreehandLineStringMode({ styles: { lineStringColor: color as `#${string}`, lineStringWidth: 3 } }),
        new TerraDrawPolygonMode({ styles: { ...style, fillOpacity: 0.2, outlineWidth: 2, closingPointColor: '#ffffff', closingPointOutlineColor: color as `#${string}` } }),
        new TerraDrawRectangleMode({ styles: { ...style, fillOpacity: 0.2, outlineWidth: 2 } }),
      ],
    })
    draw.start()
    draw.setMode(TOOLS.find((x) => x.kind === tool)!.mode)
    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id)
      if (!feature) return
      onPending.current({ kind: tool, geometry: feature.geometry as AnnotationGeometry })
      setTool(null)
    })
    return () => {
      try {
        draw.stop()
      } catch {
        // Map already torn down.
      }
    }
  }, [map, tool, color])

  const collection = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        ...notes.map((n) => ({ type: 'Feature' as const, geometry: n.geometry, properties: { id: n.id, color: n.color, ...(n.note ? { note: n.note } : {}) } })),
        ...(pending ? [{ type: 'Feature' as const, geometry: pending.geometry, properties: { id: '', color } }] : []),
      ],
    }),
    [notes, pending, color],
  )

  const toolbar: ReactNode =
    canEdit && date ? (
      <div className="absolute top-13 left-2 z-10 flex flex-col gap-1.5 rounded-lg bg-surface/95 p-1.5 shadow-md border border-line">
        <div className="flex gap-0.5" role="toolbar" aria-label={t('annotations.toolbar')}>
          {TOOLS.map(({ kind, icon: Icon }) => (
            <Tooltip key={kind} content={t(`annotations.tool.${kind}`)}>
              <Button
                variant={tool === kind ? 'primary' : 'ghost'}
                size="icon-sm"
                aria-label={t(`annotations.tool.${kind}`)}
                aria-pressed={tool === kind}
                onPress={() => setTool(tool === kind ? null : kind)}
              >
                <Icon />
              </Button>
            </Tooltip>
          ))}
        </div>
        <div className="flex gap-1 px-0.5" role="radiogroup" aria-label={t('annotations.color')}>
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cx('size-5 rounded-full border-2 transition-transform', color === c ? 'scale-110 border-fg' : 'border-line')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        {tool && <p className="max-w-40 px-0.5 text-[11px] leading-tight text-muted">{t(`annotations.hint.${tool}`)}</p>}
      </div>
    ) : null

  const save = (note: string) => {
    if (!pending || !date) return
    create.mutate(
      { date, layer: layer as AnnotationInput['layer'], kind: pending.kind, color: color as AnnotationInput['color'], note: note || null, geometry: pending.geometry },
      { onSuccess: () => setPending(null) },
    )
  }

  const dialogs = (
    <>
      <NoteDialog
        isOpen={!!pending}
        title={t('annotations.newTitle')}
        initial=""
        onClose={() => setPending(null)}
        onSave={save}
        isPending={create.isPending}
        secondary={
          <Button variant="ghost" onPress={() => setPending(null)}>
            {t('annotations.discard')}
          </Button>
        }
      />
      <NoteDialog
        isOpen={!!editing}
        title={editing ? t(`annotations.tool.${editing.kind}`) : ''}
        initial={editing?.note ?? ''}
        readOnly={!canEdit}
        onClose={() => setEditingId(null)}
        onSave={(note) => editing && update.mutate({ id: editing.id, note }, { onSuccess: () => setEditingId(null) })}
        isPending={update.isPending}
        secondary={
          canEdit && editing ? (
            <Button variant="danger" onPress={() => remove.mutate(editing.id, { onSuccess: () => setEditingId(null) })} isPending={remove.isPending}>
              {t('annotations.delete')}
            </Button>
          ) : null
        }
      />
    </>
  )

  return { collection, toolbar, dialogs, notes, onClick: (id: string) => !tool && setEditingId(id), edit: setEditingId }
}

function NoteDialog({
  isOpen,
  title,
  initial,
  readOnly,
  onClose,
  onSave,
  isPending,
  secondary,
}: {
  isOpen: boolean
  title: string
  initial: string
  readOnly?: boolean
  onClose: () => void
  onSave: (note: string) => void
  isPending: boolean
  secondary: ReactNode
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState(initial)
  useEffect(() => setNote(initial), [initial, isOpen])
  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      size="sm"
      footer={() => (
        <>
          {secondary}
          {!readOnly && (
            <Button variant="primary" onPress={() => onSave(note.trim())} isPending={isPending}>
              {t('annotations.save')}
            </Button>
          )}
        </>
      )}
    >
      <TextField label={t('annotations.note')} placeholder={t('annotations.notePlaceholder')} value={note} onChange={setNote} isReadOnly={readOnly} maxLength={500} autoFocus multiline rows={2} />
    </ModalDialog>
  )
}
