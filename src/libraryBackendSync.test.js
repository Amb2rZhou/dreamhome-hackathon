import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCanonicalAssetToLibrary, getAssets, getDreamHomeUserId, getFavorites, sourceFeedHref, syncBackendUserAssets } from '../web/prototype/pages/shared/asset-library-data.js'

describe('Mia library backend synchronization', () => {
  beforeEach(() => {
    localStorage.clear()
    delete window.__DREAMHOME_API_BASE_URL__
    delete window.__DREAMHOME_USER_ID__
    vi.unstubAllGlobals()
  })

  it('shares the same browser-local profile id as the Feed', () => {
    const userId = getDreamHomeUserId()
    expect(userId).toMatch(/^local-profile-/)
    expect(JSON.parse(localStorage.getItem('dreamhome.local-profile.v1')).userId).toBe(userId)
  })

  it('hydrates ready canonical assets with exact video provenance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      asset_id: 'ast_generated',
      name: '边柜',
      status: 'ready',
      labels: { category: '柜子', materials: ['实木'], styles: ['北欧'] },
      size_prior: null,
      glb_url: '/storage/models/generated.glb',
      thumb_url: '/storage/thumbs/generated.png',
      source: { video_id: 'home-1', track_id: 'trk_generated', t_best: 1.7 },
      library_context: { video_id: 'home-1', track_id: 'trk_selected', t: 8.4 },
    }]), { status: 200 })))

    const synced = await syncBackendUserAssets()
    const component = getAssets('furniture').find((item) => item.id === 'ast_generated')

    expect(synced).toHaveLength(1)
    expect(component).toEqual(expect.objectContaining({
      modelUrl: 'http://127.0.0.1:8000/storage/models/generated.glb',
      videoId: 'home-1',
      videoSec: 8.4,
      sizeStatus: 'unknown',
    }))
    expect(sourceFeedHref(component)).toBe('../discover/index.html#asset=ast_generated&video=home-1&t=8.4')
    const ids = getAssets('furniture').map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps photo assets in the shared library without inventing a video return link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      asset_id: 'ast_photo',
      name: '拍摄·柜子',
      status: 'ready',
      labels: { category: '柜子', materials: ['待确认材质'], styles: ['中古'] },
      size_prior: null,
      glb_url: '/storage/models/photo.glb',
      source: { source_type: 'offline_photo', job_id: 'photo-1' },
      library_context: { source_type: 'offline_photo', job_id: 'photo-1' },
    }]), { status: 200 })))

    await syncBackendUserAssets()
    const component = getAssets('furniture').find((item) => item.id === 'ast_photo')

    expect(component).toEqual(expect.objectContaining({
      backendManaged: true,
      sourceType: 'offline_photo',
      sizeStatus: 'unknown',
      styles: ['中古'],
      materials: ['待确认材质'],
    }))
    expect(sourceFeedHref(component)).toBe('')
  })

  it('attaches a friend furniture canonical id to the current backend user before local collection', async () => {
    window.__DREAMHOME_USER_ID__ = 'amber-test'
    const assetId = 'ast_7a6844fdf7e6'
    const libraryRecord = {
      asset_id: assetId,
      name: '原资产',
      status: 'ready',
      labels: { category: '柜子', materials: ['实木'], styles: ['北欧'] },
      glb_url: '/storage/models/friend.glb',
      source: {},
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 1, total: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([libraryRecord]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([libraryRecord]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await addCanonicalAssetToLibrary(assetId, 'friend-share')

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/library/batch-add')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      asset_ids: [assetId],
      via: 'friend-share',
      user_id: 'amber-test',
    })
    expect(getFavorites().has(assetId)).toBe(true)
  })
})
