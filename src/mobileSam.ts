import * as ort from 'onnxruntime-web'
import { coverTransform } from './segmentApi'

type Point = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

type PreparedFrame = {
  key: string
  screenWidth: number
  screenHeight: number
  modelWidth: number
  modelHeight: number
  contentWidth: number
  contentHeight: number
  sourceCanvas: HTMLCanvasElement
  embedding: ort.Tensor
}

export type EdgeSamResult = {
  dataUrl: string
  elapsedMs: number
  box: Box
  outlinePath: string
}

const MODEL_LONG_SIDE = 1024
const FRAME_RENDER_SCALE = 2
const STICKER_RENDER_SCALE = 1
const ENCODER_URL = '/models/edge_sam_3x_encoder.onnx'
const DECODER_URL = '/models/edge_sam_3x_decoder.onnx'
const PIXEL_MEAN = [123.675, 116.28, 103.53] as const
const PIXEL_STD = [58.395, 57.12, 57.375] as const

// WebGPU is preferred for the heavy encoder. WASM uses a few threads only when
// cross-origin isolation makes SharedArrayBuffer safe, otherwise it stays on
// the universal single-thread fallback. The proxy worker conflicts with WebGPU.
ort.env.wasm.numThreads = globalThis.crossOriginIsolated
  ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
  : 1
ort.env.wasm.proxy = false

let encoderSessionPromise: Promise<ort.InferenceSession> | null = null
let decoderSessionPromise: Promise<ort.InferenceSession> | null = null
let encoderBackend: 'webgpu' | 'wasm' = 'webgpu'
const modelBuffers = new Map<string, Promise<ArrayBuffer>>()
let preparedFrame: PreparedFrame | null = null
let preparingFrame: { key: string; promise: Promise<PreparedFrame> } | null = null

function getModelBuffer(modelUrl: string): Promise<ArrayBuffer> {
  let promise = modelBuffers.get(modelUrl)
  if (!promise) {
    promise = fetch(modelUrl).then(async (response) => {
      if (!response.ok) throw new Error(`EdgeSAM model unavailable: ${response.status}`)
      return response.arrayBuffer()
    })
    modelBuffers.set(modelUrl, promise)
  }
  return promise
}

async function createSession(
  modelUrl: string,
  executionProviders: Array<'webgpu' | 'wasm'>,
): Promise<ort.InferenceSession> {
  const model = await getModelBuffer(modelUrl)
  return ort.InferenceSession.create(model.slice(0), {
    executionProviders,
    graphOptimizationLevel: 'all',
  })
}

function getEncoderSession(): Promise<ort.InferenceSession> {
  encoderSessionPromise ??= createSession(ENCODER_URL, ['webgpu']).catch(async (webGpuError) => {
    encoderBackend = 'wasm'
    console.info('[EdgeSAM] WebGPU encoder unavailable; using WASM', webGpuError)
    return createSession(ENCODER_URL, ['wasm'])
  }).catch((error) => {
      encoderSessionPromise = null
      throw error
    })
  return encoderSessionPromise
}

function getDecoderSession(): Promise<ort.InferenceSession> {
  decoderSessionPromise ??= createSession(DECODER_URL, ['wasm']).catch((error) => {
    decoderSessionPromise = null
    throw error
  })
  return decoderSessionPromise
}

export async function warmupEdgeSam(): Promise<void> {
  // Download both model files together, then initialize sessions in order so
  // WebGPU and WASM do not race the one-time ONNX bootstrap.
  await Promise.all([
    getModelBuffer(ENCODER_URL),
    getModelBuffer(DECODER_URL),
  ])
  await getEncoderSession()
  await getDecoderSession()
}

function frameKey(video: HTMLVideoElement): string {
  return `${video.currentSrc}|${video.currentTime.toFixed(3)}|${video.offsetWidth}x${video.offsetHeight}`
}

function captureDisplayedFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = Math.max(1, Math.round(video.offsetWidth))
  const height = Math.max(1, Math.round(video.offsetHeight))
  const transform = coverTransform(video)
  const canvas = document.createElement('canvas')
  canvas.width = width * FRAME_RENDER_SCALE
  canvas.height = height * FRAME_RENDER_SCALE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to capture video frame')
  context.scale(FRAME_RENDER_SCALE, FRAME_RENDER_SCALE)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    video,
    transform.offsetX,
    transform.offsetY,
    transform.vw * transform.scale,
    transform.vh * transform.scale,
  )
  return canvas
}

function imageTensor(canvas: HTMLCanvasElement): {
  tensor: ort.Tensor
  contentWidth: number
  contentHeight: number
} {
  const scale = MODEL_LONG_SIDE / Math.max(canvas.width, canvas.height)
  const contentWidth = Math.max(1, Math.round(canvas.width * scale))
  const contentHeight = Math.max(1, Math.round(canvas.height * scale))
  const resized = document.createElement('canvas')
  resized.width = MODEL_LONG_SIDE
  resized.height = MODEL_LONG_SIDE
  const context = resized.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to resize video frame')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(canvas, 0, 0, contentWidth, contentHeight)
  const rgba = context.getImageData(0, 0, contentWidth, contentHeight).data
  const planeSize = MODEL_LONG_SIDE * MODEL_LONG_SIDE
  const chw = new Float32Array(planeSize * 3)
  for (let y = 0; y < contentHeight; y++) {
    for (let x = 0; x < contentWidth; x++) {
      const source = (y * contentWidth + x) * 4
      const target = y * MODEL_LONG_SIDE + x
      chw[target] = (rgba[source] - PIXEL_MEAN[0]) / PIXEL_STD[0]
      chw[planeSize + target] = (rgba[source + 1] - PIXEL_MEAN[1]) / PIXEL_STD[1]
      chw[planeSize * 2 + target] = (rgba[source + 2] - PIXEL_MEAN[2]) / PIXEL_STD[2]
    }
  }
  return {
    tensor: new ort.Tensor('float32', chw, [1, 3, MODEL_LONG_SIDE, MODEL_LONG_SIDE]),
    contentWidth,
    contentHeight,
  }
}

