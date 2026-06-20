import { useAuth } from '../context/AuthContext'
import './AuthBar.css'

export function AuthBar() {
  const { loading, config, user, login, logout } = useAuth()

  if (loading) {
    return <div className="auth-bar">Loading…</div>
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
            Log out
          </button>
        </>
      ) : (
        <button type="button" onClick={login}>
          Log in
        </button>
      )}
    </div>
  )
}
