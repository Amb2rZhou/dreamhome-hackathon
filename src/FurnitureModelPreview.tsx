import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

interface FurnitureModelPreviewProps {
  modelUrl?: string
  fallbackImage: string
  name: string
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      const withMaps = material as THREE.Material & Record<string, unknown>
      Object.values(withMaps).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

export function FurnitureModelPreview({ modelUrl, fallbackImage, name }: FurnitureModelPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !modelUrl) return

    const width = mount.clientWidth || 300
    const height = mount.clientHeight || 188
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad99, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 3.1)
    key.position.set(3.2, 4.6, 4.1)
    key.castShadow = true
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffe3bf, 1.15)
    fill.position.set(-3, 2, -2)
    scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.ShadowMaterial({ color: 0x5f5548, opacity: 0.15 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.015
    ground.receiveShadow = true
    scene.add(ground)

    const modelRoot = new THREE.Group()
    scene.add(modelRoot)
    camera.position.set(3.2, 2.25, 4.4)
    camera.lookAt(0, 0.9, 0)

    let disposed = false
    let loadedModel: THREE.Object3D | null = null
    let dragging = false
    let lastX = 0
    let raf = 0

    const loader = new GLTFLoader()
    mount.dataset.state = 'loading'
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene)
          return
        }
        loadedModel = gltf.scene
        const initialBox = new THREE.Box3().setFromObject(loadedModel)
        const size = initialBox.getSize(new THREE.Vector3())
        const center = initialBox.getCenter(new THREE.Vector3())
        const maxDimension = Math.max(size.x, size.y, size.z) || 1
        const scale = 2.35 / maxDimension
        loadedModel.scale.setScalar(scale)
        loadedModel.position.set(-center.x * scale, -initialBox.min.y * scale, -center.z * scale)
        loadedModel.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
        })
        modelRoot.add(loadedModel)
        mount.dataset.state = 'ready'
      },
      undefined,
      () => {
        if (!disposed) mount.dataset.state = 'failed'
      },
    )

    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      lastX = event.clientX
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      modelRoot.rotation.y += (event.clientX - lastX) * 0.012
      lastX = event.clientX
    }
    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      try { renderer.domElement.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    }
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    const animate = () => {
      if (!dragging && loadedModel) modelRoot.rotation.y += 0.004
      renderer.render(scene, camera)
      raf = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      if (loadedModel) disposeObject(loadedModel)
      ground.geometry.dispose()
      ground.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      delete mount.dataset.state
    }
  }, [modelUrl])

  if (!modelUrl) return <img src={fallbackImage} alt={name} />

  return (
    <div className="workshop-model-viewer" ref={mountRef} aria-label={`${name} 3D 模型`}>
      <span className="workshop-model-loading">3D 家具加载中</span>
      <img className="workshop-model-fallback" src={fallbackImage} alt="" />
    </div>
  )
}