export async function prepareEdgeSamFrame(video: HTMLVideoElement): Promise<void> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Video frame is not ready')
  const key = frameKey(video)
  if (preparedFrame?.key === key) return
  if (preparingFrame?.key === key) {
    await preparingFrame.promise
    return
  }

  const promise = (async (): Promise<PreparedFrame> => {
    const startedAt = performance.now()
    const sourceCanvas = captureDisplayedFrame(video)
    const input = imageTensor(sourceCanvas)
    const encoder = await getEncoderSession()
    const result = await encoder.run({ image: input.tensor })
    const embedding = result.image_embeddings
    if (!embedding) throw new Error('EdgeSAM encoder returned no image embedding')
    const frame: PreparedFrame = {
      key,
      screenWidth: Math.max(1, Math.round(video.offsetWidth)),
      screenHeight: Math.max(1, Math.round(video.offsetHeight)),
      modelWidth: MODEL_LONG_SIDE,
      modelHeight: MODEL_LONG_SIDE,
      contentWidth: input.contentWidth,
      contentHeight: input.contentHeight,
      sourceCanvas,
      embedding,
    }
    preparedFrame = frame
    console.info(
      `[EdgeSAM] frame prepared with ${encoderBackend} in ${Math.round(performance.now() - startedAt)}ms`,
    )
    return frame
  })()
  preparingFrame = { key, promise }
  try {
    await promise
  } finally {
    if (preparingFrame?.promise === promise) preparingFrame = null
  }
}

// 固定视频 Demo 已在屏幕外用同一时间点、同一显示尺寸完成编码。
// 进入圈选页时把缓存绑定到真实 video，避免因 DOM 元素不同而重复跑 5~6 秒 encoder。
export function bindPreparedEdgeSamFrame(video: HTMLVideoElement): boolean {
  if (!preparedFrame) return false
  preparedFrame = {
    ...preparedFrame,
    key: frameKey(video),
    screenWidth: Math.max(1, Math.round(video.offsetWidth)),
    screenHeight: Math.max(1, Math.round(video.offsetHeight)),
  }
  return true
}

function averagePoint(path: Point[], fallback: Point): Point {
  if (path.length === 0) return fallback
  const sum = path.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / path.length, y: sum.y / path.length }
}

function polygonCenter(path: Point[], fallback: Point): Point {
  if (path.length < 3) return averagePoint(path, fallback)
  let twiceArea = 0
  let xSum = 0
  let ySum = 0
  for (let index = 0; index < path.length; index++) {
    const current = path[index]
    const next = path[(index + 1) % path.length]
    const cross = current.x * next.y - next.x * current.y
    twiceArea += cross
    xSum += (current.x + next.x) * cross
    ySum += (current.y + next.y) * cross
  }
  if (Math.abs(twiceArea) < 1) return averagePoint(path, fallback)
  return {
    x: xSum / (3 * twiceArea),
    y: ySum / (3 * twiceArea),
  }
}

function pointInPolygon(point: Point, path: Point[]): boolean {
  if (path.length < 3) return true
  let inside = false
  for (let current = 0, previous = path.length - 1; current < path.length; previous = current++) {
    const a = path[current]
    const b = path[previous]
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 0.0001) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function simplifyPathForScoring(path: Point[], maxPoints = 56): Point[] {
  if (path.length <= maxPoints) return path
  const step = path.length / maxPoints
  return Array.from({ length: maxPoints }, (_, index) => path[Math.floor(index * step)])
}

function rasterizePolygonMask(path: Point[], box: Box, width: number, height: number): Uint8Array {
  if (path.length < 3) return new Uint8Array(width * height).fill(255)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to rasterize lasso path')
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.moveTo(
    (path[0].x - box.x) * STICKER_RENDER_SCALE,
    (path[0].y - box.y) * STICKER_RENDER_SCALE,
  )
  for (let index = 1; index < path.length; index++) {
    context.lineTo(
      (path[index].x - box.x) * STICKER_RENDER_SCALE,
      (path[index].y - box.y) * STICKER_RENDER_SCALE,
    )
  }
  context.closePath()
  context.fill('evenodd')
  const rgba = context.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)
  for (let source = 3, target = 0; source < rgba.length; source += 4, target += 1) {
    mask[target] = rgba[source]
  }
  return mask
}

function buildNegativePrompts(path: Point[], box: Box): Point[] {
  const inset = 2
  const cornerCandidates: Point[] = [
    { x: box.x + inset, y: box.y + inset },
    { x: box.x + box.w / 2, y: box.y + inset },
    { x: box.x + box.w - inset, y: box.y + inset },
    { x: box.x + inset, y: box.y + box.h / 2 },
    { x: box.x + box.w - inset, y: box.y + box.h / 2 },
    { x: box.x + inset, y: box.y + box.h - inset },
    { x: box.x + box.w / 2, y: box.y + box.h - inset },
    { x: box.x + box.w - inset, y: box.y + box.h - inset },
  ]
  // The freehand stroke is already used for candidate scoring below. Feeding
  // many negatives along that same stroke makes EdgeSAM erode thin but valid
  // parts (vase bases and table legs). Only retain a few unambiguous far-corner
  // negatives so they disambiguate the background without acting as a cutter.
  const outsideCorners = cornerCandidates.filter((point) => !pointInPolygon(point, path))
  return outsideCorners.filter((_, index) => index % 2 === 0).slice(0, 4)
}

function buildPositivePrompts(path: Point[], box: Box): Point[] {
  const fallback = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const center = polygonCenter(path, fallback)
  const candidates: Point[] = [center]
  if (box.w > box.h * 1.3) {
    candidates.push(
      { x: box.x + box.w * 0.3, y: center.y },
      { x: box.x + box.w * 0.7, y: center.y },
    )
  } else if (box.h > box.w * 1.3) {
    candidates.push(
      { x: center.x, y: box.y + box.h * 0.3 },
      { x: center.x, y: box.y + box.h * 0.7 },
    )
  }
  const inside = candidates.filter((point) => pointInPolygon(point, path))
  return inside.length > 0 ? inside : [fallback]
}

