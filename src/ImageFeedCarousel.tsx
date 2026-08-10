import { useEffect, useRef, useState } from 'react'
import type { ImagePostHotspot } from './imagePostAssets'

const AUTOPLAY_MS = 4200

type Props = {
  images: string[]
  title: string
  audioSrc?: string
  playing: boolean
  onPause?: () => void
  onMediaReady?: () => void
  onIndexChange?: (index: number) => void
  hotspots?: ImagePostHotspot[]
  onHotspotActivate?: (hotspot: ImagePostHotspot) => void
}

export function ImageFeedCarousel({
  images,
  title,
  audioSrc,
  playing,
  onPause,
  onMediaReady,
  onIndexChange,
  hotspots = [],
  onHotspotActivate,
}: Props) {
  const [index, setIndex] = useState(0)
  const [loadedImage, setLoadedImage] = useState<string | null>(null)
  const [audioPaused, setAudioPaused] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const suppressPauseClick = useRef(false)
  const readyReported = useRef(false)
  const audioActive = playing && !audioPaused
  const activeImage = images[index]
  const imageReady = loadedImage === activeImage
  const visibleHotspots = hotspots.filter((hotspot) => hotspot.slideIndex === index)

  useEffect(() => {
    setIndex(0)
    setLoadedImage(null)
    readyReported.current = false
  }, [images])

  useEffect(() => {
    onIndexChange?.(index)
  }, [index, onIndexChange])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audioActive) audio.play().catch(() => {})
    else audio.pause()
  }, [audioActive, audioSrc])

  useEffect(() => {
    if (!playing || images.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % images.length)
    }, AUTOPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [images.length, index, playing])

  if (images.length === 0) {
    return <div className="image-feed-empty" role="img" aria-label={`${title}原图待导入`}>原图待导入</div>
  }

  const move = (direction: 1 | -1) => {
    setIndex((current) => Math.max(0, Math.min(images.length - 1, current + direction)))
  }

  return (
    <section
      className="image-feed-carousel"
      aria-label={`${title}，第 ${index + 1} 张，共 ${images.length} 张`}
      onClick={(event) => {
        event.stopPropagation()
        if (suppressPauseClick.current) {
          suppressPauseClick.current = false
          return
        }
        if (imageReady) onPause?.()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0]
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current
        touchStart.current = null
        const touch = event.changedTouches[0]
        if (!start || !touch) return
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        if (Math.abs(dx) < 36 || Math.abs(dx) <= Math.abs(dy)) return
        event.stopPropagation()
        suppressPauseClick.current = true
        window.setTimeout(() => { suppressPauseClick.current = false }, 350)
        move(dx < 0 ? 1 : -1)
      }}
    >
      <div className="image-feed-media">
        <img
          key={activeImage}
          className={`image-feed-slide ${imageReady ? 'is-ready' : ''}`}
          src={activeImage}
          alt={`${title}，第 ${index + 1} 张`}
          crossOrigin="anonymous"
          draggable={false}
          onLoad={() => {
            setLoadedImage(activeImage)
            if (readyReported.current) return
            readyReported.current = true
            onMediaReady?.()
          }}
        />
        {imageReady && visibleHotspots.length > 0 && (
          <div className="image-feed-hotspots" aria-label={`本图可查看 ${visibleHotspots.length} 件 3D 家具`}>
            {visibleHotspots.map((hotspot) => {
              const [x, y, width, height] = hotspot.bbox
              return (
                <button
                  type="button"
                  key={`${hotspot.assetId}:${hotspot.slideIndex}`}
                  className="image-feed-hotspot"
                  style={{
                    left: `${(x + width / 2) * 100}%`,
                    top: `${(y + height / 2) * 100}%`,
                  }}
                  aria-label={`查看${hotspot.name}3D`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onHotspotActivate?.(hotspot)
                  }}
                >
                  <span className="image-feed-hotspot-halo" aria-hidden="true" />
                  <span className="image-feed-hotspot-core" aria-hidden="true" />
                  <span className="image-feed-hotspot-label">{hotspot.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="image-feed-dots" aria-label="图片页码">
        {images.map((image, dotIndex) => (
          <button
            key={`${image}-${dotIndex}`}
            type="button"
            className={`image-feed-dot ${dotIndex === index ? 'is-active' : ''}`}
            aria-label={`查看第 ${dotIndex + 1} 张`}
            aria-current={dotIndex === index ? 'true' : undefined}
            onClick={(event) => {
              event.stopPropagation()
              setIndex(dotIndex)
            }}
          />
        ))}
      </div>
      {audioSrc && (
        <>
          <button
            type="button"
            className="image-feed-audio"
            aria-label={audioActive ? "暂停背景音乐" : "播放背景音乐"}
            onClick={(event) => {
              event.stopPropagation()
              setAudioPaused(audioActive)
            }}
          >
            {audioActive ? "♫" : "♪"}
          </button>
          <audio ref={audioRef} src={audioSrc} loop preload="metadata" />
        </>
      )}
    </section>
  )
}
