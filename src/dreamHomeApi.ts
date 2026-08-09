declare global {
  interface Window {
    __DREAMHOME_API_BASE_URL__?: string
  }
}

export function defaultDreamHomeApiBase(hostname: string): string {
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) {
    return 'http://127.0.0.1:8000'
  }
  return ['dreamhouse.top', 'www.dreamhouse.top'].includes(hostname)
    ? 'https://api.dreamhouse.top'
    : '/dreamhome-api'
}

const productionApiBase = defaultDreamHomeApiBase(window.location.hostname)

const configuredBase = (
  window.__DREAMHOME_API_BASE_URL__
  || import.meta.env.VITE_DREAMHOME_API_BASE_URL
  || productionApiBase
).trim().replace(/\/$/, '')

export function dreamHomeApiUrl(path: string): string {
  return `${configuredBase}${path.startsWith('/') ? path : `/${path}`}`
}