function buildBoundaryPositivePromptSets(path: Point[], box: Box): Point[][] {
  const fallback = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  if (path.length < 4) return [[fallback]]
  const center = polygonCenter(path, fallback)
  const extremaPairs = [
    [
      path.reduce((best, point) => point.y < best.y ? point : best, path[0]),
      path.reduce((best, point) => point.y > best.y ? point : best, path[0]),
    ],
    [
      path.reduce((best, point) => point.x < best.x ? point : best, path[0]),
      path.reduce((best, point) => point.x > best.x ? point : best, path[0]),
    ],
  ]
  const insetDistance = clamp(Math.min(box.w, box.h) * 0.14, 10, 24)
  const promptSets = extremaPairs.map((pair) => pair.map((point) => {
      const dx = center.x - point.x
      const dy = center.y - point.y
      const length = Math.max(1, Math.hypot(dx, dy))
      return {
        x: point.x + dx / length * insetDistance,
        y: point.y + dy / length * insetDistance,
      }
    }).filter((point) => pointInPolygon(point, path)))
    .filter((points) => points.length === 2)
  const [verticalPrompts, horizontalPrompts] = promptSets
  if (box.h > box.w * 1.25 && verticalPrompts) return [verticalPrompts]
  if (box.w > box.h * 1.25 && horizontalPrompts) {
    return verticalPrompts ? [horizontalPrompts, verticalPrompts] : [horizontalPrompts]
  }
  return promptSets.length > 0 ? promptSets : [[center]]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function polygonArea(path: Point[]): number {
  if (path.length < 3) return 0
  let twiceArea = 0
  for (let index = 0; index < path.length; index++) {
    const current = path[index]
    const next = path[(index + 1) % path.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(twiceArea) / 2
}

function expandBox(box: Box, frame: PreparedFrame): Box {
  // Decode with the user's tight box, but render with a little more breathing
  // room. Previously a valid mask continuing beyond the 20px gesture padding
  // was cut off, which turned sofas and beds into visibly incomplete stickers.
  const margin = clamp(Math.min(box.w, box.h) * 0.14, 18, 42)
  const left = Math.max(0, box.x - margin)
  const top = Math.max(0, box.y - margin)
  const right = Math.min(frame.screenWidth, box.x + box.w + margin)
  const bottom = Math.min(frame.screenHeight, box.y + box.h + margin)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function smoothClosedPath(points: Point[]): string {
  if (points.length < 3) return ''
  const sampleStep = Math.max(1, Math.ceil(points.length / 24))
  const sampled = points.filter((_, index) => index % sampleStep === 0)
  if (sampled.length < 3) return ''
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const firstMid = midpoint(sampled[sampled.length - 1], sampled[0])
  const commands = [`M ${firstMid.x.toFixed(1)} ${firstMid.y.toFixed(1)}`]
  for (let index = 0; index < sampled.length; index++) {
    const point = sampled[index]
    const next = sampled[(index + 1) % sampled.length]
    const mid = midpoint(point, next)
    commands.push(`Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}`)
  }
  commands.push('Z')
  return commands.join(' ')
}

function findExteriorTransparency(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const paddedWidth = width + 2
  const paddedHeight = height + 2
  const visited = new Uint8Array(paddedWidth * paddedHeight)
  const queue = new Int32Array(paddedWidth * paddedHeight)
  let head = 0
  let tail = 0
  visited[0] = 1
  queue[tail++] = 0

  const isSubject = (paddedX: number, paddedY: number) => {
    const x = paddedX - 1
    const y = paddedY - 1
    return x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] > 127
  }
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= paddedWidth || y >= paddedHeight) return
    const index = y * paddedWidth + x
    if (visited[index] || isSubject(x, y)) return
    visited[index] = 1
    queue[tail++] = index
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % paddedWidth
    const y = Math.floor(index / paddedWidth)
    visit(x - 1, y)
    visit(x + 1, y)
    visit(x, y - 1)
    visit(x, y + 1)
  }

  const exterior = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      exterior[y * width + x] = visited[(y + 1) * paddedWidth + x + 1]
    }
  }
  return exterior
}

function fillSmallInteriorHoles(alpha: Uint8Array, width: number, height: number): void {
  const exterior = findExteriorTransparency(alpha, width, height)
  const visited = new Uint8Array(alpha.length)
  const queue = new Int32Array(alpha.length)
  const foregroundArea = alpha.reduce((sum, value) => sum + (value > 127 ? 1 : 0), 0)
  // Repair decoder pinholes and short tears, while retaining real openings in
  // chair backs and between table legs. The cap keeps this conservative on a
  // large bed/sofa mask.
  const maxHoleArea = Math.round(clamp(foregroundArea * 0.0025, 28, 900))

  for (let start = 0; start < alpha.length; start++) {
    if (visited[start] || exterior[start] || alpha[start] > 127) continue
    let head = 0
    let tail = 0
    visited[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const next of neighbours) {
        if (next < 0 || visited[next] || exterior[next] || alpha[next] > 127) continue
        visited[next] = 1
        queue[tail++] = next
      }
    }
    if (tail > maxHoleArea) continue
    for (let index = 0; index < tail; index++) alpha[queue[index]] = 255
  }
}

