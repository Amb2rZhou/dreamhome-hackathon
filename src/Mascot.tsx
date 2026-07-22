import { useCallback, useEffect, useRef, useState } from 'react'
import type { MascotState } from './types'
import { clientPointInElement } from './screenSpace'
import { BlackKeyImage, BlackKeyVideo } from './BlackKeyMedia'
import './Mascot.css'

type MotionName =
  | 'coldStart'
  | 'idle'
  | 'idleMagnifier'
  | 'idleBelt'
  | 'working'
  | 'workingHammer'
  | 'workingDrawing'
  | 'complete'

interface MotionClip {
  src: string
  loop: boolean
  scale: number
  x: number
  y: number
}

interface MascotProps {
  state: MascotState
  awaitingCollectionView: boolean
  craftStartTip: boolean
  busy: boolean
  taskCount: number
  collectionMode: CollectionMascotMode
  guideMode: 'recognize' | 'drag' | null
  progressGuideActive: boolean
  notice: string | null
  onOpenCollection: () => void
  onBeginOnboarding: () => void
  onProgressGuideOpened: () => void
  onCompletionGuideOpened: () => void
  onDismissStartTip: () => void
}

export type CollectionMascotMode = 'none' | 'collecting' | 'ready' | 'receiving'

const IDLE_ACCENT_DELAY = 10_000
const WORK_ACCENT_DELAY = 2_500
const MOTION_ASSET_ROOT = '/mascot-motion'
// 统一角色脚底基线；各段素材的轻微视觉差异在这里校准，不需要重新导出。
const MOTIONS: Record<MotionName, MotionClip> = {
  // 与《包工球交互》状态文档逐项对应；MP4 为原始 H.264 MOV 的无损换封装。
  coldStart: { src: `${MOTION_ASSET_ROOT}/cold-start.mp4`, loop: false, scale: 1, x: 0, y: 0 },
  idle: { src: `${MOTION_ASSET_ROOT}/idle.mp4`, loop: true, scale: 1, x: 0, y: 0 },
  idleMagnifier: { src: `${MOTION_ASSET_ROOT}/idle-magnifier.mp4`, loop: false, scale: 0.98, x: 1, y: 1 },
  idleBelt: { src: `${MOTION_ASSET_ROOT}/idle-belt.mp4`, loop: false, scale: 1.02, x: -1, y: 0 },
  working: { src: `${MOTION_ASSET_ROOT}/working.mp4`, loop: true, scale: 1, x: 0, y: 0 },
  workingHammer: { src: `${MOTION_ASSET_ROOT}/working-hammer.mp4`, loop: false, scale: 0.96, x: 1, y: 1 },
  workingDrawing: { src: `${MOTION_ASSET_ROOT}/working-drawing.mp4`, loop: false, scale: 0.96, x: 0, y: 1 },
  complete: { src: `${MOTION_ASSET_ROOT}/complete.mp4`, loop: true, scale: 0.98, x: 0, y: 1 },
}

const FALLBACK_IMG: Record<MascotState, string> = {
  // 动态素材真正加载失败时才使用静态兜底；待机保持清醒形象。
  sleeping: '/mascot-initial.png',
  happy: '/mascot-happy.png',
  working: '/mascot-working.png',
}

function chooseDifferent<T extends string>(options: readonly T[], previous: T | null): T {
  const available = options.filter((option) => option !== previous)
  return available[Math.floor(Math.random() * available.length)] ?? options[0]
}

function isWorkingMotion(motion: MotionName) {
  return motion === 'working' || motion === 'workingHammer' || motion === 'workingDrawing'
}

