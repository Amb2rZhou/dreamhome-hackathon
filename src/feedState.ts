import type { FeedState } from './types'

export type FeedOverlay = 'none' | 'video-assets' | 'workshop' | 'craft-result' | 'trace' | 'reuse-decision'

export interface FeedRuntimeState {
  index: number
  videoId: string
  pausedFrame: {
    videoId: string
    time: number
  }
  phase: FeedState
  overlay: FeedOverlay
}

export type FeedRuntimeAction =
  | { type: 'PAUSE'; videoId: string; time: number }
  | { type: 'NAVIGATE'; index: number; videoId: string; time: number }
  | { type: 'SET_TARGET'; index: number; videoId: string; time: number }
  | { type: 'SET_PHASE'; phase: FeedState }
  | { type: 'OPEN_VIDEO_ASSETS' }
  | { type: 'CLOSE_VIDEO_ASSETS' }
  | { type: 'OPEN_OVERLAY'; overlay: Exclude<FeedOverlay, 'none'> }
  | { type: 'CLOSE_OVERLAY'; overlay: Exclude<FeedOverlay, 'none'> }

export function createFeedRuntimeState(
  index: number,
  videoId: string,
  time: number,
): FeedRuntimeState {
  return {
    index,
    videoId,
    pausedFrame: { videoId, time },
    phase: 'browse',
    overlay: 'none',
  }
}

export function feedRuntimeReducer(
  state: FeedRuntimeState,
  action: FeedRuntimeAction,
): FeedRuntimeState {
  switch (action.type) {
    case 'PAUSE':
      // Ignore a late media event from the video that was just swiped away.
      if (action.videoId !== state.videoId || state.phase !== 'browse' || state.overlay !== 'none') return state
      return {
        ...state,
        pausedFrame: { videoId: action.videoId, time: action.time },
        phase: 'session',
      }
    case 'NAVIGATE':
      if (state.phase !== 'browse' || state.overlay !== 'none') return state
      return {
        index: action.index,
        videoId: action.videoId,
        pausedFrame: { videoId: action.videoId, time: action.time },
        phase: 'browse',
        overlay: 'none',
      }
    case 'SET_TARGET':
      return {
        index: action.index,
        videoId: action.videoId,
        pausedFrame: { videoId: action.videoId, time: action.time },
        // A source link is a request to inspect one exact occurrence, not to
        // resume playback from approximately the same place.
        phase: 'session',
        overlay: 'none',
      }
    case 'SET_PHASE':
      return { ...state, phase: action.phase, overlay: 'none' }
    case 'OPEN_VIDEO_ASSETS':
      if (state.phase !== 'browse') return state
      return { ...state, overlay: 'video-assets' }
    case 'CLOSE_VIDEO_ASSETS':
      return state.overlay !== 'video-assets' ? state : { ...state, overlay: 'none' }
    case 'OPEN_OVERLAY':
      return { ...state, overlay: action.overlay }
    case 'CLOSE_OVERLAY':
      return state.overlay !== action.overlay ? state : { ...state, overlay: 'none' }
  }
}

export function isFeedRuntimeConsistent(state: FeedRuntimeState): boolean {
  return state.videoId === state.pausedFrame.videoId && state.index >= 0
}