function keepPromptedSubjects(
  alpha: Uint8Array,
  width: number,
  height: number,
  anchors: Point[],
  intentPath: Point[],
): void {
  // Label only the confident mask core. Low-alpha antialiasing often forms a
  // faint bridge between two neighbouring objects and used to merge them into
  // one component (for example, a vase and the picture frame beside it).
  const componentAlphaThreshold = 96
  const labels = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  const componentSizes: number[] = [0]
  const componentBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  ]
  let component = 0

  for (let start = 0; start < alpha.length; start++) {
    if (alpha[start] <= componentAlphaThreshold || labels[start] !== 0) continue
    component += 1
    let head = 0
    let tail = 0
    let size = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    labels[start] = component
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]
      size += 1
      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
          const next = nextY * width + nextX
          if (alpha[next] <= componentAlphaThreshold || labels[next] !== 0) continue
          labels[next] = component
          queue[tail++] = next
        }
      }
    }
    componentSizes[component] = size
    componentBounds[component] = { minX, minY, maxX, maxY }
  }

  if (component === 0) return
  const componentTouchesIntent = new Uint8Array(componentSizes.length)
  for (let index = 1; index < componentSizes.length; index++) {
    const bounds = componentBounds[index]
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const samples = [
      { x: centerX, y: centerY },
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: centerX, y: bounds.minY },
      { x: centerX, y: bounds.maxY },
      { x: bounds.minX, y: centerY },
      { x: bounds.maxX, y: centerY },
    ]
    if (samples.some((point) => pointInPolygon(point, intentPath))) {
      componentTouchesIntent[index] = 1
    }
  }
  const anchorHits = new Int32Array(componentSizes.length)
  for (const anchor of anchors) {
    const centerX = clamp(Math.round(anchor.x), 0, width - 1)
    const centerY = clamp(Math.round(anchor.y), 0, height - 1)
    let closestLabel = labels[centerY * width + centerX]
    let closestDistance = Number.POSITIVE_INFINITY
    if (!closestLabel) {
      // A prompt may land on a one-pixel antialiased gap, but it must not jump
      // across the scene and adopt a nearby unselected object.
      const searchRadius = 8
      for (let y = Math.max(0, centerY - searchRadius); y <= Math.min(height - 1, centerY + searchRadius); y++) {
        for (let x = Math.max(0, centerX - searchRadius); x <= Math.min(width - 1, centerX + searchRadius); x++) {
          const label = labels[y * width + x]
          if (!label) continue
          const distance = (x - centerX) ** 2 + (y - centerY) ** 2
          if (distance > searchRadius ** 2) continue
          if (distance < closestDistance) {
            closestDistance = distance
            closestLabel = label
          }
        }
      }
    }
    if (closestLabel) anchorHits[closestLabel] += 1
  }

  let primary = 1
  for (let index = 2; index < componentSizes.length; index++) {
    if (
      anchorHits[index] > anchorHits[primary]
      || (
        anchorHits[index] === anchorHits[primary]
        && (
          componentTouchesIntent[index] > componentTouchesIntent[primary]
          || (
            componentTouchesIntent[index] === componentTouchesIntent[primary]
            && componentSizes[index] > componentSizes[primary]
          )
        )
      )
    ) primary = index
  }

  // Preserve nearby object parts such as a vase base or table legs even when
  // the threshold splits them from the main component. A large secondary area
  // (typically rug/wall) is still rejected unless a positive prompt reached it.
  const keptComponents = new Uint8Array(componentSizes.length)
  const primaryBounds = componentBounds[primary]
  const primarySize = componentSizes[primary]
  // Detached pieces must be almost touching the anchored subject. The old
  // 12–30px allowance was wide enough to adopt a neighbouring picture, shelf
  // or rug. At the 2x mask scale, 3–8px still repairs tiny SAM seams while
  // keeping genuinely separate objects out.
  const nearbyGap = clamp(Math.sqrt(primarySize) * 0.055, 3, 8)
  const primaryWidth = primaryBounds.maxX - primaryBounds.minX + 1
  for (let index = 1; index < componentSizes.length; index++) {
    const bounds = componentBounds[index]
    const gapX = Math.max(0, primaryBounds.minX - bounds.maxX, bounds.minX - primaryBounds.maxX)
    const gapY = Math.max(0, primaryBounds.minY - bounds.maxY, bounds.minY - primaryBounds.maxY)
    const closeToPrimary = Math.hypot(gapX, gapY) <= nearbyGap
    const partWidth = bounds.maxX - bounds.minX + 1
    const partHeight = bounds.maxY - bounds.minY + 1
    const overlapX = Math.max(
      0,
      Math.min(primaryBounds.maxX, bounds.maxX) - Math.max(primaryBounds.minX, bounds.minX) + 1,
    )
    const alignedBelow = bounds.minY >= primaryBounds.minY
      && overlapX >= Math.min(primaryWidth, partWidth) * 0.55
    // Detached object parts are usually narrower than the main body and sit
    // below/alongside it (pot, feet, table legs). Wide shallow regions behind
    // the object are much more likely to be a rug, shelf or wall.
    const partLikeShape = partWidth <= primaryWidth * 0.68
      || partHeight >= partWidth * 0.72
    const relatedPart = closeToPrimary
      && alignedBelow
      && partLikeShape
      && componentTouchesIntent[index] > 0
      && componentSizes[index] >= Math.max(16, primarySize * 0.002)
      && componentSizes[index] <= primarySize * 0.35
    const anchoredSubject = anchorHits[index] > 0
      && componentTouchesIntent[index] > 0
      && componentSizes[index] >= 24
    if (
      index === primary
      || anchoredSubject
      || relatedPart
    ) keptComponents[index] = 1
  }

  for (let index = 0; index < alpha.length; index++) {
    if (!keptComponents[labels[index]]) alpha[index] = 0
  }
}

function smoothAlphaContour(alpha: Uint8Array, width: number, height: number): void {
  // EdgeSAM's 256px mask is enlarged for the sticker, so its pixel staircase
  // otherwise becomes a visible crayon-like wobble. A small separable Gaussian
  // pass at the 2x render resolution removes that staircase without rounding
  // away thin stems or furniture legs.
  const kernel = [1, 4, 6, 4, 1] as const
  const kernelSum = 16
  const horizontal = new Float32Array(alpha.length)
  const blurred = new Float32Array(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let offset = -2; offset <= 2; offset++) {
        const sampleX = clamp(x + offset, 0, width - 1)
        sum += alpha[y * width + sampleX] * kernel[offset + 2]
      }
      horizontal[y * width + x] = sum / kernelSum
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let offset = -2; offset <= 2; offset++) {
        const sampleY = clamp(y + offset, 0, height - 1)
        sum += horizontal[sampleY * width + x] * kernel[offset + 2]
      }
      blurred[y * width + x] = sum / kernelSum
    }
  }
  for (let index = 0; index < alpha.length; index++) {
    const normalized = clamp((blurred[index] / 255 - 0.16) / 0.56, 0, 1)
    const eased = normalized * normalized * (3 - 2 * normalized)
    alpha[index] = Math.round(eased * 255)
  }
}

type RenderedCandidate = Omit<EdgeSamResult, 'elapsedMs'> & {
  qualityScore: number
  finalInsidePrecision: number
  renderEdgeTouch: number
}

