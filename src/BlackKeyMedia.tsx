import { useEffect, useRef, type CSSProperties } from 'react'

const RENDER_SIZE = 160
const BLACK_THRESHOLD = 86

function keyOutEdgeBlack(context: CanvasRenderingContext2D, width: number, height: number) {
  const frame = context.getImageData(0, 0, width, height)
  const pixels = frame.data
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const isEdgeBlack = (index: number) => {
    const offset = index * 4
    if (pixels[offset + 3] === 0) return true
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    return max <= BLACK_THRESHOLD && max - min <= 42
  }

  const enqueue = (index: number) => {
    if (visited[index] || !isEdgeBlack(index)) return
    visited[index] = 1
    queue[tail++] = index
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x < width - 1) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y < height - 1) enqueue(index + width)
  }

  for (let index = 0; index < visited.length; index += 1) {
    if (!visited[index]) continue
    const offset = index * 4
    const max = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    const alphaRatio = Math.max(0, Math.min(1, (max - 8) / 62))
    if (alphaRatio <= 0.02) {
      pixels[offset + 3] = 0
      continue
    }
    // 黑底混色边缘先反算回原色，再降低透明度，避免留下黑色描边。
    pixels[offset] = Math.min(255, pixels[offset] / alphaRatio)
    pixels[offset + 1] = Math.min(255, pixels[offset + 1] / alphaRatio)
    pixels[offset + 2] = Math.min(255, pixels[offset + 2] / alphaRatio)
    pixels[offset + 3] = Math.round(pixels[offset + 3] * alphaRatio)
  }

  context.putImageData(frame, 0, 0)
}

function drawContained(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.min(RENDER_SIZE / sourceWidth, RENDER_SIZE / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const x = (RENDER_SIZE - width) / 2
  const y = (RENDER_SIZE - height) / 2
  context.clearRect(0, 0, RENDER_SIZE, RENDER_SIZE)
  context.drawImage(source, x, y, width, height)
  keyOutEdgeBlack(context, RENDER_SIZE, RENDER_SIZE)
}

interface BlackKeyVideoProps {
  src: string
  loop: boolean
  className?: string
  style?: CSSProperties
  preload?: 'none' | 'metadata' | 'auto'
  onEnded?: () => void
  onError?: () => void
}

export function BlackKeyVideo({ src, loop, className, style, preload = 'metadata', onEnded, onError }: BlackKeyVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!video || !canvas || !context) return
    let frameId = 0
    let stopped = false

    const render = () => {
      if (stopped) return
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        drawContained(context, video, video.videoWidth, video.videoHeight)
      }
      frameId = window.requestAnimationFrame(render)
    }

    render()
    void video.play().catch(() => {})
    return () => {
      stopped = true
      window.cancelAnimationFrame(frameId)
    }
  }, [src])

  return (
    <span className={className} style={style}>
      <video
        ref={videoRef}
        className="black-key-source"
        src={src}
        autoPlay
        muted
        playsInline
        loop={loop}
        preload={preload}
        onEnded={onEnded}
        onError={onError}
      />
      <canvas ref={canvasRef} className="black-key-canvas" width={RENDER_SIZE} height={RENDER_SIZE} />
    </span>
  )
}

interface BlackKeyImageProps {
  src: string
  alt: string
  className?: string
}

export function BlackKeyImage({ src, alt, className }: BlackKeyImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context) return
    const image = new Image()
    image.onload = () => drawContained(context, image, image.naturalWidth, image.naturalHeight)
    image.src = src
    return () => { image.onload = null }
  }, [src])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={RENDER_SIZE}
      height={RENDER_SIZE}
      role="img"
      aria-label={alt}
    />
  )
}
