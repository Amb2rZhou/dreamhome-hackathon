const ONBOARDING_SEEN_KEY = 'dreamhome-feed-onboarding-seen-v1'

let seenInThisSession = false

export function hasSeenFeedOnboarding(): boolean {
  if (seenInThisSession) return true
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberFeedOnboarding(): void {
  seenInThisSession = true
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1')
  } catch {
    // A restricted storage policy must not repeat the guide in this session.
  }
}
