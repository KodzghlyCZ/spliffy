import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChatConfig } from '../lib/chat'

export type NameForm = 'default' | 'message'

type NameFormsByLocale = Record<string, Partial<Record<NameForm, string>>>

type AppNameContextValue = {
  name: string
  getName: (form?: NameForm) => string
  initial: string
  loading: boolean
}

const AppNameContext = createContext<AppNameContextValue | null>(null)

function nameInitial(name: string, fallback = 'S') {
  return name.trim().charAt(0).toUpperCase() || fallback
}

function resolveName(
  baseName: string,
  forms: NameFormsByLocale,
  locale: string,
  form: NameForm,
): string {
  const normalizedLocale = locale.toLowerCase().startsWith('cs') ? 'cs' : 'en'
  for (const key of [normalizedLocale, 'en', 'cs']) {
    const localeForms = forms[key]
    if (!localeForms) {
      continue
    }
    const value = localeForms[form] ?? localeForms.default
    if (value?.trim()) {
      return value.trim()
    }
  }
  return baseName.trim() || 'Spliffy'
}

export function AppNameProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const [baseName, setBaseName] = useState('Spliffy')
  const [forms, setForms] = useState<NameFormsByLocale>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchChatConfig()
      .then((config) => {
        if (config.name.trim()) {
          setBaseName(config.name.trim())
        }
        if (config.names) {
          setForms(config.names)
        }
      })
      .catch(() => {
        // Keep fallback branding when config is unavailable.
      })
      .finally(() => setLoading(false))
  }, [])

  const getName = useCallback(
    (form: NameForm = 'default') => resolveName(baseName, forms, i18n.language, form),
    [baseName, forms, i18n.language],
  )

  const name = useMemo(() => getName('default'), [getName])
  const initial = useMemo(() => nameInitial(name), [name])

  useEffect(() => {
    document.title = name
  }, [name])

  const value = useMemo(
    () => ({
      name,
      getName,
      initial,
      loading,
    }),
    [name, getName, initial, loading],
  )

  return <AppNameContext.Provider value={value}>{children}</AppNameContext.Provider>
}

export function useAppName() {
  const context = useContext(AppNameContext)
  if (!context) {
    throw new Error('useAppName must be used within AppNameProvider')
  }
  return context
}
