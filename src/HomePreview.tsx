import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { buildFurniture } from './threeFurniture'
import { buildRoom, DEFAULT_LAYOUTS, layoutBounds } from './roomLayouts'
import type { LibraryComponent } from './types'

interface HomePreviewProps {
  components: LibraryComponent[]
  layoutId: string
  size?: number
  spin?: boolean
  fillContainer?: boolean
  interactive?: boolean
}

export function HomePreview({ components, layoutId, size = 96, spin = true, fillContainer = false, interactive = false }: HomePreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const w = fillContainer ? mount.clientWidth : size
    const h = fillContainer ? mount.clientHeight : size

    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(3, 5, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(-3, 2, -2)
    scene.add(fill)

    const layout = DEFAULT_LAYOUTS.find((l) => l.id === layoutId) ?? DEFAULT_LAYOUTS[0]
    const room = buildRoom(layout)
    scene.add(room)

    const b = layoutBounds(layout)
    const cats = components.map((c) => c.category)
    const spots = [[0, 0], [1.2, 0.8], [-1.2, 0.8], [1.2, -0.8], [-1.2, -0.8], [0, 1.4]]
    cats.slice(0, 6).forEach((cat, i) => {
      const g = buildFurniture(cat)
      const s = spots[i % spots.length]
      g.position.set(b.cx + s[0], 0, b.cz + s[1])
      g.scale.setScalar(0.6)
      scene.add(g)
    })

    cam.position.set(b.cx + 7, 6, b.cz + 7)
    cam.lookAt(b.cx, 0.3, b.cz)

    const target = new THREE.Vector3(b.cx, 0.3, b.cz)
    const SPIN_R = 8.5
    const spinStart = Math.PI * 0.15
    const spinEnd = Math.PI * 0.95
    const topY = 10
    const spinY = 6
    const spinDur = 1400
    const holdDur = 2600
    let phase: 'spin' | 'hold' = 'spin'
    let cycleT = performance.now()
    let raf = 0

    let dragAngle = spinEnd
    let dragY = topY
    let dragging = false
    let lastX = 0
    let lastY = 0
    let cleanupDrag: (() => void) | null = null

    const setCam = (angle: number, y: number) => {
      cam.position.x = target.x + Math.sin(angle) * SPIN_R
      cam.position.y = y
      cam.position.z = target.z + Math.cos(angle) * SPIN_R
      cam.lookAt(target)
    }

    if (interactive) {
      setCam(dragAngle, dragY)
      const el = renderer.domElement
      el.style.touchAction = 'none'
      const onDown = (e: PointerEvent) => {
        dragging = true
        lastX = e.clientX; lastY = e.clientY
        el.setPointerCapture(e.pointerId)
      }
      const onMove = (e: PointerEvent) => {
        if (!dragging) return
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX; lastY = e.clientY
        dragAngle += dx * 0.01
        dragY = Math.max(3, Math.min(13, dragY - dy * 0.03))
        setCam(dragAngle, dragY)
      }
      const onUp = (e: PointerEvent) => {
        dragging = false
        try { el.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      }
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
      cleanupDrag = () => {
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
      }
    }

    const animate = () => {
      const now = performance.now()
      if (spin && !interactive) {
        let angle: number
        let y: number
        if (phase === 'spin') {
          const p = Math.min(1, (now - cycleT) / spinDur)
          const eased = 1 - Math.pow(1 - p, 3)
          angle = spinStart + (spinEnd - spinStart) * eased
          y = spinY + (topY - spinY) * eased
          if (p >= 1) { phase = 'hold'; cycleT = now }
        } else {
          angle = spinEnd
          y = topY
          if (now - cycleT > holdDur) { phase = 'spin'; cycleT = now }
        }
        setCam(angle, y)
      }
      renderer.render(scene, cam)
      raf = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      if (interactive && typeof cleanupDrag === 'function') cleanupDrag()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [components, layoutId, size, spin, fillContainer, interactive])

  return <div ref={mountRef} style={fillContainer ? { width: '100%', height: '100%' } : { width: size, height: size }} />
}
