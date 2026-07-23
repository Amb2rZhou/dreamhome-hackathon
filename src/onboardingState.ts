let seenInThisSession = false

export function hasSeenFeedOnboarding(): boolean {
  return seenInThisSession
}

export function rememberFeedOnboarding(): void {
  seenInThisSession = true
}
