import { describe, expect, it } from 'vitest'
import { AVAILABLE_ASSETS } from './availableAssets.generated'

describe('reviewed asset delivery paths', () => {
  it('maps every canonical asset to the bundled prototype media', () => {
    expect(AVAILABLE_ASSETS.length).toBeGreaterThan(0)

    for (const asset of AVAILABLE_ASSETS) {
      expect(asset.sticker).toBe(`/prototype/assets/library/${asset.id}.jpg`)
      expect(asset.completedImageUrl).toBe(`/prototype/assets/library/${asset.id}.jpg`)
      expect(asset.sourceCropUrl).toBe(`/prototype/assets/frames/${asset.id}.jpg`)
      expect(asset.modelUrl).toBe(`/prototype/assets/models/${asset.id}.glb`)
      expect(asset.sourceVideo?.frameImg).toBe(`/prototype/assets/frames/${asset.id}.jpg`)
    }
  })
})
