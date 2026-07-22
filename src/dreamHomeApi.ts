declare global {
  interface Window {
    __DREAMHOME_API_BASE_URL__?: string
  }
}

const configuredBase = (
  window.__DREAMHOME_API_BASE_URL__
  || import.meta.env.VITE_DREAMHOME_API_BASE_URL
  || ''
).trim().replace(/\/$/, '')

export function dreamHomeApiUrl(path: string): string {
  return `${configuredBase}${path.startsWith('/') ? path : `/${path}`}`
}
