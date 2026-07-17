import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import cs from './locales/cs.json'
import en from './locales/en.json'

export const LANGUAGES = ['en', 'cs'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'spliffy-lang'

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value)
}

function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isLanguage(stored)) {
    return stored
  }

  const browser = navigator.language.toLowerCase()
  if (browser.startsWith('cs')) {
    return 'cs'
  }

  return 'en'
}

function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    cs: { translation: cs },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

applyDocumentLanguage(i18n.language)

i18n.on('languageChanged', (language) => {
  localStorage.setItem(STORAGE_KEY, language)
  applyDocumentLanguage(language)
})

export default i18n
