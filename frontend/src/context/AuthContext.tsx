import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchAuthConfig,
  fetchMe,
  login,
  logout,
  type AuthConfig,
  type AuthUser,
} from '../lib/auth'

type AuthContextValue = {
  loading: boolean
  config: AuthConfig | null
  user: AuthUser | null
  login: () => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)

  const refresh = useCallback(async () => {
    const authConfig = await fetchAuthConfig()
    setConfig(authConfig)

    if (!authConfig.enabled) {
      setUser(null)
      return
    }

    try {
      const me = await fetchMe()
      setUser(me.authenticated ? me.user : null)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const handleLogin = useCallback(() => {
    if (config?.login_url) {
      login(config.login_url)
    }
  }, [config])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      loading,
      config,
      user,
      login: handleLogin,
      logout: handleLogout,
      refresh,
    }),
    [loading, config, user, handleLogin, handleLogout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
