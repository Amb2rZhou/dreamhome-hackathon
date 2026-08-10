import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryComponent } from './types'
import { fetchVideoBoundAssets, mergeVideoAssets, videoAssetsAtTime } from './videoAssetBindings'

afterEach(() => vi.unstubAllGlobals())

const asset = (id: string, startSec: number, endSec: number): LibraryComponent => ({
  id,
  category: '其他',
  name: id,
  source: '测试',
  size: '尺寸待补充',
  styleTags: [],
  thumbnail: '',
  color: '#000',
  sticker: '',
  modelUrl: `/${id}.glb`,
  sourceVideo: {
    blogger: '测试',
    frameTime: '0:01',
    videoId: 'home-1',
    appearances: [{ startSec, endSec, representativeSec: startSec }],
  },
})

describe('video asset bindings', () => {
  it('lets authoritative backend bindings replace the same static asset', () => {
    const merged = mergeVideoAssets([asset('ast-chair', 1, 2)], [asset('ast-chair', 8, 9)])
    expect(merged).toHaveLength(1)
    expect(merged[0].sourceVideo?.appearances?.[0].startSec).toBe(8)
  })

  it('shows a bound component only at its persisted keyframe range', () => {
    const assets = [asset('ast-chair', 8, 9)]
    expect(videoAssetsAtTime(assets, 8.5).map((item) => item.id)).toEqual(['ast-chair'])
    expect(videoAssetsAtTime(assets, 3)).toEqual([])
  })

  it('hydrates a canonical component from a persisted video track', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        video_id: 'home-1',
        tracks: [{
          track_id: 'trk-sideboard',
          t_start: 1.7,
          t_end: 1.7,
          best_frame_t: 1.7,
          frames: [{ t: 1.7, bbox: [0.1, 0.49, 0.44, 0.19] }],
          asset_id: 'ast-sideboard',
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        asset_id: 'ast-sideboard',
        name: '边柜',
        status: 'ready',
        glb_url: '/storage/models/sideboard.glb',
        thumb_url: '/storage/thumbs/sideboard.png',
        labels: { category: '柜子', styles: ['北欧'], materials: ['实木'] },
        source: { video_id: 'home-1', track_id: 'trk-sideboard', t_best: 1.7 },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const hydrated = await fetchVideoBoundAssets('home-1')

    expect(hydrated).toHaveLength(1)
    expect(hydrated[0]).toEqual(expect.objectContaining({
      id: 'ast-sideboard',
      name: '边柜',
      modelUrl: 'http://127.0.0.1:8000/storage/models/sideboard.glb',
    }))
    expect(hydrated[0].sourceVideo?.appearances).toEqual([{
      startSec: 0.95,
      endSec: 2.45,
      representativeSec: 1.7,
    }])
  })

  it('collapses historical asset rows that point at the same canonical GLB', async () => {
    const tracks = ['ast-plant-a', 'ast-plant-b'].map((assetId) => ({
      track_id: `trk-${assetId}`,
      t_start: 4.24,
      t_end: 4.24,
      best_frame_t: 4.24,
      frames: [{ t: 4.24, bbox: [0.1, 0.1, 0.2, 0.2] }],
      asset_id: assetId,
    }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'home-1', tracks }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
        asset_id: 'ast-plant',
        name: '盆栽植物',
        status: 'ready',
        glb_url: '/storage/models/shared-plant.glb',
        thumb_url: '/storage/thumbs/shared-plant.png',
        labels: { category: '绿植' },
        source: { video_id: 'home-1', t_best: 4.24 },
      }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const hydrated = await fetchVideoBoundAssets('home-1')

    expect(hydrated).toHaveLength(1)
    expect(hydrated[0].name).toBe('盆栽植物')
  })
})