function renderCutout(
  frame: PreparedFrame,
  mask: ort.Tensor,
  candidateIndex: number,
  modelScore: number,
  box: Box,
  anchors: Point[],
  path: Point[],
  pathMask: Uint8Array,
): RenderedCandidate | null {
  const outputWidth = Math.max(1, Math.round(box.w * STICKER_RENDER_SCALE))
  const outputHeight = Math.max(1, Math.round(box.h * STICKER_RENDER_SCALE))
  const logits = mask.data as Float32Array
  const dims = mask.dims
  const maskHeight = Number(dims[dims.length - 2])
  const maskWidth = Number(dims[dims.length - 1])
  const maskSize = maskWidth * maskHeight
  const maskOffset = candidateIndex * maskSize
  if (maskOffset + maskSize > logits.length) return null
  const xScale = frame.contentWidth / frame.screenWidth
  const yScale = frame.contentHeight / frame.screenHeight
  const alpha = new Uint8Array(outputWidth * outputHeight)
  let minX = outputWidth
  let minY = outputHeight
  let maxX = -1
  let maxY = -1
  const boundary: Point[] = []
  let rawForeground = 0
  let rawInside = 0
  let constrainedForeground = 0
  let constraintArea = 0
  const sampleLogit = (screenX: number, screenY: number) => {
    const modelX = clamp(screenX * xScale, 0, frame.contentWidth - 1)
      / frame.modelWidth * maskWidth
    const modelY = clamp(screenY * yScale, 0, frame.contentHeight - 1)
      / frame.modelHeight * maskHeight
    const x0 = Math.floor(modelX)
    const y0 = Math.floor(modelY)
    const x1 = Math.min(maskWidth - 1, x0 + 1)
    const y1 = Math.min(maskHeight - 1, y0 + 1)
    const tx = modelX - x0
    const ty = modelY - y0
    const top = logits[maskOffset + y0 * maskWidth + x0] * (1 - tx)
      + logits[maskOffset + y0 * maskWidth + x1] * tx
    const bottom = logits[maskOffset + y1 * maskWidth + x0] * (1 - tx)
      + logits[maskOffset + y1 * maskWidth + x1] * tx
    return top * (1 - ty) + bottom * ty
  }
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const screenX = box.x + (x + 0.5) / STICKER_RENDER_SCALE
      const screenY = box.y + (y + 0.5) / STICKER_RENDER_SCALE
      const logit = sampleLogit(screenX, screenY)
      const edge = clamp((logit + 0.38) / 0.76, 0, 1)
      const softened = edge * edge * (3 - 2 * edge)
      const rawAlpha = Math.round(softened * 255)
      const insidePath = pathMask[y * outputWidth + x] > 0
      if (insidePath) constraintArea += 1
      if (rawAlpha > 127) {
        rawForeground += 1
        if (insidePath) rawInside += 1
      }
      // The lasso expresses user intent and ranks EdgeSAM candidates; it must
      // never become a hard pixel crop. Let the semantic mask recover a vase
      // base or table leg just outside an imperfect hand stroke.
      const alphaValue = rawAlpha
      alpha[y * outputWidth + x] = alphaValue
      if (alphaValue > 12) {
        if (alphaValue > 127 && insidePath) constrainedForeground += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  keepPromptedSubjects(
    alpha,
    outputWidth,
    outputHeight,
    anchors.map((point) => ({
      x: (point.x - box.x) * STICKER_RENDER_SCALE,
      y: (point.y - box.y) * STICKER_RENDER_SCALE,
    })),
    path.map((point) => ({
      x: (point.x - box.x) * STICKER_RENDER_SCALE,
      y: (point.y - box.y) * STICKER_RENDER_SCALE,
    })),
  )
  fillSmallInteriorHoles(alpha, outputWidth, outputHeight)
  smoothAlphaContour(alpha, outputWidth, outputHeight)
  minX = outputWidth
  minY = outputHeight
  maxX = -1
  maxY = -1
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      if (alpha[y * outputWidth + x] <= 12) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  const exteriorTransparency = findExteriorTransparency(alpha, outputWidth, outputHeight)

  const isOpaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < outputWidth && y < outputHeight && alpha[y * outputWidth + x] > 127
  for (let y = minY; y <= maxY; y += 4) {
    for (let x = minX; x <= maxX; x += 4) {
      if (!isOpaque(x, y)) continue
      if (!isOpaque(x - 4, y) || !isOpaque(x + 4, y) || !isOpaque(x, y - 4) || !isOpaque(x, y + 4)) {
        boundary.push({
          x: box.x + x / STICKER_RENDER_SCALE,
          y: box.y + y / STICKER_RENDER_SCALE,
        })
      }
    }
  }

  const tightWidth = maxX - minX + 1
  const tightHeight = maxY - minY + 1
  const stickerPadding = 10 * STICKER_RENDER_SCALE
  const sticker = document.createElement('canvas')
  sticker.width = tightWidth + stickerPadding * 2
  sticker.height = tightHeight + stickerPadding * 2
  const stickerContext = sticker.getContext('2d', { willReadFrequently: true })
  if (!stickerContext) throw new Error('Unable to render EdgeSAM sticker')
  const sourceScaleX = frame.sourceCanvas.width / frame.screenWidth
  const sourceScaleY = frame.sourceCanvas.height / frame.screenHeight
  stickerContext.drawImage(
    frame.sourceCanvas,
    (box.x + minX / STICKER_RENDER_SCALE) * sourceScaleX,
    (box.y + minY / STICKER_RENDER_SCALE) * sourceScaleY,
    tightWidth / STICKER_RENDER_SCALE * sourceScaleX,
    tightHeight / STICKER_RENDER_SCALE * sourceScaleY,
    stickerPadding,
    stickerPadding,
    tightWidth,
    tightHeight,
  )
  const pixels = stickerContext.getImageData(stickerPadding, stickerPadding, tightWidth, tightHeight)
  for (let y = 0; y < tightHeight; y++) {
    for (let x = 0; x < tightWidth; x++) {
      pixels.data[(y * tightWidth + x) * 4 + 3] = alpha[(minY + y) * outputWidth + minX + x]
    }
  }
  stickerContext.clearRect(0, 0, sticker.width, sticker.height)
  const rawCutout = document.createElement('canvas')
  rawCutout.width = sticker.width
  rawCutout.height = sticker.height
  const rawContext = rawCutout.getContext('2d')
  if (!rawContext) throw new Error('Unable to render EdgeSAM source cutout')
  rawContext.putImageData(pixels, stickerPadding, stickerPadding)

  const whiteSilhouette = document.createElement('canvas')
  whiteSilhouette.width = sticker.width
  whiteSilhouette.height = sticker.height
  const whiteContext = whiteSilhouette.getContext('2d')
  if (!whiteContext) throw new Error('Unable to render EdgeSAM sticker border')
  whiteContext.drawImage(rawCutout, 0, 0)
  whiteContext.globalCompositeOperation = 'source-in'
  whiteContext.fillStyle = '#ffffff'
  whiteContext.fillRect(0, 0, whiteSilhouette.width, whiteSilhouette.height)
  whiteContext.globalCompositeOperation = 'source-over'

  // Keep the sticker feel without covering the real object edge. This is 25%
  // slimmer than the previous 5.25px border.
  const borderRadius = 3.94 * STICKER_RENDER_SCALE
  // Dense radial sampling makes the expanded outline a continuous ribbon
  // instead of a chain of offset silhouettes with visible scallops.
  const outlineSamples = 24
  for (let index = 0; index < outlineSamples; index++) {
    const angle = index / outlineSamples * Math.PI * 2
    const offsetX = Math.cos(angle) * borderRadius
    const offsetY = Math.sin(angle) * borderRadius
    stickerContext.drawImage(whiteSilhouette, offsetX, offsetY)
    if (index % 2 === 0) {
      stickerContext.drawImage(whiteSilhouette, offsetX * 0.55, offsetY * 0.55)
    }
  }
  const outlinedPixels = stickerContext.getImageData(0, 0, sticker.width, sticker.height)
  for (let y = 0; y < tightHeight; y++) {
    for (let x = 0; x < tightWidth; x++) {
      const sourceIndex = (minY + y) * outputWidth + minX + x
      if (alpha[sourceIndex] > 127 || exteriorTransparency[sourceIndex]) continue
      const stickerIndex = ((stickerPadding + y) * sticker.width + stickerPadding + x) * 4 + 3
      outlinedPixels.data[stickerIndex] = 0
    }
  }
  stickerContext.putImageData(outlinedPixels, 0, 0)
  stickerContext.drawImage(rawCutout, 0, 0)

  const hull = convexHull(boundary)
  const center = hull.length
    ? hull.reduce((sum, point) => ({ x: sum.x + point.x / hull.length, y: sum.y + point.y / hull.length }), { x: 0, y: 0 })
    : { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const expandedHull = hull.map((point) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const length = Math.max(1, Math.hypot(dx, dy))
    return { x: point.x + dx / length * 9, y: point.y + dy / length * 9 }
  })
  const finalForeground = alpha.reduce((sum, value) => sum + (value > 127 ? 1 : 0), 0)
  let finalInsideForeground = 0
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      if (alpha[y * outputWidth + x] <= 127) continue
      if (pathMask[y * outputWidth + x] > 0) finalInsideForeground += 1
    }
  }
  let renderEdgeOpaque = 0
  let renderEdgeSamples = 0
  const countRenderEdge = (x: number, y: number) => {
    renderEdgeSamples += 1
    if (alpha[y * outputWidth + x] > 127) renderEdgeOpaque += 1
  }
  for (let x = 0; x < outputWidth; x++) {
    countRenderEdge(x, 0)
    countRenderEdge(x, outputHeight - 1)
  }
  for (let y = 1; y < outputHeight - 1; y++) {
    countRenderEdge(0, y)
    countRenderEdge(outputWidth - 1, y)
  }
  const finalInsidePrecision = finalForeground > 0 ? finalInsideForeground / finalForeground : 0
  const renderEdgeTouch = renderEdgeSamples > 0 ? renderEdgeOpaque / renderEdgeSamples : 0
  const insidePrecision = rawForeground > 0 ? rawInside / rawForeground : 0
  const constraintCoverage = constraintArea > 0 ? finalForeground / constraintArea : 0
  const retainedRatio = rawForeground > 0 ? constrainedForeground / rawForeground : 0
  const anchorCoverage = anchors.reduce((hits, anchor) => {
    const x = clamp(Math.round((anchor.x - box.x) * STICKER_RENDER_SCALE), 0, outputWidth - 1)
    const y = clamp(Math.round((anchor.y - box.y) * STICKER_RENDER_SCALE), 0, outputHeight - 1)
    return hits + (alpha[y * outputWidth + x] > 24 ? 1 : 0)
  }, 0) / Math.max(1, anchors.length)
  const qualityScore = modelScore * 1.25
    + insidePrecision * 1.4
    + finalInsidePrecision * 1.15
    + Math.min(1, constraintCoverage / 0.52) * 0.85
    + Math.min(1, retainedRatio / 0.72) * 0.45
    + anchorCoverage * 0.65
    - renderEdgeTouch * 2.8

  return {
    dataUrl: sticker.toDataURL('image/png'),
    box: {
      x: box.x + minX / STICKER_RENDER_SCALE - stickerPadding / STICKER_RENDER_SCALE,
      y: box.y + minY / STICKER_RENDER_SCALE - stickerPadding / STICKER_RENDER_SCALE,
      w: sticker.width / STICKER_RENDER_SCALE,
      h: sticker.height / STICKER_RENDER_SCALE,
    },
    outlinePath: smoothClosedPath(expandedHull),
    qualityScore,
    finalInsidePrecision,
    renderEdgeTouch,
  }
}