function BubbleActionCopy({
  text,
  label,
  wide = false,
  onClick,
}: {
  text: string
  label: string
  wide?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const tailLength = Math.min(5, text.length)
  const head = text.slice(0, -tailLength)
  const tail = text.slice(-tailLength)
  return (
    <div className={`mascot-bubble-copy ${wide ? 'mascot-bubble-copy-wide' : ''}`}>
      <span className="mascot-bubble-text">
        {head}<span className="mascot-bubble-cta-tail">{tail}<span className="mascot-bubble-cta-space" aria-hidden="true" /></span>
      </span>
      <span className="mascot-bubble-actions">
        <button className="mascot-bubble-btn" onClick={onClick}>{label}</button>
      </span>
    </div>
  )
}

export function Mascot({
  state,
  awaitingCollectionView,
  craftStartTip,
  busy,
  taskCount,
  collectionMode,
  guideMode,
  progressGuideActive,
  notice,
  onOpenCollection,
  onBeginOnboarding,
  onProgressGuideOpened,
  onCompletionGuideOpened,
  onDismissStartTip,
}: MascotProps) {
  const firstMotionRef = useRef<MotionName>((() => {
    if (state === 'working' || busy) return 'working'
    if (awaitingCollectionView) return 'complete'
    return 'coldStart'
  })())
  const firstMotion = firstMotionRef.current

  const [motionView, setMotionView] = useState<{ current: MotionName; previous: MotionName | null }>({
    current: firstMotion,
    previous: null,
  })
  const motion = motionView.current
  const setMotion = useCallback((next: MotionName) => {
    setMotionView((current) => current.current === next
      ? current
      : { current: next, previous: current.current })
  }, [])
  const [videoFailed, setVideoFailed] = useState(false)
  const [pos, setPos] = useState({ x: 300, y: 560 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [startTipSeen, setStartTipSeen] = useState(false)
  const [welcomeVisible, setWelcomeVisible] = useState(true)
  // 原型每次刷新都从完整冷启动开始，确保演示始终能走完五步教学。
  const welcomeTextRef = useRef('嗨，我是包工球。一起把路过的灵感，慢慢装进家里。')
  const idleTimerRef = useRef<number | null>(null)
  const lastIdleAccentRef = useRef<'idleMagnifier' | 'idleBelt' | null>(null)
  const lastWorkAccentRef = useRef<'workingHammer' | 'workingDrawing' | null>(null)
  const bootPlayingRef = useRef(firstMotion === 'coldStart')

  useEffect(() => {
    if (!motionView.previous) return
    const timer = window.setTimeout(() => {
      setMotionView((current) => ({ ...current, previous: null }))
    }, 460)
    return () => window.clearTimeout(timer)
  }, [motionView.previous])

  const baseMotion = useCallback((): MotionName => {
    if (busy || state === 'working') return 'working'
    if (awaitingCollectionView) return 'complete'
    return 'idle'
  }, [awaitingCollectionView, busy, state])

  const clearMotionTimer = useCallback(() => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = null
  }, [])

  const scheduleAccent = useCallback(() => {
    clearMotionTimer()
    if (awaitingCollectionView) return
    if (busy || state === 'working') {
      idleTimerRef.current = window.setTimeout(() => {
        const next = chooseDifferent(['workingHammer', 'workingDrawing'] as const, lastWorkAccentRef.current)
        lastWorkAccentRef.current = next
        setMotion(next)
      }, WORK_ACCENT_DELAY)
      return
    }
    idleTimerRef.current = window.setTimeout(() => {
      const next = chooseDifferent(['idleMagnifier', 'idleBelt'] as const, lastIdleAccentRef.current)
      lastIdleAccentRef.current = next
      setMotion(next)
    }, IDLE_ACCENT_DELAY)
  }, [awaitingCollectionView, busy, clearMotionTimer, setMotion, state])

  useEffect(() => {
    if (bootPlayingRef.current) {
      if (!busy && state !== 'happy') return
      bootPlayingRef.current = false
    }
    if (awaitingCollectionView) {
      clearMotionTimer()
      setMotion('complete')
      return
    }
    setMotion(baseMotion())
    scheduleAccent()
    return clearMotionTimer
  }, [awaitingCollectionView, baseMotion, busy, clearMotionTimer, scheduleAccent, setMotion, state])

  useEffect(() => {
    setVideoFailed(false)
  }, [motion])

  useEffect(() => {
    if (motion !== 'idle' && motion !== 'working') return
    scheduleAccent()
    return clearMotionTimer
  }, [clearMotionTimer, motion, scheduleAccent])

  useEffect(() => {
    const resetIdleClock = () => {
      if (motion === 'idle') scheduleAccent()
    }
    window.addEventListener('pointerdown', resetIdleClock, { passive: true })
    window.addEventListener('wheel', resetIdleClock, { passive: true })
    window.addEventListener('keydown', resetIdleClock)
    return () => {
      window.removeEventListener('pointerdown', resetIdleClock)
      window.removeEventListener('wheel', resetIdleClock)
      window.removeEventListener('keydown', resetIdleClock)
    }
  }, [motion, scheduleAccent])

  useEffect(() => {
    if (craftStartTip) setStartTipSeen(false)
  }, [craftStartTip])

  useEffect(() => {
    if (!craftStartTip || startTipSeen) return
    if (progressGuideActive) return
    const timer = window.setTimeout(
      () => { setStartTipSeen(true); onDismissStartTip() },
      3500,
    )
    return () => window.clearTimeout(timer)
  }, [craftStartTip, progressGuideActive, startTipSeen, onDismissStartTip])

  useEffect(() => {
    if (!guideMode || !welcomeVisible) return
    setWelcomeVisible(false)
  }, [guideMode, welcomeVisible])

  const dismissWelcome = () => {
    setWelcomeVisible(false)
    onBeginOnboarding()
  }

  const openWorkshopFromMascot = () => {
    onOpenCollection()
    if (awaitingCollectionView) onCompletionGuideOpened()
    else if (progressGuideActive) onProgressGuideOpened()
  }

  const onMotionEnded = () => {
    if (motion === 'coldStart') {
      bootPlayingRef.current = false
      setMotion(baseMotion())
      return
    }
    if (motion === 'complete') {
      setMotion(baseMotion())
      return
    }
    if (motion === 'idleMagnifier' || motion === 'idleBelt' || motion === 'workingHammer' || motion === 'workingDrawing') {
      setMotion(baseMotion())
    }
  }

  const onDown = (event: React.PointerEvent) => {
    if (collectionMode !== 'none') return
    const screen = document.querySelector('.screen') as HTMLElement | null
    if (!screen) return
    const point = clientPointInElement(screen, event.clientX, event.clientY)
    setDragging(true)
    dragRef.current = { ox: point.x - pos.x, oy: point.y - pos.y }
    pointerStartRef.current = { x: event.clientX, y: event.clientY, moved: false }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  const onMove = (event: React.PointerEvent) => {
    if (!dragging || !dragRef.current) return
    if (pointerStartRef.current) {
      const dx = event.clientX - pointerStartRef.current.x
      const dy = event.clientY - pointerStartRef.current.y
      if (Math.hypot(dx, dy) > 6) pointerStartRef.current.moved = true
    }
    const screen = document.querySelector('.screen') as HTMLElement
    if (!screen) return
    const point = clientPointInElement(screen, event.clientX, event.clientY)
    const nx = point.x - dragRef.current.ox
    const ny = point.y - dragRef.current.oy
    setPos({
      x: Math.max(8, Math.min(screen.offsetWidth - 88, nx)),
      y: Math.max(8, Math.min(screen.offsetHeight - 88, ny)),
    })
  }
  const onUp = () => {
    const openWorkshop = !!pointerStartRef.current && !pointerStartRef.current.moved
    pointerStartRef.current = null
    setDragging(false)
    dragRef.current = null
    setPos((current) => {
      const screen = document.querySelector('.screen') as HTMLElement
      if (!screen) return current
      const mid = screen.offsetWidth / 2
      return { x: current.x + 40 < mid ? 8 : screen.offsetWidth - 88, y: current.y }
    })
    if (openWorkshop) openWorkshopFromMascot()
  }
  const onCancel = () => {
    pointerStartRef.current = null
    dragRef.current = null
    setDragging(false)
  }

  // 完成态必须持续到用户真正进入小工坊查看；不能再被欢迎语、普通通知或计时器吞掉。
  const showCompleteBubble = awaitingCollectionView && collectionMode === 'none'
  const showStartBubble = !showCompleteBubble && craftStartTip && !startTipSeen
  const showNoticeBubble = !showCompleteBubble && !showStartBubble && !!notice && collectionMode === 'none'
  const showWelcomeBubble = !showCompleteBubble && !showStartBubble && !showNoticeBubble && welcomeVisible && !guideMode && collectionMode === 'none'
  const bubbleSide = pos.x > 225 ? 'right' : 'left'
  const clip = MOTIONS[motion]
  const previousClip = motionView.previous ? MOTIONS[motionView.previous] : null
  const processingCrossfade = !!motionView.previous
    && isWorkingMotion(motion)
    && isWorkingMotion(motionView.previous)
  const fadeDuration = processingCrossfade ? '420ms' : '240ms'

  return (
    <div
      className={`mascot-root mascot-${state} mascot-motion-${motion} mascot-collection-${collectionMode} ${awaitingCollectionView ? 'mascot-awaiting-view' : ''} ${progressGuideActive ? 'mascot-progress-guide' : ''} ${dragging ? 'dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      role={collectionMode === 'none' ? 'button' : undefined}
      tabIndex={collectionMode === 'none' ? 0 : -1}
      aria-label={collectionMode === 'none' ? '打开包工球的小工坊' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={(event) => {
        if (collectionMode !== 'none') return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openWorkshopFromMascot()
        }
      }}
      data-motion={motion}
      data-collection-mode={collectionMode}
    >
      {showCompleteBubble && (
        <div className={`mascot-bubble mascot-bubble-complete ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(event) => event.stopPropagation()}>
          <BubbleActionCopy
            text="都打造完啦，新家具迫不及待想住进你的家啦～"
            label="查看"
            onClick={(event) => { event.stopPropagation(); openWorkshopFromMascot() }}
          />
        </div>
      )}
      {showStartBubble && (
        <div className={`mascot-bubble mascot-bubble-start ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="mascot-bubble-text">开工啦！包工球正在认真制作，主人可以继续浏览，做好后我会来提醒你～</div>
        </div>
      )}
      {showNoticeBubble && notice && (
        <div className={`mascot-bubble mascot-bubble-notice ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="mascot-bubble-text">{notice}</div>
        </div>
      )}
      {showWelcomeBubble && (
        <div className={`mascot-bubble mascot-bubble-guide ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(event) => event.stopPropagation()}>
          <BubbleActionCopy
            text={welcomeTextRef.current}
            label="去逛逛"
            onClick={(event) => { event.stopPropagation(); dismissWelcome() }}
          />
        </div>
      )}
      {taskCount > 0 && collectionMode === 'none' && (
        <button
          className="mascot-task-badge"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onOpenCollection() }}
          aria-label={`查看本次收集，共 ${taskCount} 件`}
        >
          <span>{taskCount}件</span>
        </button>
      )}
      {collectionMode !== 'none' && (
        <div className="mascot-collection-tip">
          {collectionMode === 'collecting' && '打包完成，拖进小车开始加工吧。'}
          {collectionMode === 'ready' && '到我这儿啦，松手就好！'}
          {collectionMode === 'receiving' && '收到啦！'}
        </div>
      )}
      <div className={`mascot-media-frame ${collectionMode !== 'none' ? 'is-collecting' : ''}`}>
        {collectionMode !== 'none' ? (
          <BlackKeyImage
            key={collectionMode === 'collecting' ? 'collect' : 'collect-ready'}
            className="mascot-collection-figure"
            src={collectionMode === 'collecting' ? '/mascot-motion/collect.png' : '/mascot-motion/collect-ready.png'}
            alt={collectionMode === 'collecting' ? '包公球推着购物车' : '包公球准备接收家具'}
          />
        ) : !videoFailed ? (
          <>
            {motionView.previous && previousClip && (
              <BlackKeyVideo
                key={`outgoing-${motionView.previous}-${previousClip.src}`}
                className="mascot-motion-layer mascot-motion-layer--outgoing"
                src={previousClip.src}
                loop={previousClip.loop}
                preload="metadata"
                style={{
                  '--motion-scale': previousClip.scale,
                  '--motion-x': `${previousClip.x}px`,
                  '--motion-y': `${previousClip.y}px`,
                  '--fade-duration': fadeDuration,
                } as React.CSSProperties}
              />
            )}
            <BlackKeyVideo
              key={`incoming-${motion}-${clip.src}`}
              className="mascot-motion-layer mascot-motion-layer--incoming"
              src={clip.src}
              loop={clip.loop}
              preload={motion === 'idle' || motion === 'coldStart' ? 'auto' : 'metadata'}
              onEnded={onMotionEnded}
              onError={() => setVideoFailed(true)}
              style={{
                '--motion-scale': clip.scale,
                '--motion-x': `${clip.x}px`,
                '--motion-y': `${clip.y}px`,
                '--fade-duration': fadeDuration,
              } as React.CSSProperties}
            />
          </>
        ) : (
          <img className="mascot-img" src={FALLBACK_IMG[state]} alt="包公球" draggable={false} />
        )}
      </div>
    </div>
  )
}
