import type { Farm, LatLng, Organization } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { Building2, Check, MapPin } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Form } from 'react-aria-components'
import { Logo } from '#/components/Logo'
import { LOCALE } from '#/i18n'
import { LocationPicker } from '#/components/map/LocationPicker'
import { api, errorMessage, tokenStore } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/onboarding')({ component: Onboarding })

const COUNTRY_CODES = ['DE', 'AT', 'CH', 'NL', 'PL', 'FR', 'DK']
const countryNames = new Intl.DisplayNames([LOCALE], { type: 'region' })

function Onboarding() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [org, setOrg] = useState<Organization | null>(null)
  const [orgName, setOrgName] = useState('')
  const [country, setCountry] = useState('DE')
  const [farmName, setFarmName] = useState('')
  const [address, setAddress] = useState('')
  const [location, setLocation] = useState<LatLng | null>(null)
  const [mapZoom, setMapZoom] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!tokenStore.get()) return <Navigate to="/login" />

  const createOrg = async () => {
    setPending(true)
    setError(null)
    try {
      const created = await api.post<Organization>('/orgs', { name: orgName, country, currency: country === 'CH' ? 'CHF' : country === 'PL' ? 'PLN' : country === 'DK' ? 'DKK' : 'EUR' })
      setOrg(created)
      setFarmName(orgName.replace(/\s+(GbR|KG|GmbH|e\.K\.|AG)$/i, ''))
      await qc.invalidateQueries({ queryKey: ['me'] })
      setStep(2)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const createFarm = async () => {
    if (!org) return
    setPending(true)
    setError(null)
    try {
      await api.post<Farm>(`/orgs/${org.id}/farms`, { name: farmName, address: address || null, country, location, mapZoom })
      await qc.invalidateQueries({ queryKey: ['me'] })
      await navigate({ to: '/o/$orgId/fields/new', params: { orgId: org.id }, search: { onboarding: true } })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
        <Logo />
        <div className="flex items-center gap-3 text-sm text-muted">
          {user?.email}
          <Button size="sm" variant="ghost" onPress={signOut}>{t('nav.signOut')}</Button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 pb-16">
        <ol className="flex items-center gap-3 mb-8 text-sm" aria-label={t('onboarding.steps')}>
          {[t('onboarding.step.organization'), t('onboarding.step.farm'), t('onboarding.step.fields'), t('onboarding.step.crops')].map((label, i) => {
            const n = i + 1
            const done = n < step
            const current = n === step
            return (
              <li key={label} className="flex items-center gap-3">
                <span className={cx('size-7 rounded-full flex items-center justify-center text-xs font-semibold border', done ? 'bg-primary border-primary text-primary-fg' : current ? 'border-primary text-primary bg-primary-soft' : 'border-line-strong text-muted')}>
                  {done ? <Check className="size-4" /> : n}
                </span>
                <span className={cx(current ? 'text-fg font-medium' : 'text-muted')} aria-current={current ? 'step' : undefined}>{label}</span>
                {n < 4 && <span className="w-8 h-px bg-line-strong" aria-hidden />}
              </li>
            )
          })}
        </ol>

        {step === 1 && (
          <Form className="max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xs space-y-5" onSubmit={(e) => { e.preventDefault(); void createOrg() }}>
            <div className="flex gap-3 items-start">
              <span className="size-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center"><Building2 className="size-5" /></span>
              <div>
                <h1 className="text-xl font-semibold">{t('onboarding.org.title')}</h1>
                <p className="text-sm text-muted mt-0.5">{t('onboarding.org.description')}</p>
              </div>
            </div>
            <TextField label={t('onboarding.org.name')} isRequired autoFocus value={orgName} onChange={setOrgName} placeholder={t('onboarding.org.namePlaceholder')} />
            <Select label={t('onboarding.org.country')} items={COUNTRY_CODES.map((id) => ({ id, name: countryNames.of(id) ?? id }))} value={country} onChange={(v) => v && setCountry(String(v))}>
              {(c) => <Option id={c.id}>{c.name}</Option>}
            </Select>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" isPending={pending}>{t('login.continue')}</Button>
            </div>
          </Form>
        )}

        {step === 2 && (
          <Form className="rounded-2xl border border-line bg-surface p-6 shadow-xs grid lg:grid-cols-[1fr_1.3fr] gap-6" onSubmit={(e) => { e.preventDefault(); void createFarm() }}>
            <div className="space-y-5">
              <div className="flex gap-3 items-start">
                <span className="size-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center"><MapPin className="size-5" /></span>
                <div>
                  <h1 className="text-xl font-semibold">{t('onboarding.farm.title')}</h1>
                  <p className="text-sm text-muted mt-0.5">{t('onboarding.farm.description')}</p>
                </div>
              </div>
              <TextField label={t('onboarding.farm.name')} isRequired autoFocus value={farmName} onChange={setFarmName} />
              <TextField label={t('onboarding.farm.address')} value={address} onChange={setAddress} placeholder={t('onboarding.farm.addressPlaceholder')} />
              <div className="text-sm">
                <div className="font-medium text-fg-2">{t('onboarding.farm.location')}</div>
                <div className="text-muted mt-1 tabular">{location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : t('onboarding.farm.locationHint')}</div>
              </div>
              {error && <Notice tone="danger">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="submit" variant="primary" isPending={pending}>{t('onboarding.farm.continue')}</Button>
              </div>
            </div>
            <LocationPicker value={location} zoom={mapZoom} onChange={setLocation} onZoomChange={setMapZoom} className="h-96 lg:h-auto min-h-80" />
          </Form>
        )}
      </main>
    </div>
  )
}
