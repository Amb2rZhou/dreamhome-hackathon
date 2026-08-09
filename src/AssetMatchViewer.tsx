import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

type ViewerState = 'loading' | 'ready' | 'failed'

interface AssetMatchViewerProps {
  modelUrl?: string
  fallbackImage?: string
  name: string
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      const materialWithTextures = material as THREE.Material & Record<string, unknown>
      Object.values(materialWithTextures).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

export function AssetMatchViewer({ modelUrl, fallbackImage, name }: AssetMatchViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef({ yaw: -0.35, pitch: -0.08 })
  const modelRootRef = useRef<THREE.Group | null>(null)
  const [viewerState, setViewerState] = useState<ViewerState>(modelUrl ? 'loading' : 'failed')

  const resetView = () => {
    rotationRef.current = { yaw: -0.35, pitch: -0.08 }
    if (modelRootRef.current) {
      modelRootRef.current.rotation.set(-0.08, -0.35, 0)
    }
  }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !modelUrl) {
      setViewerState('failed')
      return
    }

    setViewerState('loading')
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setViewerState('failed')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.setAttribute('aria-hidden', 'true')
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc5b9a4, 2.4))
    const key = new THREE.DirectionalLight(0xffffff, 3.2)
    key.position.set(3.2, 4.8, 4.4)
    key.castShadow = true
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffdfb8, 1.15)
    fill.position.set(-3, 2.2, -2.6)
    scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 64),
      new THREE.ShadowMaterial({ color: 0x5f5548, opacity: 0.14 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.015
    ground.receiveShadow = true
    scene.add(ground)

    const modelRoot = new THREE.Group()
    modelRoot.rotation.set(rotationRef.current.pitch, rotationRef.current.yaw, 0)
    modelRootRef.current = modelRoot
    scene.add(modelRoot)
    camera.position.set(3.25, 2.35, 4.55)
    camera.lookAt(0, 0.88, 0)

    const resize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    let disposed = false
    let loadedModel: THREE.Object3D | null = null
    let activePointer: number | null = null
    let lastX = 0
    let lastY = 0
    let animationFrame = 0

    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene)
          return
        }
        loadedModel = gltf.scene
        const bounds = new THREE.Box3().setFromObject(loadedModel)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const maxDimension = Math.max(size.x, size.y, size.z) || 1
        const scale = 2.35 / maxDimension
        loadedModel.scale.setScalar(scale)
        loadedModel.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
        modelRoot.position.y = size.y * scale * 0.5
        loadedModel.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
        })
        modelRoot.add(loadedModel)
        setViewerState('ready')
      },
      undefined,
      () => {
        if (!disposed) setViewerState('failed')
      },
    )

    const endDrag = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return
      activePointer = null
      try { renderer.domElement.releasePointerCapture(event.pointerId) } catch { /* capture already ended */ }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!loadedModel || activePointer !== null) return
      activePointer = event.pointerId
      lastX = event.clientX
      lastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return
      const nextYaw = rotationRef.current.yaw + (event.clientX - lastX) * 0.012
      const nextPitch = THREE.MathUtils.clamp(
        rotationRef.current.pitch + (event.clientY - lastY) * 0.009,
        -0.72,
        0.72,
      )
      rotationRef.current = { yaw: nextYaw, pitch: nextPitch }
      modelRoot.rotation.set(nextPitch, nextYaw, 0)
      lastX = event.clientX
      lastY = event.clientY
    }
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', endDrag)
    renderer.domElement.addEventListener('pointercancel', endDrag)
    renderer.domElement.addEventListener('lostpointercapture', () => { activePointer = null })

    const render = () => {
      renderer.render(scene, camera)
      animationFrame = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      disposed = true
      modelRootRef.current = null
      resizeObserver.disconnect()
      window.cancelAnimationFrame(animationFrame)
      if (loadedModel) disposeObject(loadedModel)
      ground.geometry.dispose()
      ground.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [modelUrl])

  return (
    <div
      className="asset-match-viewer"
      data-state={viewerState}
      role="group"
      aria-label={`${name} 的可旋转 3D 预览`}
    >
      {fallbackImage && (
        <img className="asset-match-fallback" src={fallbackImage} alt={viewerState === 'failed' ? name : ''} />
      )}
      <div className="asset-match-canvas" ref={mountRef} />
      {viewerState === 'loading' && (
        <div className="asset-match-status" role="status">
          <span className="asset-match-spinner" aria-hidden="true" />
          正在加载已有 3D…
        </div>
      )}
      {viewerState === 'failed' && (
        <div className="asset-match-status asset-match-error" role="status">
          {fallbackImage ? '3D 暂时无法加载，已显示资产缩略图' : '3D 暂时无法加载，请选择重新生成'}
        </div>
      )}
      {viewerState === 'ready' && (
        <p className="asset-match-hint">单指或鼠标拖动，上下左右查看</p>
      )}
      {viewerState === 'ready' && (
        <button type="button" className="asset-match-reset" onClick={resetView} aria-label="恢复 3D 默认视角">
          ↻
        </button>
      )}
    </div>
  )
}
