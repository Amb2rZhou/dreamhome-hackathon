import { describe, expect, it } from 'vitest'
import { AVAILABLE_ASSETS } from './availableAssets.generated'
import { AVAILABLE_ASSETS_BY_VIDEO, assetsForVideoFrame, detectedFurnitureForVideoFrame } from './availableAssets.generated'
import { FEED_VIDEOS } from './types'

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

  it('deduplicates the reviewed black living-room sofa and exposes missing detections', () => {
    const assets = assetsForVideoFrame('vid_58a7a1504281', 9)
    expect(assets.filter((asset) => asset.name === '三人沙发')).toHaveLength(1)
    expect(assets.some((asset) => asset.name === '茶几')).toBe(true)
    expect(detectedFurnitureForVideoFrame('vid_58a7a1504281', 9, assets)).toEqual(
      expect.arrayContaining(['三人沙发', '茶几', '落地灯', '书桌']),
    )
  })

  it('starts the Feed with a video that has reviewed component data', () => {
    const firstVideo = FEED_VIDEOS[0]
    expect(firstVideo.id).not.toBe('home-1')
    expect(firstVideo.mediaType === 'image-carousel' || AVAILABLE_ASSETS_BY_VIDEO[firstVideo.id]?.length).toBeTruthy()
  })
})
