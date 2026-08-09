import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordFeedMediaEvent,
  recordFeedSwitchStart,
  startDreamHomePerformanceMonitoring,
} from './performanceMonitor'

describe('DreamHome performance monitoring', () => {
  beforeEach(() => {
    delete window.__DREAMHOME_PERF__
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records initial media readiness and feed switch latency', () => {
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const stop = startDreamHomePerformanceMonitoring()
    now = 145
    recordFeedMediaEvent('video-a', 'loadeddata')
    now = 180
    recordFeedMediaEvent('video-a', 'canplay')
    recordFeedSwitchStart('video-a', 'video-b')
    now = 236
    recordFeedMediaEvent('video-b', 'loadeddata')
    now = 284
    recordFeedMediaEvent('video-b', 'canplay')

    expect(window.__DREAMHOME_PERF__?.feed).toMatchObject({
      firstLoadedDataMs: 145,
      firstCanPlayMs: 180,
      lastLoadedVideoId: 'video-b',
      lastCanPlayVideoId: 'video-b',
      switches: [{
        fromVideoId: 'video-a',
        toVideoId: 'video-b',
        loadedDataMs: 56,
        canPlayMs: 104,
      }],
    })
    stop()
  })

  it('keeps only the latest twenty switches', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10)
    for (let index = 0; index < 24; index += 1) {
      recordFeedSwitchStart(`video-${index}`, `video-${index + 1}`)
    }

    const switches = window.__DREAMHOME_PERF__?.feed.switches ?? []
    expect(switches).toHaveLength(20)
    expect(switches[0].fromVideoId).toBe('video-4')
  })

  it('collects supported web vitals without sending them elsewhere', () => {
    const observers = new Map<string, MockPerformanceObserver>()
    class MockPerformanceObserver {
      static supportedEntryTypes = ['paint', 'largest-contentful-paint', 'layout-shift', 'event']
      private type = ''
      private readonly callback: PerformanceObserverCallback

      constructor(callback: PerformanceObserverCallback) {
        this.callback = callback
      }

      observe(options: PerformanceObserverInit) {
        this.type = options.type ?? ''
        observers.set(this.type, this)
      }

      disconnect() {}

      emit(entries: PerformanceEntry[]) {
        this.callback({ getEntries: () => entries } as PerformanceObserverEntryList, this as unknown as PerformanceObserver)
      }
    }
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)

    const stop = startDreamHomePerformanceMonitoring()
    observers.get('paint')?.emit([{ name: 'first-contentful-paint', startTime: 81 } as PerformanceEntry])
    observers.get('largest-contentful-paint')?.emit([{ startTime: 224 } as PerformanceEntry])
    observers.get('layout-shift')?.emit([
      { startTime: 100, value: 0.1, hadRecentInput: false } as unknown as PerformanceEntry,
      { startTime: 500, value: 0.05, hadRecentInput: false } as unknown as PerformanceEntry,
      { startTime: 2000, value: 0.2, hadRecentInput: false } as unknown as PerformanceEntry,
    ])
    observers.get('event')?.emit([
      { duration: 120, interactionId: 1 } as unknown as PerformanceEntry,
      { duration: 160, interactionId: 2 } as unknown as PerformanceEntry,
    ])

    expect(window.__DREAMHOME_PERF__).toMatchObject({
      fcpMs: 81,
      lcpMs: 224,
      cls: 0.2,
      inpMs: 160,
    })
    stop()
  })
})
