import { beforeEach, describe, expect, it } from 'vitest'
import { DREAMHOME_PROFILE_KEY, dreamHomeUserId } from './dreamHomeIdentity'

describe('DreamHome local profile identity', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete window.__DREAMHOME_USER_ID__
  })

  it('creates one stable non-demo id for this browser', () => {
    const first = dreamHomeUserId()
    expect(first).toMatch(/^local-profile-/)
    expect(first).not.toBe('demo')
    expect(dreamHomeUserId()).toBe(first)
    expect(JSON.parse(window.localStorage.getItem(DREAMHOME_PROFILE_KEY) || '{}').userId).toBe(first)
  })

  it('allows a future authenticated shell to supply its verified id', () => {
    window.__DREAMHOME_USER_ID__ = 'verified-user-42'
    expect(dreamHomeUserId()).toBe('verified-user-42')
  })
})
