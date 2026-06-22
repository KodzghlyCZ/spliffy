import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import './AuthBar.css'

export function AuthBar() {
  const { t } = useTranslation()
  const { loading, config, user, login, logout } = useAuth()

  if (loading) {
    return <div className="auth-bar">{t('auth.loading')}</div>
  }

  if (!config?.enabled) {
    return null
  }

  return (
    <div className="auth-bar">
      {user ? (
        <>
          <span className="auth-user">{user.name ?? user.email ?? user.sub}</span>
          <button type="button" onClick={() => void logout()}>
            {t('auth.logOut')}
          </button>
        </>
      ) : (
        <button type="button" onClick={login}>
          {t('auth.logIn')}
        </button>
      )}
    </div>
  )
}