type PromptSet = { points: Point[]; labels: number[] }

function buildPromptSet(
  frame: PreparedFrame,
  box: Box,
  positivePoints: Point[],
  negativePoints: Point[],
): { coordinates: Float32Array; labels: Float32Array } {
  const sx = frame.contentWidth / frame.screenWidth
  const sy = frame.contentHeight / frame.screenHeight
  const points = [...positivePoints, ...negativePoints]
  const prompt: PromptSet = {
    points: [
      ...points,
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
    ],
    labels: [
      ...positivePoints.map(() => 1),
      ...negativePoints.map(() => 0),
      2,
      3,
    ],
  }
  const coordinates = prompt.points.flatMap((point) => [
    clamp(point.x * sx, 0, frame.contentWidth - 1),
    clamp(point.y * sy, 0, frame.contentHeight - 1),
  ])
  return {
    coordinates: new Float32Array(coordinates),
    labels: new Float32Array(prompt.labels),
  }
}

async function decodeCandidates(
  decoder: ort.InferenceSession,
  frame: PreparedFrame,
  prompt: { coordinates: Float32Array; labels: Float32Array },
): Promise<{ masks: ort.Tensor; scores: number[] }> {
  const pointCount = prompt.labels.length
  const result = await decoder.run({
    image_embeddings: frame.embedding,
    point_coords: new ort.Tensor('float32', prompt.coordinates, [1, pointCount, 2]),
    point_labels: new ort.Tensor('float32', prompt.labels, [1, pointCount]),
  })
  const masks = result.masks
  if (!masks) throw new Error('EdgeSAM decoder returned no masks')
  const scoresTensor = result.scores
  const scores = scoresTensor
    ? Array.from(scoresTensor.data as Float32Array, (value) => Number(value))
    : []
  return { masks, scores }
}

type CandidateMetrics = {
  score: number
  modelScore: number
  precision: number
  coverage: number
  boundaryFit: number
  anchorCoverage: number
  renderSpill: number
  renderEdgeTouch: number
  screenEdgeTouch: number
  areaRatio: number
}

type DecodedSet = {
  decoded: { masks: ort.Tensor; scores: number[] }
  positivePrompts: Point[]
}

