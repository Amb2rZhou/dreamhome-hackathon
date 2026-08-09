declare global {
  interface Window {
    __DREAMHOME_API_BASE_URL__?: string
  }
}

const productionApiBase = ['dreamhouse.top', 'www.dreamhouse.top'].includes(window.location.hostname)
  ? 'https://api.dreamhouse.top'
  : '/dreamhome-api'

const configuredBase = (
  window.__DREAMHOME_API_BASE_URL__
  || import.meta.env.VITE_DREAMHOME_API_BASE_URL
  || productionApiBase
).trim().replace(/\/$/, '')

export function dreamHomeApiUrl(path: string): string {
  return `${configuredBase}${path.startsWith('/') ? path : `/${path}`}`
}
