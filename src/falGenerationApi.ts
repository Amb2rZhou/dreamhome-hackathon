import type { FurnitureCategory, LibraryComponent } from './types'
import { CATEGORY_COLOR } from './types'

export interface FalSubmitResponse {
  job_id: string
  status: 'queued'
  provider: 'fal'
  submit_ms?: number
}

export interface FalJobResponse {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  provider?: 'fal'
  model_url?: string | null
  thumbnail_url?: string | null
  error?: string | null
}

export class FalApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'FalApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init?: RequestInit, timeoutMs = 65_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new FalApiError(payload.error || `3D 服务请求失败 (${response.status})`, response.status)
    return payload as T
  } catch (error) {
    if (error instanceof FalApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new FalApiError('3D 服务响应超时')
    throw new FalApiError(error instanceof Error ? error.message : '3D 服务暂时不可用')
  } finally {
    window.clearTimeout(timer)
  }
}

function compressedDataUrl(source: string, maxEdge = 1024, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!source.startsWith('data:image/')) {
      resolve(source)
      return
    }
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new FalApiError('无法准备 3D 输入图片'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png', quality))
    }
    image.onerror = () => reject(new FalApiError('圈选图片读取失败'))
    image.src = source
  })
}

export async function submitFalGeneration(imageDataUrl: string, prompt: string): Promise<FalSubmitResponse> {
  const prepared = await compressedDataUrl(imageDataUrl)
  return requestJson('/api/photo-to-3d', {
    method: 'POST',
    body: JSON.stringify({ image_data_url: prepared, prompt }),
  })
}

export function getFalJob(jobId: string): Promise<FalJobResponse> {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, undefined, 35_000)
}

export function falJobToComponent(job: FalJobResponse, fallback: {
  id: string
  name: string
  category: FurnitureCategory
  snapshot: string
}): LibraryComponent {
  const color = CATEGORY_COLOR[fallback.category]
  const thumbnail = job.thumbnail_url || fallback.snapshot
  return {
    id: `fal-${fallback.id}`,
    category: fallback.category,
    name: fallback.name,
    source: '圈选生成 · FAL TRELLIS',
    sourceDescription: '由包工球生成并加入素材库',
    size: '待识别尺寸',
    styleTags: ['FAL', 'TRELLIS', '完整 3D'],
    thumbnail,
    color,
    sticker: thumbnail,
    completedImageUrl: thumbnail,
    modelUrl: job.model_url || undefined,
  }
}
