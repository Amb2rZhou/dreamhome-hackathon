import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildFurniture } from './threeFurniture'
import { buildRoom, layoutBounds, type RoomLayout } from './roomLayouts'
import type { LibraryComponent } from './types'
import './Assemble.css'

interface PlacedItem {
  uid: string
  component: LibraryComponent
  group: THREE.Group
}

interface AssembleProps {
  components: LibraryComponent[]
  layout: RoomLayout | null
  layoutSource: string
  onClose: () => void
  onRepickLayout: () => void
}

export function Assemble({ components, layout, layoutSource, onClose, onRepickLayout }: AssembleProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<PlacedItem[]>([])
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const placedRef = useRef<PlacedItem[]>([])
  const activeUidRef = useRef<string | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const layoutRef = useRef<RoomLayout | null>(layout)

  useEffect(() => { placedRef.current = placed }, [placed])
  useEffect(() => { activeUidRef.current = activeUid }, [activeUid])
  useEffect(() => { layoutRef.current = layout }, [layout])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !layout) return
    const L = layout
    if (!mount) return
    const width = mount.clientWidth
    const height = mount.clientHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xEDE9E1)
    sceneRef.current = scene
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    cam.position.set(L.camStart.x, L.camStart.y, L.camStart.z)
    const b = layoutBounds(L)
    cam.lookAt(b.cx, 0.5, b.cz)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(6, 10, 6)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -8; key.shadow.camera.right = 8
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(-5, 4, -4)
    scene.add(fill)

    const room = buildRoom(L)
    scene.add(room)

    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let camTheta = Math.atan2(cam.position.x, cam.position.z)
    let camPhi = Math.atan2(Math.hypot(cam.position.x, cam.position.z), cam.position.y)
    let camDist = cam.position.length()
    let dragging = false
    let dragTarget: THREE.Group | null = null
    let dragOffset = new THREE.Vector3()
    let lastX = 0
    let lastY = 0
    let mode: 'cam' | 'obj' = 'cam'

    const lookTarget = new THREE.Vector3(b.cx, 0.5, b.cz)
    const updateCam = () => {
      cam.position.x = lookTarget.x + camDist * Math.sin(camPhi) * Math.sin(camTheta)
      cam.position.y = camDist * Math.cos(camPhi)
      cam.position.z = lookTarget.z + camDist * Math.sin(camPhi) * Math.cos(camTheta)
      cam.lookAt(lookTarget)
    }

    const onDown = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      ray.setFromCamera(pointer, cam)
      const groups = placedRef.current.map((p) => p.group)
      const hits = ray.intersectObjects(groups, true)
      if (hits.length > 0) {
        let g: THREE.Object3D | null = hits[0].object
        while (g && !(g instanceof THREE.Group)) g = g.parent
        if (g) {
          dragTarget = g as THREE.Group
          mode = 'obj'
          const uid = placedRef.current.find((p) => p.group === dragTarget)?.uid ?? null
          setActiveUid(uid)
          activeUidRef.current = uid
          const hit = new THREE.Vector3()
          ray.ray.intersectPlane(groundPlane, hit)
          dragOffset.copy(hit).sub(dragTarget.position)
          return
        }
      }
      dragging = true
      mode = 'cam'
      lastX = e.clientX; lastY = e.clientY
      setActiveUid(null)
      activeUidRef.current = null
    }
    const onMove = (e: PointerEvent) => {
      if (mode === 'obj' && dragTarget) {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        ray.setFromCamera(pointer, cam)
        const hit = new THREE.Vector3()
        if (ray.ray.intersectPlane(groundPlane, hit)) {
          const HALFX = (b.maxX - b.minX) / 2 - 0.4
          const HALFZ = (b.maxZ - b.minZ) / 2 - 0.4
          dragTarget.position.x = THREE.MathUtils.clamp(hit.x - dragOffset.x, b.minX + 0.4, b.maxX - 0.4)
          dragTarget.position.z = THREE.MathUtils.clamp(hit.z - dragOffset.z, b.minZ + 0.4, b.maxZ - 0.4)
          void HALFX; void HALFZ
        }
      } else if (dragging) {
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX; lastY = e.clientY
        camTheta -= dx * 0.006
        camPhi = THREE.MathUtils.clamp(camPhi - dy * 0.006, 0.3, 1.45)
        updateCam()
      }
    }
    const onUp = () => { dragging = false; dragTarget = null; mode = 'cam' }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 3, 14)
      updateCam()
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    const animate = () => {
      placedRef.current.forEach((p) => {
        if (p.uid === activeUidRef.current) {
          const mat = p.group.children[0] as THREE.Mesh
          if (mat && mat.material) {
            ;(Array.isArray(mat.material) ? mat.material : [mat.material]).forEach((m) => {
              const em = m as THREE.MeshStandardMaterial
              em.emissive?.setHex(0x4dd0e1)
              em.emissiveIntensity = 0.18
            })
          }
        }
      })
      renderer.render(scene, cam)
      raf = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      placedRef.current.forEach((p) => {
        p.group.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
        })
      })
      room.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [layout])

  const placeItem = (c: LibraryComponent) => {
    const scene = sceneRef.current
    if (!scene || !layoutRef.current) return
    const lb = layoutBounds(layoutRef.current)
    const group = buildFurniture(c.category)
    const angle = placed.length * 0.7
    group.position.set(lb.cx + Math.cos(angle) * 1.4, 0, lb.cz + Math.sin(angle) * 1.4)
    scene.add(group)
    const uid = `placed-${Date.now()}-${placed.length}`
    const item: PlacedItem = { uid, component: c, group }
    const next = [...placed, item]
    setPlaced(next)
    setActiveUid(uid)
  }

  const removePlaced = (uid: string) => {
    const item = placed.find((p) => p.uid === uid)
    if (item) {
      sceneRef.current?.remove(item.group)
      item.group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) { const mm = m.material as THREE.Material | THREE.Material[]; Array.isArray(mm) ? mm.forEach((x) => x.dispose()) : mm.dispose() }
      })
    }
    setPlaced(placed.filter((p) => p.uid !== uid))
    if (activeUid === uid) setActiveUid(null)
  }

  const handleVoice = () => {
    if (!activeUid) return
    const item = placed.find((p) => p.uid === activeUid)
    if (!item) return
    const spots = [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5], [0, 0]]
    const s = spots[placed.length % spots.length]
    item.group.position.set(s[0], 0, s[1])
  }

  return (
    <div className="assemble-root">
      <div className="asm-topbar">
        <button className="asm-back" onClick={onClose}>←</button>
        <div className="asm-title-wrap">
          <div className="asm-title">组装梦想之家</div>
          <button className="asm-layout-tag" onClick={onRepickLayout}>
            {layoutSource} · 换
          </button>
        </div>
        <div className="asm-count">已摆放 {placed.length}</div>
      </div>

      <div className="asm-stage" ref={mountRef} />

      <div className="asm-panel">
        <div className="asm-panel-title">从素材库添加</div>
        <div className="asm-chips">
          {components.slice(0, 10).map((c) => (
            <button key={c.id} className="asm-chip" onClick={() => placeItem(c)}>
              <img className="asm-chip-img" src={c.sticker} alt={c.name} />
              <span className="asm-chip-name">{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {activeUid && (() => {
        const item = placed.find((p) => p.uid === activeUid)
        return item ? (
          <div className="asm-active-bar">
            <div className="asm-active-info">
              <span className="asm-active-name">{item.component.name}</span>
              {item.component.sourceVideo ? (
                <span className="asm-active-trace">▶ {item.component.sourceVideo.blogger} · {item.component.sourceVideo.frameTime}</span>
              ) : (
                <span className="asm-active-hint">拖动可移动 · 滚轮缩放</span>
              )}
            </div>
            <button className="asm-voice-btn" onClick={handleVoice}>
              🎤 挪到窗边
            </button>
            <button className="asm-del-btn" onClick={() => removePlaced(activeUid)}>删除</button>
          </div>
        ) : null
      })()}

      {!activeUid && (
        <div className="asm-tip">空白处拖动转视角 · 点家具选中后可移动</div>
      )}
    </div>
  )
}
