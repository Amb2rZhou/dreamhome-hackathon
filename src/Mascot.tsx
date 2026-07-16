import { useEffect, useRef, useState } from 'react'
import type { MascotState, CraftBatch } from './types'
import './Mascot.css'

interface MascotProps {
  state: MascotState
  doneBatch: CraftBatch | null
  craftStartTip: boolean
  onTapBubble: () => void
  onDismissBubble: () => void
  onDismissStartTip: () => void
}

const STATE_IMG: Record<MascotState, string> = {
  sleeping: '/mascot-sleeping.png',
  happy: '/mascot-happy.png',
  working: '/mascot-working.png',
}

export function Mascot({ state, doneBatch, craftStartTip, onTapBubble, onDismissBubble, onDismissStartTip }: MascotProps) {
  const [pos, setPos] = useState({ x: 300, y: 560 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)
  const [bubbleSeen, setBubbleSeen] = useState(false)
  const [startTipSeen, setStartTipSeen] = useState(false)

  const done = !!doneBatch

  useEffect(() => {
    if (state !== 'happy' || !done) setBubbleSeen(false)
  }, [state, done])

  const doneCount = doneBatch?.jobs.length ?? 0
  const doneText = doneCount > 1 ? `本批 ${doneCount} 件都打造完啦！` : `✨ ${doneBatch?.jobs[0]?.name ?? ''}打造完啦！`

  useEffect(() => {
    if (craftStartTip) setStartTipSeen(false)
  }, [craftStartTip])

  useEffect(() => {
    if (!craftStartTip || startTipSeen) return
    const t = setTimeout(() => { setStartTipSeen(true); onDismissStartTip() }, 3500)
    return () => clearTimeout(t)
  }, [craftStartTip, startTipSeen, onDismissStartTip])

  const onDown = (e: React.PointerEvent) => {
    setDragging(true)
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragging || !dragRef.current) return
    const screen = document.querySelector('.screen') as HTMLElement
    const r = screen?.getBoundingClientRect()
    if (!r) return
    const nx = e.clientX - dragRef.current.ox - r.left
    const ny = e.clientY - dragRef.current.oy - r.top
    setPos({
      x: Math.max(8, Math.min(r.width - 72, nx)),
      y: Math.max(8, Math.min(r.height - 72, ny)),
    })
  }
  const onUp = () => {
    setDragging(false)
    dragRef.current = null
    setPos((p) => {
      const screen = document.querySelector('.screen') as HTMLElement
      const r = screen?.getBoundingClientRect()
      if (!r) return p
      const mid = r.width / 2
      return { x: p.x + 32 < mid ? 8 : r.width - 72, y: p.y }
    })
  }

  const showDoneBubble = done && !bubbleSeen
  const showStartBubble = !showDoneBubble && craftStartTip && !startTipSeen
  const bubbleSide = pos.x > 130 ? 'right' : 'left'

  return (
    <div
      className={`mascot-root mascot-${state} ${dragging ? 'dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {showDoneBubble && (
        <div className={`mascot-bubble ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(e) => e.stopPropagation()}>
          <button className="mascot-bubble-x" onClick={(e) => { e.stopPropagation(); setBubbleSeen(true); onDismissBubble() }}>✕</button>
          <div className="mascot-bubble-text">✨ {doneText}</div>
          <div className="mascot-bubble-actions">
            <button className="mascot-bubble-btn" onClick={(e) => { e.stopPropagation(); onTapBubble() }}>看看</button>
          </div>
        </div>
      )}
      {showStartBubble && (
        <div className={`mascot-bubble mascot-bubble-start ${bubbleSide === 'right' ? 'bubble-left' : 'bubble-right'}`} onPointerDown={(e) => e.stopPropagation()}>
          <button className="mascot-bubble-x" onClick={(e) => { e.stopPropagation(); setStartTipSeen(true); onDismissStartTip() }}>✕</button>
          <div className="mascot-bubble-text">开工啦！约 2 分钟，你可以继续浏览，好啦告诉你</div>
        </div>
      )}
      <img className="mascot-img" src={STATE_IMG[state]} alt="包公球" draggable={false} />
      {state === 'working' && <div className="mascot-sparks" />}
    </div>
  )
}
