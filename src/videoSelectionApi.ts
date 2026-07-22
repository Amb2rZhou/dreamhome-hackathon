import type { VideoSelectionUpload } from './segmentApi'
import { dreamHomeApiUrl } from './dreamHomeApi'

export interface SelectionLabels {
  category?: string
  sub?: string
  colors?: string[]
  materials?: string[]
  styles?: string[]
  features?: string[]
}

export interface VideoSelectResponse {
  select_id: string
  labels: SelectionLabels
  candidates: Array<{
    asset: { asset_id: string; name?: string }
    score: number
    reason?: string
  }>
}

export interface VideoSelectConfirmResponse {
  asset_id?: string | null
  job_id?: string | null
  track_id: string
}

export class VideoSelectionError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'VideoSelectionError'
    this.status = status
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { detail?: string; error?: string }
  if (!response.ok) {
    throw new VideoSelectionError(payload.detail || payload.error || `圈选服务请求失败 (${response.status})`, response.status)
  }
  return payload as T
}

export async function submitVideoSelection(input: {
  videoId: string
  time: number
  upload: VideoSelectionUpload
  categoryHint?: string
  trackId?: string
}): Promise<VideoSelectResponse> {
  const form = new FormData()
  form.append('t', String(input.time))
  form.append('bbox', JSON.stringify(input.upload.bbox))
  form.append('polygon', JSON.stringify(input.upload.polygon))
  form.append('frame_width', String(input.upload.frameWidth))
  form.append('frame_height', String(input.upload.frameHeight))
  form.append('category_hint', input.categoryHint || '')
  if (input.trackId) form.append('track_id', input.trackId)
  form.append('frame', input.upload.frame, `${input.videoId}-${input.time.toFixed(3)}.jpg`)

  const response = await fetch(dreamHomeApiUrl(`/api/videos/${encodeURIComponent(input.videoId)}/select`), {
    method: 'POST',
    body: form,
  })
  return responseJson<VideoSelectResponse>(response)
}

export async function confirmVideoSelection(input: {
  videoId: string
  selectId: string
  useAssetId?: string
  generateNew?: boolean
}): Promise<VideoSelectConfirmResponse> {
  const response = await fetch(dreamHomeApiUrl(`/api/videos/${encodeURIComponent(input.videoId)}/select/confirm`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      select_id: input.selectId,
      use_asset_id: input.useAssetId || null,
      generate_new: input.generateNew ?? false,
    }),
  })
  return responseJson<VideoSelectConfirmResponse>(response)
}
