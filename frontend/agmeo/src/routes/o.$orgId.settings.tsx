import { MEASUREMENT_SETTINGS, type Farm, type MeasurementSetting, type Organization, type Season } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowRight, FileCheck2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { AddressField, useFarmPlace } from '#/components/map/AddressField'
import { LocationPicker } from '#/components/map/LocationPicker'
import { LOCALE, t } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { DatePicker, Option, Select, TextField } from '#/ui/Field'
import { Badge, Card, PageHeader } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

export const Route = createFileRoute('/o/$orgId/settings')({ component: Settings })

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: new Date(2026, i, 1).toLocaleDateString(LOCALE, { month: 'long' }) }))
const CURRENCIES = ['EUR', 'CHF', 'PLN', 'DKK', 'CZK', 'GBP'].map((c) => ({ id: c, name: c }))

function Settings() {
  const { org, can } = useOrg()
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={org.name} />
      <div className="grid xl:grid-cols-2 gap-6 items-start">
        <OrganizationCard org={org} editable={can('org.manage')} />
        <SeasonsCard />
        <div className="xl:col-span-2">
          <FarmsCard />
        </div>
        {org.country === 'DE' && (
          <div className="xl:col-span-2">
            <FertilizerReportsLinkCard />
          </div>
        )}
      </div>
    </>
  )
}

/** The German fertilizer reports are built in the compliance area; this card points there. */
function FertilizerReportsLinkCard() {
  const { orgId } = useOrg()
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <FileCheck2 className="size-4 text-muted" aria-hidden /> {t('fertilizerReports.linkCard.title')}
        </span>
      }
      description={t('fertilizerReports.linkCard.body')}
    >
      <Link to="/o/$orgId/compliance" params={{ orgId }} search={{ tab: 'reports' }} variant="secondary">
        {t('fertilizerReports.linkCard.cta')} <ArrowRight />
      </Link>
    </Card>
  )
}