function scoreMaskCandidate(
  frame: PreparedFrame,
  masks: ort.Tensor,
  candidateIndex: number,
  modelScore: number,
  box: Box,
  renderBox: Box,
  anchors: Point[],
  path: Point[],
): CandidateMetrics {
  const logits = masks.data as Float32Array
  const dims = masks.dims
  const maskHeight = Number(dims[dims.length - 2])
  const maskWidth = Number(dims[dims.length - 1])
  const maskSize = maskWidth * maskHeight
  const maskOffset = candidateIndex * maskSize
  const xScale = frame.contentWidth / frame.screenWidth
  const yScale = frame.contentHeight / frame.screenHeight
  const sampleLogit = (screenX: number, screenY: number) => {
    const x = clamp(
      Math.round(screenX * xScale / frame.modelWidth * maskWidth),
      0,
      maskWidth - 1,
    )
    const y = clamp(
      Math.round(screenY * yScale / frame.modelHeight * maskHeight),
      0,
      maskHeight - 1,
    )
    return logits[maskOffset + y * maskWidth + x]
  }

  // Score the whole displayed frame. The old implementation only inspected a
  // small margin around the lasso, so a mask could keep growing into the bed,
  // rug or floor outside that window and still rank first.
  let insideSamples = 0
  let insideForeground = 0
  let totalForeground = 0
  let foregroundOutsideRenderBox = 0
  const step = Math.max(3, Math.round(Math.min(frame.screenWidth, frame.screenHeight) / 112))
  for (let y = step / 2; y < frame.screenHeight; y += step) {
    for (let x = step / 2; x < frame.screenWidth; x += step) {
      const inside = pointInPolygon({ x, y }, path)
      const foreground = sampleLogit(x, y) > 0
      if (inside) {
        insideSamples += 1
        if (foreground) insideForeground += 1
      }
      if (!foreground) continue
      totalForeground += 1
      if (
        x < renderBox.x
        || y < renderBox.y
        || x > renderBox.x + renderBox.w
        || y > renderBox.y + renderBox.h
      ) foregroundOutsideRenderBox += 1
    }
  }
  const coverage = insideSamples > 0 ? insideForeground / insideSamples : 0
  const precision = totalForeground > 0 ? insideForeground / totalForeground : 0
  const anchorCoverage = anchors.reduce(
    (hits, anchor) => hits + (sampleLogit(anchor.x, anchor.y) > 0 ? 1 : 0),
    0,
  ) / Math.max(1, anchors.length)

  // A lasso describes an intended boundary, not simply an area to fill. Reward
  // masks that are foreground just inside the stroke and background just
  // outside it. This stops a large rug behind a table winning only by area.
  const center = polygonCenter(path, { x: box.x + box.w / 2, y: box.y + box.h / 2 })
  const boundaryStep = Math.max(1, Math.ceil(path.length / 24))
  let boundarySamples = 0
  let boundaryMatches = 0
  for (let index = 0; index < path.length; index += boundaryStep) {
    const point = path[index]
    const dx = center.x - point.x
    const dy = center.y - point.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const ux = dx / length
    const uy = dy / length
    let insideHit = false
    let outsideClean = 0
    let outsideChecks = 0
    for (let distance = 4; distance <= 20; distance += 4) {
      if (sampleLogit(point.x + ux * distance, point.y + uy * distance) > 0) insideHit = true
      outsideClean += sampleLogit(point.x - ux * distance, point.y - uy * distance) <= 0 ? 1 : 0
      outsideChecks += 1
    }
    boundarySamples += 1
    if (insideHit) boundaryMatches += outsideClean / Math.max(1, outsideChecks)
  }
  const boundaryFit = boundarySamples > 0 ? boundaryMatches / boundarySamples : 0
  const renderSpill = totalForeground > 0 ? foregroundOutsideRenderBox / totalForeground : 1
  const lassoArea = Math.max(step * step, polygonArea(path))
  const areaRatio = totalForeground * step * step / lassoArea

  // A mask touching much of the expanded render box is very likely to be
  // clipped. This is the exact visual failure that produced the incomplete,
  // rectangular-looking outline in the report.
  let renderEdgeForeground = 0
  let renderEdgeSamples = 0
  const sampleRenderEdge = (x: number, y: number) => {
    renderEdgeSamples += 1
    if (sampleLogit(x, y) > 0) renderEdgeForeground += 1
  }
  for (let x = renderBox.x; x <= renderBox.x + renderBox.w; x += step) {
    sampleRenderEdge(x, renderBox.y)
    sampleRenderEdge(x, renderBox.y + renderBox.h)
  }
  for (let y = renderBox.y + step; y < renderBox.y + renderBox.h; y += step) {
    sampleRenderEdge(renderBox.x, y)
    sampleRenderEdge(renderBox.x + renderBox.w, y)
  }
  const renderEdgeTouch = renderEdgeSamples > 0 ? renderEdgeForeground / renderEdgeSamples : 0
  let screenEdgeForeground = 0
  let screenEdgeSamples = 0
  const sampleScreenEdge = (x: number, y: number) => {
    screenEdgeSamples += 1
    if (sampleLogit(x, y) > 0) screenEdgeForeground += 1
  }
  for (let x = 0; x < frame.screenWidth; x += step) {
    sampleScreenEdge(x, 0)
    sampleScreenEdge(x, frame.screenHeight - 1)
  }
  for (let y = step; y < frame.screenHeight - step; y += step) {
    sampleScreenEdge(0, y)
    sampleScreenEdge(frame.screenWidth - 1, y)
  }
  const screenEdgeTouch = screenEdgeSamples > 0 ? screenEdgeForeground / screenEdgeSamples : 0
  // Precision matters more than filling every pixel of a deliberately loose
  // hand circle. This F-score therefore favours a clean contained subject over
  // a large background region that happens to cover the whole circle.
  const betaSquared = 0.55
  const intentFit = precision + coverage > 0
    ? (1 + betaSquared) * precision * coverage / (betaSquared * precision + coverage)
    : 0
  const oversizePenalty = Math.max(0, areaRatio - 1.45)
  const score = modelScore * 0.78
    + intentFit * 2.05
    + precision * 0.45
    + boundaryFit * 0.78
    + anchorCoverage * 0.9
    + Math.min(1, coverage / 0.32) * 0.28
    - renderSpill * 1.8
    - renderEdgeTouch * 1.25
    - screenEdgeTouch * 2.4
    - oversizePenalty * 0.42

  return {
    score,
    modelScore,
    precision,
    coverage,
    boundaryFit,
    anchorCoverage,
    renderSpill,
    renderEdgeTouch,
    screenEdgeTouch,
    areaRatio,
  }
}

