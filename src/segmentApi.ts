// 仅保留 EdgeSAM 流程所需的截图与调试留痕工具。
// 付费万相、remove.bg 与旧 rembg 后端调用已从前端删除。

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const arr = dataUrl.split(',')
  if (arr.length !== 2) return null
  const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'image/png'
  const bstr = atob(arr[1])
  const n = bstr.length
  const u8arr = new Uint8Array(n)
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i)
  return new Blob([u8arr], { type: mime })
}

const SAVE_TRACE_URL = 'http://localhost:8001/api/save_trace'
const TRACES_URL = 'http://localhost:8001/api/traces'

// 保存一条 trace 到后端文件系统（绕过 localStorage 5MB 限制）
export async function saveTraceToBackend(trace: {
  id: string
  ts: number
  label: string
  status: string
  bboxDataUrl: string | null
  inpaintDataUrl: string | null
}): Promise<boolean> {
  try {
    const form = new FormData()
    form.append('trace_id', trace.id)
    form.append('label', trace.label)
    form.append('ts', String(trace.ts))
    form.append('status', trace.status)
    // 健壮性：dataUrlToBlob 可能返回 null，用非空断言会抛异常吞掉整个请求
    const safeAppend = (key: string, dataUrl: string | null, filename: string) => {
      if (!dataUrl) return
      const blob = dataUrlToBlob(dataUrl)
      if (blob) form.append(key, blob, filename)
    }
    safeAppend('bbox_img', trace.bboxDataUrl, 'bbox.png')
    safeAppend('inpaint_img', trace.inpaintDataUrl, 'inpaint.png')
    const res = await fetch(SAVE_TRACE_URL, { method: 'POST', body: form })
    if (!res.ok) {
      console.warn('[saveTrace] server returned', res.status, await res.text())
      return false
    }
    console.log('[saveTrace] saved to backend:', trace.id)
    return true
  } catch (e) {
    console.warn('[saveTrace] error:', e)
    return false
  }
}

// 从后端加载所有历史 trace 元数据
export async function loadTracesFromBackend(): Promise<{
  id: string
  ts: number
  label: string
  status: string
  has_bbox: boolean
  has_inpaint: boolean
}[]> {
  try {
    const res = await fetch(TRACES_URL)
    if (!res.ok) return []
    const data = await res.json()
    return data.traces ?? []
  } catch {
    return []
  }
}

// 构造后端图片 URL
export function traceImageUrl(traceId: string, type: 'bbox' | 'inpaint'): string {
  return `${TRACES_URL}/${traceId}/image?type=${type}`
}


// 从视频截 bbox 区域（带背景，cover 坐标转换），返回 dataURL
export async function captureBbox(
  video: HTMLVideoElement,
  box: { x: number; y: number; w: number; h: number },
): Promise<string | null> {
  const t = coverTransform(video)
  const v = screenToVideo(box, t)
  const canvas = document.createElement('canvas')
  canvas.width = box.w
  canvas.height = box.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, v.x, v.y, v.w, v.h, 0, 0, box.w, box.h)
  return canvas.toDataURL('image/png')
}

// object-fit: cover 几何：视频等比放大填满，居中，超出裁切。
// 返回 screen 坐标 → 视频原始像素坐标的映射参数。
export function coverTransform(video: HTMLVideoElement) {
  const vw = video.videoWidth || video.offsetWidth
  const vh = video.videoHeight || video.offsetHeight
  const sw = video.offsetWidth
  const sh = video.offsetHeight
  const scale = Math.max(sw / vw, sh / vh) // cover 等比放大倍数
  // 视频放大后的显示尺寸
  const dispW = vw * scale
  const dispH = vh * scale
  // 视频在 screen 内居中的偏移（screen 坐标系，负数=该侧被裁）
  const offsetX = (sw - dispW) / 2
  const offsetY = (sh - dispH) / 2
  return { vw, vh, scale, offsetX, offsetY }
}

// screen 坐标 → 视频原始像素坐标
export function screenToVideo(box: { x: number; y: number; w: number; h: number }, t: ReturnType<typeof coverTransform>) {
  return {
    x: (box.x - t.offsetX) / t.scale,
    y: (box.y - t.offsetY) / t.scale,
    w: box.w / t.scale,
    h: box.h / t.scale,
  }
}