function OrganizationCard({ org, editable }: { org: Organization; editable: boolean }) {
  const qc = useQueryClient()
  const [name, setName] = useState(org.name)
  const [currency, setCurrency] = useState(org.currency)
  const [month, setMonth] = useState(org.cropYearStartMonth)
  const [measurement, setMeasurement] = useState<MeasurementSetting>(org.measurementSetting)
  const save = useOrgMutation((base, _: void) => api.patch<Organization>(base, { name, currency, cropYearStartMonth: month, measurementSetting: measurement }), {
    success: t('settings.org.updated'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  return (
    <Card title={t('settings.org.title')} description={t('settings.org.description')}>
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="grid sm:grid-cols-2 gap-4">
        <TextField label={t('common.name')} isRequired isDisabled={!editable} value={name} onChange={setName} className="sm:col-span-2" />
        <Select label={t('settings.org.currency')} isDisabled={!editable} items={CURRENCIES} value={currency} onChange={(v) => v && setCurrency(String(v))}>
          {(c) => <Option id={c.id}>{c.name}</Option>}
        </Select>
        <Select label={t('settings.org.cropYearStart')} isDisabled={!editable} items={MONTHS} value={month} onChange={(v) => v && setMonth(Number(v))} description={t('settings.org.cropYearStartHint')}>
          {(m) => <Option id={m.id}>{m.name}</Option>}
        </Select>
        <Select
          label={t('settings.org.units')}
          isDisabled={!editable}
          items={MEASUREMENT_SETTINGS.map((id) => ({ id, name: t(`settings.org.units.${id}`) }))}
          value={measurement}
          onChange={(v) => v && setMeasurement(v as MeasurementSetting)}
          description={t('settings.org.unitsHint')}
        >
          {(m) => <Option id={m.id}>{m.name}</Option>}
        </Select>
        {editable && (
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
          </div>
        )}
      </Form>
    </Card>
  )
}

function SeasonsCard() {
  const { can } = useOrg()
  const seasons = useOrgQuery<Season[]>('/seasons')
  const [edit, setEdit] = useState<Season | null>(null)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/seasons/${id}`), { success: t('settings.seasons.deleted') })
  return (
    <Card title={t('settings.seasons.title')} description={t('settings.seasons.description')} padded={false}>
      <Table aria-label={t('settings.seasons.title')}>
        <TableHeader>
          <Column isRowHeader>{t('settings.seasons.season')}</Column>
          <Column>{t('settings.seasons.period')}</Column>
          <Column align="end">{t('settings.seasons.crops')}</Column>
          <Column aria-label={t('common.actions')}> </Column>
        </TableHeader>
        <TableBody items={seasons.data ?? []} renderEmptyState={() => <div className="py-8 text-center text-sm text-muted">{t('settings.seasons.empty')}</div>}>
          {(s) => (
            <Row id={s.id}>
              <Cell className="font-medium">{s.name}</Cell>
              <Cell className="tabular">{fmt.date(s.startDate)} – {fmt.date(s.endDate)}</Cell>
              <Cell align="end">{s.cropCycleCount}</Cell>
              <Cell>
                {can('crop.write') && (
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('settings.editNamed', { name: s.name })} onPress={() => setEdit(s)}><Pencil /></Button>
                    {s.cropCycleCount === 0 && (
                      <ConfirmButton title={t('settings.deleteNamed', { name: s.name })} message={t('settings.seasons.deleteMessage')} confirmLabel={t('common.delete')} onConfirm={() => remove.mutateAsync(s.id)} trigger={<Button size="icon-sm" variant="ghost" aria-label={t('settings.deleteNamedLabel', { name: s.name })}><Trash2 /></Button>} />
                    )}
                  </div>
                )}
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      {edit && <SeasonEditDialog season={edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function SeasonEditDialog({ season, onClose }: { season: Season; onClose: () => void }) {
  const [name, setName] = useState(season.name)
  const [start, setStart] = useState<string | null>(season.startDate)
  const [end, setEnd] = useState<string | null>(season.endDate)
  const save = useOrgMutation((base, _: void) => api.put(`${base}/seasons/${season.id}`, { name, harvestYear: season.harvestYear, startDate: start, endDate: end }), { success: t('settings.seasons.updated'), onSuccess: onClose })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('settings.editNamed', { name: season.name })} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <TextField label={t('common.name')} isRequired value={name} onChange={setName} />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label={t('settings.seasons.starts')} value={start} onChange={setStart} isRequired />
          <DatePicker label={t('settings.seasons.ends')} value={end} onChange={setEnd} isRequired />
        </div>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function FarmsCard() {
  const { can } = useOrg()
  const farms = useOrgQuery<Farm[]>('/farms', { includeArchived: true })
  const [edit, setEdit] = useState<Farm | 'new' | null>(null)
  const archive = useOrgMutation((base, f: Farm) => api.post<Farm>(`${base}/farms/${f.id}/${f.archivedAt ? 'restore' : 'archive'}`), { success: (f) => (f.archivedAt ? t('settings.farms.archived') : t('settings.farms.restored')) })
  return (
    <Card title={t('settings.farms.title')} description={t('settings.farms.description')} padded={false} actions={can('farm.write') && <Button size="sm" onPress={() => setEdit('new')}><Plus /> {t('settings.farms.add')}</Button>}>
      <Table aria-label={t('settings.farms.title')}>
        <TableHeader>
          <Column isRowHeader>{t('settings.farms.farm')}</Column>
          <Column>{t('onboarding.farm.address')}</Column>
          <Column>{t('onboarding.farm.location')}</Column>
          <Column align="end">{t('settings.farms.fields')}</Column>
          <Column align="end">{t('settings.farms.area')}</Column>
          <Column aria-label={t('common.actions')}> </Column>
        </TableHeader>
        <TableBody items={farms.data ?? []}>
          {(f) => (
            <Row id={f.id}>
              <Cell>
                <span className="font-medium">{f.name}</span> {f.archivedAt && <Badge className="ml-1">{t('settings.farms.archivedBadge')}</Badge>}
              </Cell>
              <Cell className="text-fg-2">{f.address ?? '—'}</Cell>
              <Cell className="tabular text-fg-2">{f.location ? `${f.location.lat.toFixed(4)}, ${f.location.lng.toFixed(4)}` : <span className="text-warning">{t('settings.farms.notSet')}</span>}</Cell>
              <Cell align="end">{f.fieldCount}</Cell>
              <Cell align="end">{fmt.ha(f.totalAreaHa, 1)}</Cell>
              <Cell>
                {can('farm.write') && (
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('settings.editNamed', { name: f.name })} onPress={() => setEdit(f)}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={f.archivedAt ? t('settings.farms.restoreNamed', { name: f.name }) : t('settings.farms.archiveNamed', { name: f.name })} onPress={() => archive.mutate(f)}>
                      {f.archivedAt ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  </div>
                )}
              </Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      {edit && <FarmDialog farm={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function FarmDialog({ farm, onClose }: { farm: Farm | null; onClose: () => void }) {
  const { org } = useOrg()
  const [name, setName] = useState(farm?.name ?? '')
  const place = useFarmPlace(org.id, { address: farm?.address ?? null, location: farm?.location ?? null })
  const { address, location } = place
  const [mapZoom, setMapZoom] = useState<number | null>(farm?.mapZoom ?? (farm?.location ? 13 : null))
  const [notes, setNotes] = useState(farm?.notes ?? '')
  const body = { name, address: address || null, country: farm?.country ?? org.country, timezone: farm?.timezone ?? 'Europe/Berlin', location, mapZoom, notes: notes || null }
  const save = useOrgMutation((base, _: void) => (farm ? api.put<Farm>(`${base}/farms/${farm.id}`, body) : api.post<Farm>(`${base}/farms`, body)), {
    success: farm ? t('settings.farms.updated') : t('settings.farms.added'),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={farm ? t('settings.editNamed', { name: farm.name }) : t('settings.farms.add')} size="lg">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="grid md:grid-cols-[1fr_1.2fr] gap-5">
        <div className="space-y-4">
          <TextField label={t('onboarding.farm.name')} isRequired value={name} onChange={setName} />
          <AddressField
            orgId={org.id}
            label={t('onboarding.farm.address')}
            placeholder={t('onboarding.farm.addressPlaceholder')}
            value={address}
            onChange={place.setAddress}
            onSelect={place.select}
            country={farm?.country ?? org.country}
            near={location}
          />
          <div className="text-sm">
            <div className="font-medium text-fg-2 flex items-center gap-1.5"><MapPin className="size-4" /> {t('onboarding.farm.location')}</div>
            <div className="text-muted tabular mt-1">
              {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${mapZoom != null ? ` · ${t('settings.farms.zoom', { zoom: fmt.fixed(mapZoom, 1) })}` : ''}` : t('settings.farms.clickMap')}
            </div>
            {location && <div className="text-muted text-xs mt-1">{t('settings.farms.zoomHint')}</div>}
          </div>
          <TextField label={t('common.notes')} multiline value={notes} onChange={setNotes} />
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
          </div>
        </div>
        <LocationPicker value={location} zoom={mapZoom} onChange={place.pick} onZoomChange={setMapZoom} className="h-80" />
      </Form>
    </ModalDialog>
  )
}