function rankCandidates(
  decodedSets: DecodedSet[],
  frame: PreparedFrame,
  box: Box,
  renderBox: Box,
  path: Point[],
) {
  return decodedSets.flatMap(({ decoded, positivePrompts }, promptSetIndex) => {
    const dims = decoded.masks.dims
    const maskSize = Number(dims[dims.length - 2]) * Number(dims[dims.length - 1])
    const candidateCount = Math.max(1, Math.floor(decoded.masks.data.length / maskSize))
    return Array.from({ length: candidateCount }, (_, index) => ({
      index,
      promptSetIndex,
      decoded,
      positivePrompts,
      metrics: scoreMaskCandidate(
        frame,
        decoded.masks,
        index,
        decoded.scores[index] ?? 0,
        box,
        renderBox,
        positivePrompts,
        path,
      ),
    }))
  }).sort((a, b) => b.metrics.score - a.metrics.score)
}

function isPlausibleCandidate(metrics: CandidateMetrics): boolean {
  return metrics.anchorCoverage >= 0.5
    && metrics.precision >= 0.36
    && metrics.coverage >= 0.07
    && metrics.renderSpill <= 0.42
    && metrics.renderEdgeTouch <= 0.3
    && metrics.screenEdgeTouch <= 0.035
}

export async function segmentWithEdgeSam(
  video: HTMLVideoElement,
  path: Point[],
  box: Box,
): Promise<EdgeSamResult | null> {
  const startedAt = performance.now()
  await prepareEdgeSamFrame(video)
  const frameReadyAt = performance.now()
  const frame = preparedFrame
  if (!frame) return null
  const decoder = await getDecoderSession()
  const renderBox = expandBox(box, frame)
  const boundaryPromptSets = buildBoundaryPositivePromptSets(path, box)
  const centerPrompts = buildPositivePrompts(path, box)
  const positivePromptSets = [
    // Multiple simultaneous positives can force EdgeSAM to merge neighbouring
    // objects (bed + blanket + bedside table). Start with one unambiguous
    // subject point; retain one boundary pair only as a completeness fallback.
    [centerPrompts[0]],
    ...boundaryPromptSets.slice(0, 1),
  ]
  const negativePrompts = buildNegativePrompts(path, box)
  const scoringPath = simplifyPathForScoring(path)
  const decodedSets: DecodedSet[] = []
  let rankedCandidates: ReturnType<typeof rankCandidates> | null = null
  for (let promptSetIndex = 0; promptSetIndex < positivePromptSets.length; promptSetIndex++) {
    const positivePrompts = positivePromptSets[promptSetIndex]
    const decoded = await decodeCandidates(
      decoder,
      frame,
      buildPromptSet(frame, box, positivePrompts, negativePrompts),
    )
    decodedSets.push({ decoded, positivePrompts })
    // The centre prompt is normally sufficient. Only pay for the boundary
    // decoder when all centre candidates fail the same quality gates used by
    // the final selector.
    if (promptSetIndex === 0) {
      const centreRanked = rankCandidates(decodedSets, frame, box, renderBox, scoringPath)
      if (centreRanked.some(({ metrics }) => isPlausibleCandidate(metrics))) {
        rankedCandidates = centreRanked
        break
      }
    }
  }
  const decodedAt = performance.now()
  rankedCandidates ??= rankCandidates(decodedSets, frame, box, renderBox, scoringPath)

  // Never surface an obviously wrong mask just because it ranked first among
  // weak candidates. Try the next plausible candidate; if none is clean enough
  // the UI asks the user to circle again instead of drawing a broken sticker.
  const plausibleCandidates = rankedCandidates.filter(({ metrics }) => isPlausibleCandidate(metrics))
  const renderWidth = Math.max(1, Math.round(renderBox.w * STICKER_RENDER_SCALE))
  const renderHeight = Math.max(1, Math.round(renderBox.h * STICKER_RENDER_SCALE))
  const pathMask = rasterizePolygonMask(path, renderBox, renderWidth, renderHeight)
  const renderedCandidates = []
  for (const candidate of plausibleCandidates.slice(0, 4)) {
    const rendered = renderCutout(
      frame,
      candidate.decoded.masks,
      candidate.index,
      candidate.decoded.scores[candidate.index] ?? 0,
      renderBox,
      candidate.positivePrompts,
      path,
      pathMask,
    )
    if (!rendered) continue
    if (rendered.finalInsidePrecision < 0.34 || rendered.renderEdgeTouch > 0.2) continue
    renderedCandidates.push({
      candidate,
      rendered,
      finalScore: candidate.metrics.score + rendered.qualityScore * 0.32,
    })
    // Candidates are already ordered by semantic and boundary quality. Stop
    // after the first one that also passes the expensive full-resolution gate.
    break
  }
  const selected = renderedCandidates[0]
  if (!selected) {
    console.info('[EdgeSAM] rejected low-quality candidates', rankedCandidates.slice(0, 3).map(({ metrics }) => ({
      score: Number(metrics.score.toFixed(3)),
      precision: Number(metrics.precision.toFixed(3)),
      coverage: Number(metrics.coverage.toFixed(3)),
      renderSpill: Number(metrics.renderSpill.toFixed(3)),
      renderEdgeTouch: Number(metrics.renderEdgeTouch.toFixed(3)),
      screenEdgeTouch: Number(metrics.screenEdgeTouch.toFixed(3)),
    })))
    return null
  }
  const { candidate, rendered: renderedCandidate } = selected
  const candidateIndex = candidate.index
  const { qualityScore, finalInsidePrecision, renderEdgeTouch, ...rendered } = renderedCandidate
  const elapsedMs = Math.round(performance.now() - startedAt)
  console.info(
    `[EdgeSAM] selected 1 of ${rankedCandidates.length} candidates in ${elapsedMs}ms`,
    {
      candidateIndex,
      promptSetIndex: candidate.promptSetIndex,
      confidenceGap: Number(((rankedCandidates[0]?.metrics.score ?? 0) - (rankedCandidates[1]?.metrics.score ?? 0)).toFixed(3)),
      qualityScore: Number(qualityScore.toFixed(3)),
      finalInsidePrecision: Number(finalInsidePrecision.toFixed(3)),
      renderEdgeTouch: Number(renderEdgeTouch.toFixed(3)),
      negativePoints: negativePrompts.length,
      frameMs: Math.round(frameReadyAt - startedAt),
      decoderMs: Math.round(decodedAt - frameReadyAt),
      postprocessMs: Math.round(performance.now() - decodedAt),
    },
  )
  return { ...rendered, elapsedMs }
}
