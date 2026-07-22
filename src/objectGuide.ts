import * as ort from 'onnxruntime-web'
import { coverTransform } from './segmentApi'

export type GuideDetection = {
  box: { x: number; y: number; w: number; h: number }
  label: string
  confidence: number
}

const MODEL_URL = '/models/yolov8n_fp16.onnx'
const INPUT_SIZE = 640

const FURNITURE_CLASSES = new Map<number, { label: string; priority: number }>([
  [56, { label: '椅子', priority: 1.08 }],
  [57, { label: '沙发', priority: 1.22 }],
  [58, { label: '绿植', priority: 1.05 }],
  [59, { label: '床', priority: 1.2 }],
  [60, { label: '桌子', priority: 1.18 }],
  [62, { label: '电视', priority: 0.92 }],
  [74, { label: '时钟', priority: 0.7 }],
  [75, { label: '花瓶', priority: 0.8 }],
])

let detectorSessionPromise: Promise<ort.InferenceSession> | null = null

function getDetectorSession(): Promise<ort.InferenceSession> {
  detectorSessionPromise ??= fetch(MODEL_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Guide detector unavailable: ${response.status}`)
      return response.arrayBuffer()
    })
    .then((model) => ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }))
    .catch((error) => {
      detectorSessionPromise = null
      throw error
    })
  return detectorSessionPromise
}

export async function warmupFurnitureDetector(): Promise<void> {
  await getDetectorSession()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function captureDisplayedFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = Math.max(1, Math.round(video.offsetWidth))
  const height = Math.max(1, Math.round(video.offsetHeight))
  const transform = coverTransform(video)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to capture detector frame')
  context.drawImage(
    video,
    transform.offsetX,
    transform.offsetY,
    transform.vw * transform.scale,
    transform.vh * transform.scale,
  )
  return canvas
}

function prepareInput(source: HTMLCanvasElement) {
  const scale = Math.min(INPUT_SIZE / source.width, INPUT_SIZE / source.height)
  const scaledWidth = Math.round(source.width * scale)
  const scaledHeight = Math.round(source.height * scale)
  const padX = Math.floor((INPUT_SIZE - scaledWidth) / 2)
  const padY = Math.floor((INPUT_SIZE - scaledHeight) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to prepare detector input')
  context.fillStyle = 'rgb(114,114,114)'
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, padX, padY, scaledWidth, scaledHeight)
  const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const plane = INPUT_SIZE * INPUT_SIZE
  const chw = new Float32Array(plane * 3)
  for (let pixel = 0; pixel < plane; pixel++) {
    const sourceIndex = pixel * 4
    chw[pixel] = rgba[sourceIndex] / 255
    chw[plane + pixel] = rgba[sourceIndex + 1] / 255
    chw[plane * 2 + pixel] = rgba[sourceIndex + 2] / 255
  }
  return {
    tensor: new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    scale,
    padX,
    padY,
  }
}

function iou(a: GuideDetection['box'], b: GuideDetection['box']): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  if (!intersection) return 0
  return intersection / (a.w * a.h + b.w * b.h - intersection)
}

export async function detectGuideFurniture(video: HTMLVideoElement): Promise<GuideDetection | null> {
  const startedAt = performance.now()
  const source = captureDisplayedFrame(video)
  const input = prepareInput(source)
  const session = await getDetectorSession()
  const result = await session.run({ [session.inputNames[0]]: input.tensor })
  const output = result[session.outputNames[0]]
  if (!output) return null
  const dims = output.dims.map(Number)
  const data = output.data as Float32Array
  const channelMajor = dims.length === 3 && dims[1] < dims[2]
  const attributes = channelMajor ? dims[1] : dims[2]
  const candidates = channelMajor ? dims[2] : dims[1]
  if (attributes < 84) throw new Error(`Unexpected detector output: ${dims.join('x')}`)
  const valueAt = (attribute: number, candidate: number) => channelMajor
    ? data[attribute * candidates + candidate]
    : data[candidate * attributes + attribute]
  const detections: Array<GuideDetection & { rank: number }> = []
  const screenArea = source.width * source.height

  for (let candidate = 0; candidate < candidates; candidate++) {
    let classId = -1
    let confidence = 0
    for (const [id] of FURNITURE_CLASSES) {
      const score = valueAt(4 + id, candidate)
      if (score > confidence) {
        confidence = score
        classId = id
      }
    }
    if (classId < 0 || confidence < 0.23) continue
    const cx = valueAt(0, candidate)
    const cy = valueAt(1, candidate)
    const width = valueAt(2, candidate)
    const height = valueAt(3, candidate)
    const x1 = clamp((cx - width / 2 - input.padX) / input.scale, 0, source.width)
    const y1 = clamp((cy - height / 2 - input.padY) / input.scale, 0, source.height)
    const x2 = clamp((cx + width / 2 - input.padX) / input.scale, 0, source.width)
    const y2 = clamp((cy + height / 2 - input.padY) / input.scale, 0, source.height)
    const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    const areaRatio = box.w * box.h / screenArea
    if (box.w < 34 || box.h < 34 || areaRatio < 0.012 || areaRatio > 0.68) continue
    const centerX = box.x + box.w / 2
    const centerY = box.y + box.h / 2
    const centerDistance = Math.hypot(centerX - source.width / 2, centerY - source.height * 0.52)
    const maxDistance = Math.hypot(source.width / 2, source.height / 2)
    const centrality = 1 - clamp(centerDistance / maxDistance, 0, 1)
    const furniture = FURNITURE_CLASSES.get(classId)!
    const rank = confidence * furniture.priority + Math.min(areaRatio, 0.3) * 0.85 + centrality * 0.12
    detections.push({ box, label: furniture.label, confidence, rank })
  }

  detections.sort((a, b) => b.rank - a.rank)
  const kept: typeof detections = []
  for (const detection of detections) {
    if (kept.every((existing) => iou(existing.box, detection.box) < 0.55)) kept.push(detection)
    if (kept.length >= 6) break
  }
  const best = kept[0]
  console.info(`[GuideDetector] ${best ? `${best.label} ${(best.confidence * 100).toFixed(0)}%` : 'no target'} in ${Math.round(performance.now() - startedAt)}ms`)
  if (!best) return null
  const padX = Math.min(18, best.box.w * 0.08)
  const padY = Math.min(18, best.box.h * 0.08)
  return {
    box: {
      x: clamp(best.box.x - padX, 0, source.width - 1),
      y: clamp(best.box.y - padY, 0, source.height - 1),
      w: clamp(best.box.w + padX * 2, 1, source.width - Math.max(0, best.box.x - padX)),
      h: clamp(best.box.h + padY * 2, 1, source.height - Math.max(0, best.box.y - padY)),
    },
    label: best.label,
    confidence: best.confidence,
  }
}
