import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('全部')
  const [recommendMode, setRecommendMode] = useState(false)
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    components.forEach((component) => {
      ;[component.category, ...component.styleTags].forEach((tag) => (
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      ))
    })
    return ['全部', ...Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 9)
      .map(([tag]) => tag)]
  }, [components])
  const visibleComponents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = components.filter((component) => {
      const searchable = [component.name, component.category, ...component.styleTags].join(' ').toLowerCase()
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery)
      const matchesTag = activeTag === '全部'
        || component.category === activeTag
        || component.styleTags.includes(activeTag)
      return matchesQuery && matchesTag
    })
    if (!recommendMode) return filtered
    const preferred = ['北欧', '原木', '自然风', '米色', '实木', '绿植', '暖灰']
    return [...filtered].sort((left, right) => {
      const score = (component: LibraryComponent) => preferred.reduce(
        (total, tag) => total + (component.styleTags.some((item) => item.includes(tag)) ? 1 : 0),
        0,
      )
      return score(right) - score(left)
    }).slice(0, 12)
  }, [activeTag, components, query, recommendMode])

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
          <div className="lib-sub">共 {components.length} 件 · 已显示 {visibleComponents.length} 件</div>
        </div>
        <button className="lib-assemble-btn" onClick={onGoAssemble}>去组装 →</button>
      </div>

      <div className="lib-discovery">
        <div className="lib-search-row">
          <input
            className="lib-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索家具、风格、材质"
            aria-label="筛选家具"
          />
          <button
            className={`lib-ai-match ${recommendMode ? 'is-active' : ''}`}
            onClick={() => setRecommendMode((current) => !current)}
            aria-pressed={recommendMode}
          >
            ✦ AI 搭配
          </button>
        </div>
        <div className="lib-tags" aria-label="家具标签筛选">
          {tags.map((tag) => (
            <button
              key={tag}
              className={activeTag === tag ? 'is-active' : ''}
              onClick={() => setActiveTag(tag)}
              aria-pressed={activeTag === tag}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-grid">
        {visibleComponents.map((c, i) => {
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
        {visibleComponents.length === 0 && (
          <div className="lib-empty">没有匹配的家具，换个标签或关键词试试。</div>
        )}
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
