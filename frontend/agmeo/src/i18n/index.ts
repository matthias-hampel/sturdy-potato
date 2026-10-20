import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de-DE.json'

/**
 * UI language. agmeo is German-only (decision 2026-10-20: all other languages removed). As in
 * AGVOLUTION/agmeo the strings live in one catalogue with semantic keys (`nav.fields`,
 * `common.save`), alphabetically sorted, with a `_one` form next to the base key (the plural)
 * for every `{{count}}` string.
 */

/** BCP 47 tag for number and date formatting. */
export const LOCALE = 'de-DE'

void i18n.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: false,
  resources: { de: { common: de } },
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
