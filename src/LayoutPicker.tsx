import { useRef, useState } from 'react'
import { DEFAULT_LAYOUTS, type RoomLayout } from './roomLayouts'
import './LayoutPicker.css'

interface LayoutPickerProps {
  onPick: (layout: RoomLayout, source: string) => void
  onClose: () => void
}

type Mode = 'menu' | 'upload' | 'custom'

export function LayoutPicker({ onPick, onClose }: LayoutPickerProps) {
  const [mode, setMode] = useState<Mode>('menu')
  const [uploading, setUploading] = useState(false)
  const [customWalls, setCustomWalls] = useState<{ x: number; z: number }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const GRID = 6
  const CELL = 48

  const handleFile = (file: File) => {
    setUploading(true)
    setTimeout(() => {
      setUploading(false)
      onPick(DEFAULT_LAYOUTS[1], `来自户型图 ${file.name}`)
    }, 2000)
  }

  const gridToWorld = (gx: number, gz: number) => ({
    x: (gx - GRID / 2) * (6 / GRID),
    z: (gz - GRID / 2) * (6 / GRID),
  })

  const toggleCell = (gx: number, gz: number) => {
    const idx = customWalls.findIndex((p) => p.x === gx && p.z === gz)
    if (idx >= 0) setCustomWalls(customWalls.filter((_, i) => i !== idx))
    else setCustomWalls([...customWalls, { x: gx, z: gz }])
  }

  const confirmCustom = () => {
    if (customWalls.length < 3) return
    const pts = customWalls.map((p) => gridToWorld(p.x, p.z))
    const walls = pts.map((p, i) => {
      const n = pts[(i + 1) % pts.length]
      return { x1: p.x, z1: p.z, x2: n.x, z2: n.z }
    })
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z)
    const layout: RoomLayout = {
      id: 'custom',
      name: '自定义户型',
      desc: `自绘 ${pts.length} 边形`,
      walls,
      floor: { cx: 0, cz: 0, w: 6, d: 6 },
      camStart: { x: 5.2, y: 4.2, z: 6 },
    }
    void xs; void zs
    onPick(layout, '自定义绘制')
  }

  return (
    <div className="lp-overlay">
      <div className="lp-sheet">
        <div className="lp-handle" />
        <div className="lp-header">
          <span className="lp-title">开始装扮你的家</span>
          <button className="lp-close" onClick={onClose}>✕</button>
        </div>

        {mode === 'menu' && (
          <div className="lp-menu">
            <div className="lp-section-label">选一个户型来源</div>

            <div className="lp-defaults">
              {DEFAULT_LAYOUTS.map((l) => (
                <button key={l.id} className="lp-default-card" onClick={() => onPick(l, `默认户型 · ${l.name}`)}>
                  <LayoutThumb layout={l} />
                  <div className="lp-default-info">
                    <div className="lp-default-name">{l.name}</div>
                    <div className="lp-default-desc">{l.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="lp-divider"><span>或</span></div>

            <button className="lp-action" onClick={() => setMode('upload')}>
              <span className="lp-action-icon">📐</span>
              <div className="lp-action-text">
                <div className="lp-action-name">上传户型图</div>
                <div className="lp-action-desc">拍一张或从相册选，自动解析成 3D 空间</div>
              </div>
              <span className="lp-arrow">›</span>
            </button>

            <button className="lp-action" onClick={() => setMode('custom')}>
              <span className="lp-action-icon">✏️</span>
              <div className="lp-action-text">
                <div className="lp-action-name">自定义画墙</div>
                <div className="lp-action-desc">在网格上画出房间轮廓，生成你的户型</div>
              </div>
              <span className="lp-arrow">›</span>
            </button>
          </div>
        )}

        {mode === 'upload' && (
          <div className="lp-upload">
            <button className="lp-back-link" onClick={() => setMode('menu')}>‹ 返回</button>
            {!uploading ? (
              <>
                <div className="lp-upload-zone" onClick={() => fileRef.current?.click()}>
                  <div className="lp-upload-icon">📐</div>
                  <div className="lp-upload-hint">点击上传户型图</div>
                  <div className="lp-upload-sub">支持拍照 / 相册 / 截图</div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="lp-file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </>
            ) : (
              <div className="lp-parsing">
                <div className="lp-parse-spinner" />
                <div className="lp-parse-text">正在解析户型图…</div>
                <div className="lp-parse-sub">识别墙体 · 生成 3D 空间</div>
              </div>
            )}
          </div>
        )}

        {mode === 'custom' && (
          <div className="lp-custom">
            <button className="lp-back-link" onClick={() => setMode('menu')}>‹ 返回</button>
            <div className="lp-custom-hint">依次点击网格点连成房间轮廓（至少 3 个点，自动闭合）</div>
            <div className="lp-canvas">
              <svg className="lp-grid-svg" viewBox={`0 0 ${GRID * CELL} ${GRID * CELL}`}>
                {Array.from({ length: GRID + 1 }).map((_, i) => (
                  <g key={`v${i}`}>
                    <line x1={i * CELL} y1={0} x2={i * CELL} y2={GRID * CELL} stroke="#E5E0D6" strokeWidth="1" />
                    <line x1={0} y1={i * CELL} x2={GRID * CELL} y2={i * CELL} stroke="#E5E0D6" strokeWidth="1" />
                  </g>
                ))}
                {customWalls.length >= 2 && (
                  <polygon
                    points={customWalls.map((p) => `${p.x * CELL + CELL / 2},${p.z * CELL + CELL / 2}`).join(' ')}
                    fill="rgba(77,208,225,0.12)"
                    stroke="#4dd0e1"
                    strokeWidth="2"
                  />
                )}
                {customWalls.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x * CELL + CELL / 2}
                    cy={p.z * CELL + CELL / 2}
                    r="9"
                    fill="#1A1A1A"
                    stroke="#fff"
                    strokeWidth="2"
                  />
                ))}
              </svg>
              <div className="lp-grid-points">
                {Array.from({ length: GRID }).map((_, gz) =>
                  Array.from({ length: GRID }).map((_, gx) => (
                    <button
                      key={`${gx}-${gz}`}
                      className="lp-grid-pt"
                      style={{ left: gx * CELL, top: gz * CELL, width: CELL, height: CELL }}
                      onClick={() => toggleCell(gx, gz)}
                    />
                  ))
                )}
              </div>
            </div>
            <div className="lp-custom-actions">
              <button className="lp-clear" onClick={() => setCustomWalls([])} disabled={customWalls.length === 0}>清空</button>
              <button className="lp-confirm" onClick={confirmCustom} disabled={customWalls.length < 3}>
                生成户型（{customWalls.length} 点）
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LayoutThumb({ layout }: { layout: RoomLayout }) {
  const b = layout.walls
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  b.forEach((w) => {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2)
    minZ = Math.min(minZ, w.z1, w.z2); maxZ = Math.max(maxZ, w.z1, w.z2)
  })
  const pad = 0.5
  const w = maxX - minX + pad * 2
  const d = maxZ - minZ + pad * 2
  const vb = `${minX - pad} ${minZ - pad} ${w} ${d}`
  return (
    <svg className="lp-thumb" viewBox={vb}>
      <rect x={minX - pad} y={minZ - pad} width={w} height={d} fill="#F7F4EE" />
      {b.map((seg, i) => (
        <line
          key={i}
          x1={seg.x1} y1={seg.z1} x2={seg.x2} y2={seg.z2}
          stroke="#8A8A8A" strokeWidth="0.12" strokeLinecap="round"
        />
      ))}
    </svg>
  )
}
