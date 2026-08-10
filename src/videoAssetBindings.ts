import { reusableAssetToComponent } from './assetReuse'
import { dreamHomeApiUrl } from './dreamHomeApi'
import type { LibraryComponent } from './types'
import type { ReusableAsset } from './videoSelectionApi'

interface VideoTrack {
  track_id: string
  t_start: number
  t_end: number
  best_frame_t: number
  frames: Array<{ t: number; bbox: [number, number, number, number] }>
  asset_id?: string | null
}

interface VideoIndexResponse {
  video_id: string
  tracks: VideoTrack[]
}

function mediaUrl(value = ''): string {
  if (!value) return ''
  try {
    const url = new URL(value, window.location.origin)
    if (url.pathname.startsWith('/storage/')) return dreamHomeApiUrl(url.pathname)
  } catch {
    // Preserve provider/CDN URLs that do not parse in this environment.
  }
  return value.startsWith('/') ? dreamHomeApiUrl(value) : value
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`视频资产索引加载失败 (${response.status})`)
  return response.json() as Promise<T>
}

export async function fetchVideoBoundAssets(videoId: string): Promise<LibraryComponent[]> {
  const indexResponse = await fetch(dreamHomeApiUrl(`/api/videos/${encodeURIComponent(videoId)}/index`))
  // A feed video is registered on its first valid selection upload. Until
  // then a 404 means "no bindings yet", not a broken feed.
  if (indexResponse.status === 404) return []
  const index = await responseJson<VideoIndexResponse>(indexResponse)
  const tracks = index.tracks.filter((track) => Boolean(track.asset_id))
  const assetIds = Array.from(new Set(tracks.map((track) => track.asset_id!)))
  const assets = await Promise.all(assetIds.map(async (assetId) => {
    const response = await fetch(dreamHomeApiUrl(`/api/assets/${encodeURIComponent(assetId)}`))
    if (response.status === 404) return null
    return responseJson<ReusableAsset>(response)
  }))

  const hydrated = assets.flatMap((asset) => {
    if (!asset || !asset.glb_url) return []
    const appearances = tracks
      .filter((track) => track.asset_id === asset.asset_id)
      .map((track) => {
        // A manual selection starts as one exact keyframe. Give that point the
        // same 750 ms lookup tolerance as the backend's /assets_at contract so
        // normal video clock jitter cannot make the hotspot disappear.
        const pointTrack = Math.abs(track.t_end - track.t_start) < 0.001
        return {
          startSec: Math.max(0, track.t_start - (pointTrack ? 0.75 : 0)),
          endSec: track.t_end + (pointTrack ? 0.75 : 0),
          representativeSec: track.best_frame_t,
        }
      })
    const representativeSec = appearances[0]?.representativeSec ?? asset.source?.t_best ?? 0
    const thumbnail = mediaUrl(asset.thumb_url)
    const component = reusableAssetToComponent({
      ...asset,
      glb_url: mediaUrl(asset.glb_url),
      thumb_url: thumbnail,
      source: {
        ...asset.source,
        video_id: videoId,
        t_best: representativeSec,
      },
    }, thumbnail)
    return [{
      ...component,
      source: `DreamHome 圈选 · ${videoId}`,
      sourceDescription: '用户圈选后已持久化绑定到视频关键帧',
      sourceVideo: {
        ...component.sourceVideo!,
        videoId,
        startSec: appearances[0]?.startSec ?? representativeSec,
        endSec: appearances[0]?.endSec ?? representativeSec,
        appearances,
      },
    }]
  })

  // A canonical model can have more than one historical asset row when an
  // old selection was retried repeatedly.  Those rows are not different
  // furniture: they point at the exact same GLB.  Collapse them at the media
  // identity boundary and preserve every appearance on the retained asset so
  // the video drawer never renders a row of duplicate plants.
  const byModel = new Map<string, LibraryComponent>()
  for (const component of hydrated) {
    const modelKey = mediaUrl(component.modelUrl ?? '').replace(/[?#].*$/, '') || component.id
    const existing = byModel.get(modelKey)
    if (!existing) {
      byModel.set(modelKey, component)
      continue
    }
    const appearances = [
      ...(existing.sourceVideo?.appearances ?? []),
      ...(component.sourceVideo?.appearances ?? []),
    ].filter((appearance, index, list) => list.findIndex((candidate) => (
      candidate.startSec === appearance.startSec
      && candidate.endSec === appearance.endSec
      && candidate.representativeSec === appearance.representativeSec
    )) === index)
    byModel.set(modelKey, {
      ...existing,
      sourceVideo: existing.sourceVideo ? { ...existing.sourceVideo, appearances } : existing.sourceVideo,
    })
  }
  return [...byModel.values()]
}

export function mergeVideoAssets(
  staticAssets: LibraryComponent[],
  dynamicAssets: LibraryComponent[],
): LibraryComponent[] {
  const merged = new Map(staticAssets.map((asset) => [asset.id, asset]))
  for (const asset of dynamicAssets) merged.set(asset.id, asset)
  return [...merged.values()]
}

export function videoAssetsAtTime(assets: LibraryComponent[], frameTime: number): LibraryComponent[] {
  return assets.flatMap((asset) => {
    const appearance = asset.sourceVideo?.appearances?.find((candidate) => (
      frameTime >= candidate.startSec && frameTime <= candidate.endSec
    ))
    if (!appearance || !asset.sourceVideo) return []
    const minute = Math.floor(appearance.representativeSec / 60)
    const second = String(Math.floor(appearance.representativeSec % 60)).padStart(2, '0')
    return [{
      ...asset,
      sourceVideo: {
        ...asset.sourceVideo,
        frameTime: `${minute}:${second}`,
        startSec: appearance.startSec,
        endSec: appearance.endSec,
      },
    }]
  })
}
