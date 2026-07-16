import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildFurniture, autoFitCamera } from './threeFurniture'
import { type LibraryComponent } from './types'
import './Library.css'

interface LibraryProps {
  components: LibraryComponent[]
  newlyAddedIds: string[]
  onClose: () => void
  onDelete: (id: string) => void
  onGoAssemble: () => void
  onAddFromVideo: () => void
  onAddFromPhoto: () => void
  onAddFromSketch: () => void
  onClearNew: () => void
  onTraceBack: () => void
}

export function Library({ components, newlyAddedIds, onClose, onDelete, onGoAssemble, onAddFromVideo, onAddFromPhoto, onAddFromSketch, onClearNew, onTraceBack }: LibraryProps) {
  const [active, setActive] = useState<LibraryComponent | null>(null)
  const [fabOpen, setFabOpen] = useState(false)

  useEffect(() => {
    if (newlyAddedIds.length === 0) return
    const t = setTimeout(onClearNew, 4000)
    return () => clearTimeout(t)
  }, [newlyAddedIds, onClearNew])

  return (
    <div className="library-root">
      <div className="lib-topbar">
        <button className="lib-back" onClick={onClose}>←</button>
        <div className="lib-title-wrap">
          <div className="lib-title">素材库</div>
          <div className="lib-sub">共 {components.length} 件 · 全部</div>
        </div>
        <button className="lib-assemble-btn" onClick={onGoAssemble}>去组装 →</button>
      </div>

      <div className="lib-grid">
        {components.map((c, i) => {
          const isNew = newlyAddedIds.includes(c.id)
          return (
            <button
              key={c.id}
              className={`lib-card ${isNew ? 'lib-card-new' : ''}`}
              style={{ animationDelay: isNew ? `${i * 0.06}s` : undefined }}
              onClick={() => setActive(c)}
            >
              {isNew && <span className="lib-new-badge">新增</span>}
              <div className="lib-thumb">
                <img
                  className="lib-sticker"
                  src={c.sticker}
                  alt={c.name}
                  style={{ transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)` }}
                />
              </div>
              <div className="lib-card-name">{c.name}</div>
              <div className="lib-card-cat">{c.category}</div>
            </button>
          )
        })}
      </div>

      {fabOpen && <div className="fab-mask" onClick={() => setFabOpen(false)} />}
      <div className={`fab-menu ${fabOpen ? 'open' : ''}`}>
        <button className="fab-item" onClick={() => { setFabOpen(false); onAddFromPhoto() }}>
          <span className="fab-item-icon">📷</span>
          <span className="fab-item-label">线下拍照</span>
        </button>
        <button className="fab-item" onClick={() => { setFabOpen(false); onAddFromSketch() }}>
          <span className="fab-item-icon">✏️</span>
          <span className="fab-item-label">手绘生成</span>
        </button>
        <button className="fab-item" onClick={() => { setFabOpen(false); onAddFromVideo() }}>
          <span className="fab-item-icon">📱</span>
          <span className="fab-item-label">视频圈选</span>
        </button>
      </div>
      <button
        className={`fab-main ${fabOpen ? 'open' : ''}`}
        onClick={() => setFabOpen((v) => !v)}
      >
        {fabOpen ? '✕' : '+'}
      </button>

      {active && (
        <DetailSheet
          component={active}
          onClose={() => setActive(null)}
          onTraceBack={onTraceBack}
          onDelete={() => {
            onDelete(active.id)
            setActive(null)
          }}
        />
      )}
    </div>
  )
}

function DetailSheet({ component, onClose, onDelete, onTraceBack }: { component: LibraryComponent; onClose: () => void; onDelete: () => void; onTraceBack: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const width = mount.clientWidth
    const height = mount.clientHeight

    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(3, 5, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-4, 2, -3)
    scene.add(fill)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 32),
      new THREE.MeshStandardMaterial({ color: 0xededed, roughness: 0.95 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.21
    scene.add(floor)

    const group = buildFurniture(component.category)
    scene.add(group)
    autoFitCamera(group, cam)

    const target = new THREE.Vector3(0, 0.3, 0)
    let dragging = false
    let lastX = 0
    let lastY = 0
    let velY = 0.004
    let manualX = 0
    let manualY = 0.2

    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; velY = 0 }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      manualY += dx * 0.01
      manualX += dy * 0.01
      manualX = Math.max(-0.6, Math.min(0.8, manualX))
    }
    const onUp = () => { dragging = false; velY = 0.004 }
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    let raf = 0
    const animate = () => {
      if (!dragging) manualY += velY
      group.rotation.y = manualY
      group.rotation.x = manualX
      cam.lookAt(target)
      renderer.render(scene, cam)
      raf = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) {
          const mm = m.material as THREE.Material | THREE.Material[]
          Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose()
        }
      })
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [component.category])

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="detail-handle" />
        <div className="detail-3d" ref={mountRef} />
        <div className="detail-info">
          <div className="detail-name">{component.name}</div>
          <div className="detail-tags">
            <span className="detail-cat-tag">{component.category}</span>
            {component.styleTags.map((t) => (
              <span key={t} className="detail-style-tag">{t}</span>
            ))}
          </div>
          <div className="detail-row">
            <span className="detail-label">来源</span>
            <span className="detail-value">{component.source}</span>
          </div>
          {component.sourceVideo && (
            <button className="detail-traceback" onClick={() => { onClose(); onTraceBack() }}>
              <span className="detail-traceback-icon">▶</span>
              <div className="detail-traceback-text">
                <div className="detail-traceback-title">回溯原视频</div>
                <div className="detail-traceback-sub">{component.sourceVideo.blogger} · {component.sourceVideo.frameTime}</div>
              </div>
              <span className="detail-traceback-arrow">›</span>
            </button>
          )}
          <div className="detail-row">
            <span className="detail-label">尺寸</span>
            <span className="detail-value">{component.size}</span>
          </div>
          <div className="detail-hint">拖动可旋转 · 松手自动转</div>
          <div className="detail-actions">
            <button className="detail-delete" onClick={onDelete}>删除</button>
            <button className="detail-close" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  )
}
