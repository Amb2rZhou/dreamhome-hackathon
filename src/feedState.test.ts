import { describe, expect, it } from 'vitest'
import { createFeedRuntimeState, feedRuntimeReducer, isFeedRuntimeConsistent } from './feedState'

describe('feedRuntimeReducer', () => {
  it('changes index, video, paused frame, phase, and overlay atomically', () => {
    const current = createFeedRuntimeState(0, 'video-a', 1.25)
    const next = feedRuntimeReducer(current, {
      type: 'NAVIGATE',
      index: 1,
      videoId: 'video-b',
      time: 4.5,
    })

    expect(next).toEqual({
      index: 1,
      videoId: 'video-b',
      pausedFrame: { videoId: 'video-b', time: 4.5 },
      phase: 'browse',
      overlay: 'none',
    })
    expect(isFeedRuntimeConsistent(next)).toBe(true)
  })

  it('ignores a late pause event from the previous video', () => {
    const current = createFeedRuntimeState(1, 'video-b', 4.5)
    const next = feedRuntimeReducer(current, {
      type: 'PAUSE',
      videoId: 'video-a',
      time: 9,
    })

    expect(next).toBe(current)
    expect(next.pausedFrame.videoId).toBe('video-b')
    expect(next.phase).toBe('browse')
  })

  it('blocks navigation while the video assets drawer is open', () => {
    const current = feedRuntimeReducer(
      createFeedRuntimeState(0, 'video-a', 1.25),
      { type: 'OPEN_VIDEO_ASSETS' },
    )
    const next = feedRuntimeReducer(current, {
      type: 'NAVIGATE',
      index: 1,
      videoId: 'video-b',
      time: 4.5,
    })

    expect(current.overlay).toBe('video-assets')
    expect(next).toBe(current)
  })

  it('tracks modal overlays in the same Feed state without closing a newer overlay', () => {
    const workshop = feedRuntimeReducer(
      createFeedRuntimeState(0, 'video-a', 1.25),
      { type: 'OPEN_OVERLAY', overlay: 'workshop' },
    )
    const stillWorkshop = feedRuntimeReducer(workshop, {
      type: 'CLOSE_OVERLAY',
      overlay: 'video-assets',
    })
    const blockedNavigation = feedRuntimeReducer(stillWorkshop, {
      type: 'NAVIGATE',
      index: 1,
      videoId: 'video-b',
      time: 4.5,
    })

    expect(stillWorkshop).toBe(workshop)
    expect(blockedNavigation).toBe(workshop)
    expect(blockedNavigation.overlay).toBe('workshop')
  })

  it('keeps the selected video and paused frame aligned through pause and resume', () => {
    const paused = feedRuntimeReducer(
      createFeedRuntimeState(2, 'video-c', 0),
      { type: 'PAUSE', videoId: 'video-c', time: 6.75 },
    )
    const resumed = feedRuntimeReducer(paused, { type: 'SET_PHASE', phase: 'browse' })

    expect(paused.phase).toBe('session')
    expect(paused.pausedFrame).toEqual({ videoId: 'video-c', time: 6.75 })
    expect(resumed.phase).toBe('browse')
    expect(isFeedRuntimeConsistent(resumed)).toBe(true)
  })
})
