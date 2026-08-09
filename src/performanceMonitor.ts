export interface FeedPerformanceSwitch {
  fromVideoId: string
  toVideoId: string
  startedAtMs: number
  loadedDataMs?: number
  canPlayMs?: number
}

export interface DreamHomePerformance {
  schemaVersion: 1
  startedAtMs: number
  fcpMs?: number
  lcpMs?: number
  cls?: number
  inpMs?: number
  feed: {
    firstLoadedDataMs?: number
    firstCanPlayMs?: number
    lastLoadedVideoId?: string
    lastCanPlayVideoId?: string
    switches: FeedPerformanceSwitch[]
  }
}

declare global {
  interface Window {
    __DREAMHOME_PERF__?: DreamHomePerformance
  }
}

type LayoutShiftEntry = PerformanceEntry & {
  value: number
  hadRecentInput: boolean
}

type InteractionEntry = PerformanceEntry & {
  duration: number
  interactionId?: number
}

const MAX_RECORDED_SWITCHES = 20

function performanceStore(): DreamHomePerformance {
  const existing = window.__DREAMHOME_PERF__
  if (existing?.schemaVersion === 1 && existing.feed) return existing

  const created: DreamHomePerformance = {
    schemaVersion: 1,
    // Performance entry timestamps are relative to this document's navigation
    // start, so Feed readiness uses the same zero point as FCP/LCP.
    startedAtMs: 0,
    feed: { switches: [] },
  }
  window.__DREAMHOME_PERF__ = created
  return created
}

function observePerformance(
  type: string,
  onEntries: (entries: PerformanceEntry[]) => void,
  options: PerformanceObserverInit = { type, buffered: true },
) {
  if (typeof PerformanceObserver === 'undefined') return null
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null

  const observer = new PerformanceObserver((list) => onEntries(list.getEntries()))
  try {
    observer.observe(options)
    return observer
  } catch {
    observer.disconnect()
    return null
  }
}

export function startDreamHomePerformanceMonitoring() {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return () => {}
  const store = performanceStore()
  const observers: PerformanceObserver[] = []

  const paintObserver = observePerformance('paint', (entries) => {
    const fcp = entries.find((entry) => entry.name === 'first-contentful-paint')
    if (fcp) store.fcpMs = Math.round(fcp.startTime)
  })
  if (paintObserver) observers.push(paintObserver)

  const lcpObserver = observePerformance('largest-contentful-paint', (entries) => {
    const latest = entries.at(-1)
    if (latest) store.lcpMs = Math.round(latest.startTime)
  })
  if (lcpObserver) observers.push(lcpObserver)

  let maxLayoutShiftWindow = store.cls ?? 0
  let layoutShiftWindow = 0
  let layoutShiftWindowStartedAt = 0
  let lastLayoutShiftAt = 0
  const layoutShiftObserver = observePerformance('layout-shift', (entries) => {
    for (const entry of entries as LayoutShiftEntry[]) {
      if (entry.hadRecentInput) continue
      if (
        lastLayoutShiftAt > 0
        && entry.startTime - lastLayoutShiftAt < 1000
        && entry.startTime - layoutShiftWindowStartedAt < 5000
      ) {
        layoutShiftWindow += entry.value
      } else {
        layoutShiftWindow = entry.value
        layoutShiftWindowStartedAt = entry.startTime
      }
      lastLayoutShiftAt = entry.startTime
      maxLayoutShiftWindow = Math.max(maxLayoutShiftWindow, layoutShiftWindow)
    }
    store.cls = Number(maxLayoutShiftWindow.toFixed(4))
  })
  if (layoutShiftObserver) observers.push(layoutShiftObserver)

  const interactions = new Map<number, number>()
  const eventObserver = observePerformance('event', (entries) => {
    for (const entry of entries as InteractionEntry[]) {
      if (!entry.interactionId) continue
      interactions.set(
        entry.interactionId,
        Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
      )
    }
    const descending = [...interactions.values()].sort((left, right) => right - left)
    // INP ignores one additional worst interaction for each 50 interactions.
    // This is the same percentile rule used by field tooling, without sending
    // any samples outside the page.
    const percentileIndex = Math.min(Math.floor(descending.length / 50), descending.length - 1)
    if (percentileIndex >= 0) store.inpMs = Math.round(descending[percentileIndex])
  }, { type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit)
  if (eventObserver) observers.push(eventObserver)

  return () => observers.forEach((observer) => observer.disconnect())
}

export function recordFeedSwitchStart(fromVideoId: string, toVideoId: string) {
  if (typeof window === 'undefined') return
  const switches = performanceStore().feed.switches
  switches.push({ fromVideoId, toVideoId, startedAtMs: performance.now() })
  if (switches.length > MAX_RECORDED_SWITCHES) switches.splice(0, switches.length - MAX_RECORDED_SWITCHES)
}

export function recordFeedMediaEvent(videoId: string, event: 'loadeddata' | 'canplay') {
  if (typeof window === 'undefined') return
  const now = performance.now()
  const store = performanceStore()
  const elapsedFromStart = Math.round(now - store.startedAtMs)
  const pendingSwitch = [...store.feed.switches]
    .reverse()
    .find((entry) => entry.toVideoId === videoId && entry.canPlayMs === undefined)

  if (event === 'loadeddata') {
    store.feed.firstLoadedDataMs ??= elapsedFromStart
    store.feed.lastLoadedVideoId = videoId
    if (pendingSwitch && pendingSwitch.loadedDataMs === undefined) {
      pendingSwitch.loadedDataMs = Math.round(now - pendingSwitch.startedAtMs)
    }
    return
  }

  store.feed.firstCanPlayMs ??= elapsedFromStart
  store.feed.lastCanPlayVideoId = videoId
  if (pendingSwitch) pendingSwitch.canPlayMs = Math.round(now - pendingSwitch.startedAtMs)
}
