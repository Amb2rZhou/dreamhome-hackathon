import * as THREE from 'three'

export interface WallSeg {
  x1: number; z1: number; x2: number; z2: number
}

export interface RoomLayout {
  id: string
  name: string
  desc: string
  walls: WallSeg[]
  floor: { cx: number; cz: number; w: number; d: number }
  camStart: { x: number; y: number; z: number }
}

export const DEFAULT_LAYOUTS: RoomLayout[] = [
  {
    id: 'studio',
    name: '开间',
    desc: '单间开放 · 6 × 6 m',
    floor: { cx: 0, cz: 0, w: 6, d: 6 },
    walls: [
      { x1: -3, z1: -3, x2: 3, z2: -3 },
      { x1: 3, z1: -3, x2: 3, z2: 3 },
      { x1: 3, z1: 3, x2: -3, z2: 3 },
      { x1: -3, z1: 3, x2: -3, z2: -3 },
    ],
    camStart: { x: 5.2, y: 4.2, z: 6 },
  },
  {
    id: '1b1l',
    name: '一居一厅',
    desc: '客餐卧一体 · 8 × 6 m',
    floor: { cx: 0, cz: 0, w: 8, d: 6 },
    walls: [
      { x1: -4, z1: -3, x2: 4, z2: -3 },
      { x1: 4, z1: -3, x2: 4, z2: 3 },
      { x1: 4, z1: 3, x2: -4, z2: 3 },
      { x1: -4, z1: 3, x2: -4, z2: -3 },
      { x1: 0, z1: -3, x2: 0, z2: 0 },
      { x1: 0, z1: 0, x2: 1.2, z2: 0 },
      { x1: 1.2, z1: 0, x2: 1.2, z2: -3 },
    ],
    camStart: { x: 6.5, y: 4.5, z: 7 },
  },
  {
    id: 'lshape',
    name: 'L 型',
    desc: '转角户型 · 不规则',
    floor: { cx: 0, cz: 0, w: 8, d: 8 },
    walls: [
      { x1: -4, z1: -4, x2: 4, z2: -4 },
      { x1: 4, z1: -4, x2: 4, z2: 0 },
      { x1: 4, z1: 0, x2: 0, z2: 0 },
      { x1: 0, z1: 0, x2: 0, z2: 4 },
      { x1: 0, z1: 4, x2: -4, z2: 4 },
      { x1: -4, z1: 4, x2: -4, z2: -4 },
    ],
    camStart: { x: 6, y: 5, z: 7.5 },
  },
]

export function buildRoom(layout: RoomLayout): THREE.Group {
  const g = new THREE.Group()
  const WALL_H = 3
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xD8D2C5, roughness: 0.95 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(layout.floor.w, layout.floor.d), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  g.add(floor)

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xF2EFE8, roughness: 1 })
  layout.walls.forEach((w) => {
    const dx = w.x2 - w.x1
    const dz = w.z2 - w.z1
    const len = Math.hypot(dx, dz)
    if (len < 0.01) return
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, 0.12), wallMat)
    wall.position.set((w.x1 + w.x2) / 2, WALL_H / 2, (w.z1 + w.z2) / 2)
    wall.rotation.y = -Math.atan2(dz, dx)
    wall.receiveShadow = true
    g.add(wall)
  })

  const grid = new THREE.GridHelper(Math.max(layout.floor.w, layout.floor.d), Math.max(layout.floor.w, layout.floor.d), 0xC9C2B2, 0xC9C2B2)
  const gm = grid.material as THREE.Material
  gm.opacity = 0.35; gm.transparent = true
  grid.position.y = 0.01
  g.add(grid)

  return g
}

export function layoutBounds(layout: RoomLayout) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  layout.walls.forEach((w) => {
    minX = Math.min(minX, w.x1, w.x2)
    maxX = Math.max(maxX, w.x1, w.x2)
    minZ = Math.min(minZ, w.z1, w.z2)
    maxZ = Math.max(maxZ, w.z1, w.z2)
  })
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ }
}