export interface VideoSelectionUpload {
  frame: Blob
  frameWidth: number
  frameHeight: number
  bbox: [number, number, number, number]
  polygon: Array<[number, number]>
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

// Prepare the backend selection artifact from untouched source pixels. The
// browser SAM cutout is deliberately not involved in this upload.
export function captureVideoSelectionUpload(
  video: HTMLVideoElement,
  box: { x: number; y: number; w: number; h: number },
  path: Array<{ x: number; y: number }>,
): Promise<VideoSelectionUpload> {
  return new Promise((resolve, reject) => {
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    if (!frameWidth || !frameHeight) {
      reject(new Error('视频原始帧尚未就绪'))
      return
    }

    const transform = coverTransform(video)
    const sourceBox = screenToVideo(box, transform)
    const left = clamp01(sourceBox.x / frameWidth)
    const top = clamp01(sourceBox.y / frameHeight)
    const right = clamp01((sourceBox.x + sourceBox.w) / frameWidth)
    const bottom = clamp01((sourceBox.y + sourceBox.h) / frameHeight)
    const bbox: [number, number, number, number] = [
      left,
      top,
      Math.max(1 / frameWidth, right - left),
      Math.max(1 / frameHeight, bottom - top),
    ]
    bbox[2] = Math.min(1 - bbox[0], bbox[2])
    bbox[3] = Math.min(1 - bbox[1], bbox[3])

    const polygon = path.map((point): [number, number] => [
      clamp01(((point.x - transform.offsetX) / transform.scale) / frameWidth),
      clamp01(((point.y - transform.offsetY) / transform.scale) / frameHeight),
    ])

    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight
    const context = canvas.getContext('2d')
    if (!context) {
      reject(new Error('无法读取视频原始帧'))
      return
    }
    context.drawImage(video, 0, 0, frameWidth, frameHeight)
    canvas.toBlob((frame) => {
      if (!frame) {
        reject(new Error('无法压缩视频原始帧'))
        return
      }
      resolve({ frame, frameWidth, frameHeight, bbox, polygon })
    }, 'image/jpeg', 0.84)
  })
}

export function applyPathMask(
  imageDataUrl: string,
  path: { x: number; y: number }[],
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = box.w
      canvas.height = box.h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('no context')); return }

      // 路径面积检查：如果路径覆盖面积 < bbox 的 20%，说明用户只画了一小段，回退使用完整图片
      const pathArea = polygonArea(path, box)
      const boxArea = box.w * box.h
      if (pathArea < boxArea * 0.2) {
        console.warn(`[applyPathMask] path area (${pathArea.toFixed(0)}) < 20% of bbox (${boxArea.toFixed(0)}), skip mask`)
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
        return
      }

      ctx.drawImage(img, 0, 0)

      const mask = document.createElement('canvas')
      mask.width = box.w
      mask.height = box.h
      const mctx = mask.getContext('2d')
      if (!mctx) { reject(new Error('no mask context')); return }

      mctx.beginPath()
      path.forEach((p, i) => {
        const px = p.x - box.x
        const py = p.y - box.y
        if (i === 0) mctx.moveTo(px, py)
        else mctx.lineTo(px, py)
      })
      mctx.closePath()
      mctx.fillStyle = 'white'
      mctx.fill()

      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(mask, 0, 0)
      ctx.globalCompositeOperation = 'source-over'

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = imageDataUrl
  })
}

/** Shoelace formula：计算多边形面积（使用 bbox 相对坐标） */
function polygonArea(
  path: { x: number; y: number }[],
  box: { x: number; y: number; w: number; h: number },
): number {
  if (path.length < 3) return 0
  let area = 0
  for (let i = 0; i < path.length; i++) {
    const j = (i + 1) % path.length
    const xi = path[i].x - box.x
    const yi = path[i].y - box.y
    const xj = path[j].x - box.x
    const yj = path[j].y - box.y
    area += xi * yj - xj * yi
  }
  return Math.abs(area) / 2
}

export async function videoFrameToBlob(
  video: HTMLVideoElement,
  box: { x: number; y: number; w: number; h: number },
): Promise<{ blob: Blob; scaledBox: { x: number; y: number; w: number; h: number } } | null> {
  const t = coverTransform(video)
  const v = screenToVideo(box, t)
  const scaledBox = {
    x: Math.max(0, Math.round(v.x)),
    y: Math.max(0, Math.round(v.y)),
    w: Math.round(v.w),
    h: Math.round(v.h),
  }
  const pad = 20
  const cropX = Math.max(0, scaledBox.x - pad)
  const cropY = Math.max(0, scaledBox.y - pad)
  const cropW = Math.min(t.vw - cropX, scaledBox.w + pad * 2)
  const cropH = Math.min(t.vh - cropY, scaledBox.h + pad * 2)
  const tmp = document.createElement('canvas')
  tmp.width = cropW
  tmp.height = cropH
  const ctx = tmp.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
  const localBox = { x: scaledBox.x - cropX, y: scaledBox.y - cropY, w: scaledBox.w, h: scaledBox.h }
  const blob = await new Promise<Blob | null>((resolve) => tmp.toBlob((b) => resolve(b), 'image/png'))
  if (!blob) return null
  return { blob, scaledBox: localBox }
}
