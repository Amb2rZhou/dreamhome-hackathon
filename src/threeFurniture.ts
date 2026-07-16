import * as THREE from 'three'
import type { FurnitureCategory } from './types'

const mat = (color: number, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1 })

function sofa(): THREE.Group {
  const g = new THREE.Group()
  const body = mat(0x8d6e63)
  const cushion = mat(0xa1887f, 0.85)
  const base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 1.3), body); base.position.y = 0.2; g.add(base)
  const back = new THREE.Mesh(new THREE.BoxGeometry(3, 1.0, 0.3), body); back.position.set(0, 0.9, -0.5); g.add(back)
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 1.3), body); armL.position.set(-1.35, 0.55, 0); g.add(armL)
  const armR = armL.clone(); armR.position.x = 1.35; g.add(armR)
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.0), cushion)
    c.position.set(-1 + i, 0.55, 0.1); g.add(c)
  }
  for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), mat(0x4e342e))
    leg.position.set(i * 1.3, -0.2, j * 0.5); g.add(leg)
  }
  return g
}

function teaTable(): THREE.Group {
  const g = new THREE.Group()
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 32), mat(0x6d4c41, 0.5))
  top.position.y = 0.7; g.add(top)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), mat(0x4e342e, 0.4))
    leg.position.set(Math.cos(a) * 0.7, 0.35, Math.sin(a) * 0.7); g.add(leg)
  }
  return g
}

function pendant(): THREE.Group {
  const g = new THREE.Group()
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 6), mat(0x333333))
  cord.position.y = 1.0; g.add(cord)
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 24, 1, true), mat(0xc9a227, 0.4))
  shade.position.y = 0.3; g.add(shade)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffd54f, emissiveIntensity: 0.8 }))
  bulb.position.y = 0.25; g.add(bulb)
  const light = new THREE.PointLight(0xffd54f, 1.2, 4); light.position.y = 0.2; g.add(light)
  return g
}

function plant(): THREE.Group {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.5, 16), mat(0x8d6e63, 0.9))
  pot.position.y = 0.25; g.add(pot)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 8), mat(0x5d4037))
  trunk.position.y = 1.1; g.add(trunk)
  const leafMat = mat(0x4a7c37, 0.8)
  const positions = [[0, 1.8, 0, 0.5], [0.3, 1.6, 0.2, 0.4], [-0.3, 1.7, -0.15, 0.42], [0.15, 2.0, -0.2, 0.38], [-0.2, 1.5, 0.3, 0.36]]
  positions.forEach(([x, y, z, r]) => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), leafMat)
    leaf.position.set(x, y, z); leaf.scale.set(1, 0.8, 1); g.add(leaf)
  })
  return g
}

function wallArt(): THREE.Group {
  const g = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.06), mat(0x3e2723, 0.5))
  g.add(frame)
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), mat(0xb0bec5, 0.95))
  canvas.position.z = 0.04; g.add(canvas)
  const blob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), mat(0x5c6bc0, 0.7))
  blob.position.set(0.1, 0.1, 0.07); blob.scale.set(1.2, 0.8, 0.1); g.add(blob)
  const blob2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), mat(0xec407a, 0.7))
  blob2.position.set(-0.25, -0.2, 0.07); blob2.scale.set(1, 1.4, 0.1); g.add(blob2)
  return g
}

function rug(): THREE.Group {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, 2), mat(0x9e6b5a, 0.95))
  g.add(base)
  const stripeMat = mat(0xcbb88a, 0.95)
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.15), stripeMat)
    s.position.set(0, 0.01, i * 0.6); g.add(s)
  }
  return g
}

const BUILDERS: Record<FurnitureCategory, () => THREE.Group> = {
  '沙发': sofa,
  '茶几': teaTable,
  '吊灯': pendant,
  '绿植': plant,
  '装饰画': wallArt,
  '地毯': rug,
}

export function buildFurniture(cat: FurnitureCategory): THREE.Group {
  const g = BUILDERS[cat]()
  const box = new THREE.Box3().setFromObject(g)
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  g.position.sub(center)
  g.position.y += size.y / 2 - 0.2
  return g
}

export function autoFitCamera(group: THREE.Group, cam: THREE.PerspectiveCamera) {
  const box = new THREE.Box3().setFromObject(group)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = cam.fov * (Math.PI / 180)
  let dist = (maxDim / 2) / Math.tan(fov / 2)
  dist *= 1.8
  cam.position.set(dist * 0.6, dist * 0.4, dist)
  cam.near = 0.1
  cam.far = dist * 10
  cam.lookAt(center)
  cam.updateProjectionMatrix()
}
