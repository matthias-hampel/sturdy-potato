import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de-DE.json'
import en from './en-US.json'

/**
 * UI language. German for now; English is kept complete so it can be offered later.
 * As in AGVOLUTION/agmeo: semantic keys (`nav.fields`, `common.save`), one catalogue per
 * locale with identical, alphabetically sorted keys, and `_one` forms next to the base key
 * (the plural) for every `{{count}}` string.
 */
export const LANGUAGE = 'de'
export const LOCALE = 'de-DE'

void i18n.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: 'en',
  resources: { de: { common: de }, en: { common: en } },
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
