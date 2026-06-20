export type AuthUser = {
  sub: string
  email?: string
  name?: string
  preferred_username?: string
}

export type AuthConfig = {
  enabled: boolean
  login_url?: string
}

export type MeResponse = {
  authenticated: boolean
  user: AuthUser | null
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function fetchAuthConfig() {
  return apiFetch<AuthConfig>('/api/auth/config')
}

export function fetchMe() {
  return fetch('/api/auth/me', { credentials: 'include' }).then(async (response) => {
    if (response.status === 401) {
      return { authenticated: false, user: null } satisfies MeResponse
    }
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    return response.json() as Promise<MeResponse>
  })
}

export function logout() {
  return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function login(loginUrl: string) {
  window.location.href = loginUrl
}
