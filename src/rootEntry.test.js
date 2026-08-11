import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public root entry', () => {
  const html = readFileSync('web/index.html', 'utf8')

  it('opens the inspiration asset library instead of the feed', () => {
    expect(html).toContain("window.location.replace('/prototype/pages/inspiration-library/index.html')")
    expect(html).not.toContain('/prototype/pages/discover/app/assets/')
  })

  it('is not overwritten by the discover finalizer', () => {
    const finalizer = readFileSync('tools/finalize-discover-entry.mjs', 'utf8')
    expect(finalizer).not.toContain("copyFile(appEntry, rootEntry)")
  })
})
