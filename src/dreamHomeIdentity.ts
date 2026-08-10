declare global {
  interface Window {
    __DREAMHOME_USER_ID__?: string
  }
}

export const DREAMHOME_PROFILE_KEY = 'dreamhome.local-profile.v1'

export function dreamHomeUserId(): string {
  const configured = window.__DREAMHOME_USER_ID__?.trim()
  if (configured) return configured
  try {
    const stored = JSON.parse(window.localStorage.getItem(DREAMHOME_PROFILE_KEY) || '{}') as {
      userId?: unknown
    }
    if (typeof stored.userId === 'string' && stored.userId.trim()) return stored.userId
  } catch {
    // Replace an invalid local profile document below.
  }
  // This is an anonymous browser-local profile, not an authenticated account.
  // It prevents different judges/devices from sharing the backend's legacy
  // `demo` library while keeping one browser stable across page navigation.
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const userId = `local-profile-${suffix}`
  window.localStorage.setItem(DREAMHOME_PROFILE_KEY, JSON.stringify({ version: 1, userId }))
  return userId
}
