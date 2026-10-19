import { LOCALES, type Locale } from '@agmeo/contracts'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de-DE.json'
import en from './en-US.json'

/**
 * UI language. As in AGVOLUTION/agmeo: semantic keys (`nav.fields`, `common.save`), one
 * catalogue per locale with identical, alphabetically sorted keys, and `_one` forms next to
 * the base key (the plural) for every `{{count}}` string.
 *
 * The language is fixed for the lifetime of the page (formatters and month names are built
 * once): the user's saved choice, mirrored in localStorage so it applies before sign-in
 * completes, else the browser's language, else German. Switching reloads the page.
 */
const STORAGE_KEY = 'agmeo.locale'
const DEFAULT: Locale = 'de'
const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v)

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language]
}

function detect(): Locale {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  for (const tag of browserLanguages()) {
    const base = tag.slice(0, 2).toLowerCase()
    if (isLocale(base)) return base
  }
  return DEFAULT
}

export const LANGUAGE: Locale = detect()

/** BCP 47 tag for number and date formatting: the browser's regional variant of the UI language when it has one. */
/** Region used for formatting when the browser offers no regional variant of the UI language. */
const DEFAULT_REGION: Record<Locale, string> = {
  de: 'de-DE',
  en: 'en-GB',
  cs: 'cs-CZ',
  es: 'es-ES',
  et: 'et-EE',
  fr: 'fr-FR',
  lt: 'lt-LT',
  lv: 'lv-LV',
  pl: 'pl-PL',
  ro: 'ro-RO',
  uk: 'uk-UA',
}

export const LOCALE: string = browserLanguages().find((tag) => tag.toLowerCase().startsWith(`${LANGUAGE}-`)) ?? DEFAULT_REGION[LANGUAGE]

if (typeof document !== 'undefined') document.documentElement.lang = LANGUAGE

/** Switches the UI language; reloads the page when it changes. */
export function setLanguage(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Without storage the choice still applies through the user's profile after sign-in.
  }
  if (locale !== LANGUAGE) window.location.reload()
}

/** Applies the language saved in the user's profile (other device, first sign-in on this browser). */
export function applyUserLanguage(locale: Locale) {
  if (locale !== LANGUAGE) setLanguage(locale)
}

// German and English ship with the app; another language's catalogue (keyed like de-DE.json, with
// the plural forms its language needs) loads before the first render, missing keys fall back to English.
const catalogues = import.meta.glob<Record<string, string>>(['./*.json', '!./de-DE.json', '!./en-US.json'], { import: 'default' })
const extra = LANGUAGE !== 'de' && LANGUAGE !== 'en' ? await catalogues[`./${DEFAULT_REGION[LANGUAGE]}.json`]?.() : undefined

void i18n.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: LANGUAGE === 'de' ? 'de' : 'en',
  resources: { de: { common: de }, en: { common: en }, ...(extra ? { [LANGUAGE]: { common: extra } } : {}) },
  defaultNS: 'common',
  ns: ['common'],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
})

/** For code outside components (helpers, toasts in callbacks). */
export const t = i18n.t.bind(i18n)
export default i18n
