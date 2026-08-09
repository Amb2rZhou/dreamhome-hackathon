import { describe, expect, it } from 'vitest'
import { IMAGE_POST_ASSETS, IMAGE_POST_HOTSPOTS, mergeImagePostAssetBindings } from './imagePostAssets'

describe('image post asset appearances', () => {
  it('reuses canonical assets instead of cloning them across slides', () => {
    expect(new Set(IMAGE_POST_ASSETS.map((asset) => asset.id)).size).toBe(12)

    const chairAppearances = IMAGE_POST_HOTSPOTS.filter((hotspot) => (
      hotspot.assetId === 'ast_ad5525ea3cd7'
    ))
    expect(chairAppearances.map((hotspot) => hotspot.slideIndex)).toEqual([0, 1, 2])
  })

  it('anchors the bed hotspot on the bedding instead of the dresser', () => {
    const bed = IMAGE_POST_HOTSPOTS.find((hotspot) => hotspot.assetId === 'ast_66867682801e')
    expect(bed?.slideIndex).toBe(9)
    expect(bed?.bbox).toEqual([0.08, 0.56, 0.76, 0.30])
  })

  it('merges persisted appearances without cloning canonical assets', () => {
    const merged = mergeImagePostAssetBindings([
      {
        asset_id: 'ast_ad5525ea3cd7',
        slide_index: 3,
        bbox: [0.2, 0.2, 0.3, 0.3],
        status: 'ready',
        model_url: '/storage/models/chair.glb',
      },
      {
        asset_id: 'ast_new',
        slide_index: 5,
        bbox: [0.1, 0.1, 0.2, 0.2],
        status: 'ready',
        name: '新边桌',
        labels: { category: '桌子', styles: ['现代'] },
        model_url: '/storage/models/new.glb',
        thumbnail_url: '/storage/thumbs/new.png',
      },
    ])

    expect(merged.hotspots).toContainEqual(expect.objectContaining({
      assetId: 'ast_ad5525ea3cd7', slideIndex: 3,
    }))
    expect(merged.assets.filter((asset) => asset.id === 'ast_ad5525ea3cd7')).toHaveLength(1)
    expect(merged.assets.find((asset) => asset.id === 'ast_new')).toEqual(expect.objectContaining({
      name: '新边桌', category: '茶几', modelUrl: 'http://127.0.0.1:8000/storage/models/new.glb',
    }))
  })
})
