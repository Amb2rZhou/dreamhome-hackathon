import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildFurniture, autoFitCamera } from './threeFurniture'
import type { LibraryComponent } from './types'
import './CraftResult.css'

interface CraftResultProps {
  components: LibraryComponent[]
  onStore: () => void
  onClose: () => void
}

export function CraftResult({ components, onStore, onClose }: CraftResultProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const camRef = useRef<THREE.PerspectiveCamera | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

  const active = components[activeIdx]

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
    sceneRef.current = scene
    camRef.current = cam
    rendererRef.current = renderer

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(3, 5, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-4, 2, -3)
    scene.add(fill)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5, 32),
      new THREE.MeshStandardMaterial({ color: 0xededed, roughness: 0.95 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.21
    scene.add(floor)

    let raf = 0
    const target = new THREE.Vector3(0, 0.3, 0)
    let dragging = false
    let lastX = 0
    let manualY = 0.5
    let velY = 0.005
    const el = renderer.domElement
    el.style.touchAction = 'none'
    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; velY = 0; el.setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => { if (!dragging || !groupRef.current) return; manualY += (e.clientX - lastX) * 0.01; lastX = e.clientX }
    const onUp = (e: PointerEvent) => { dragging = false; velY = 0.005; try { el.releasePointerCapture(e.pointerId) } catch { /* noop */ } }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    const animate = () => {
      if (!dragging) manualY += velY
      if (groupRef.current) {
        groupRef.current.rotation.y = manualY
        groupRef.current.rotation.x = 0.15
      }
      cam.lookAt(target)
      renderer.render(scene, cam)
      raf = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
      })
      renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    const cam = camRef.current
    if (!scene || !cam || !active) return
    if (groupRef.current) {
      scene.remove(groupRef.current)
      groupRef.current.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
      })
    }
    const g = buildFurniture(active.category)
    scene.add(g)
    groupRef.current = g
    autoFitCamera(g, cam)
  }, [activeIdx, active])

  return (
    <div className="cr-overlay" onClick={() => setConfirmExit(true)}>
      <div className="cr-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cr-handle" />
        <div className="cr-header">
          <span className="cr-title">✨ 本批打造完成 · {components.length} 件</span>
          <button className="cr-close" onClick={() => setConfirmExit(true)}>✕</button>
        </div>

        <div className="cr-3d" ref={mountRef} />
        <div className="cr-hint">拖动可转 · 松手自动转</div>

        <div className="cr-thumbs">
          {components.map((c, i) => (
            <button
              key={c.id}
              className={`cr-thumb ${i === activeIdx ? 'active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              <img src={c.sticker} alt={c.name} />
            </button>
          ))}
        </div>

        <div className="cr-info">
          <div className="cr-name">{active?.name}</div>
          <div className="cr-tags">
            <span className="cr-cat-tag">{active?.category}</span>
            {active?.styleTags.map((t) => <span key={t} className="cr-style-tag">{t}</span>)}
          </div>
        </div>

        <button className="cr-store-btn" onClick={onStore}>
          一键存进仓库（{components.length} 件）
        </button>
      </div>

      {confirmExit && (
        <div className="cr-confirm" onClick={(e) => e.stopPropagation()}>
          <div className="cr-confirm-box">
            <div className="cr-confirm-title">还没存进仓库</div>
            <div className="cr-confirm-desc">退出后本批 {components.length} 件 3D 不会保存</div>
            <div className="cr-confirm-actions">
              <button className="cr-confirm-stay" onClick={() => setConfirmExit(false)}>继续保存</button>
              <button className="cr-confirm-leave" onClick={onClose}>放弃</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
