import { CATEGORY_COLOR, type FurnitureCategory, type LibraryComponent } from './types'
import { dreamHomeApiUrl } from './dreamHomeApi'

export const IMAGE_POST_ID = 'imgpost_178d69ed78142afc'
const IMAGE_POST_AUTHOR = '@嘉基基基基'

export interface ImagePostHotspot {
  assetId: string
  name: string
  slideIndex: number
  bbox: [number, number, number, number]
}

export interface ImagePostAssetBinding {
  asset_id: string
  slide_index: number
  bbox: [number, number, number, number]
  polygon?: Array<[number, number]>
  status: string
  name?: string
  labels?: {
    category?: string
    sub?: string
    colors?: string[]
    materials?: string[]
    styles?: string[]
    features?: string[]
    size_class?: string
  }
  model_url?: string
  thumbnail_url?: string
}

interface ImagePostAssetBindingsResponse {
  bindings: ImagePostAssetBinding[]
}

function mediaUrl(value: string): string {
  if (!value) return ''
  try {
    const url = new URL(value, window.location.origin)
    if (url.pathname.startsWith('/storage/')) return dreamHomeApiUrl(url.pathname)
  } catch {
    // Fall through to the path handling below.
  }
  return value.startsWith('/') ? dreamHomeApiUrl(value) : value
}

function furnitureCategory(sourceCategory = ''): FurnitureCategory {
  if (sourceCategory === '沙发') return '沙发'
  if (sourceCategory === '桌子' || sourceCategory === '茶几') return '茶几'
  if (sourceCategory === '灯具' || sourceCategory === '吊灯') return '吊灯'
  if (sourceCategory === '植物' || sourceCategory === '绿植') return '绿植'
  if (sourceCategory === '装饰画') return '装饰画'
  if (sourceCategory === '地毯') return '地毯'
  return '其他'
}

export async function fetchImagePostAssetBindings(postId: string): Promise<ImagePostAssetBinding[]> {
  const response = await fetch(dreamHomeApiUrl(`/api/image-posts/${encodeURIComponent(postId)}/asset-bindings`))
  if (!response.ok) throw new Error(`图文热点加载失败 (${response.status})`)
  const payload = await response.json() as ImagePostAssetBindingsResponse
  return Array.isArray(payload.bindings)
    ? payload.bindings.filter((binding) => binding.status === 'ready' && Boolean(binding.model_url))
    : []
}

export function mergeImagePostAssetBindings(bindings: ImagePostAssetBinding[]): {
  hotspots: ImagePostHotspot[]
  assets: LibraryComponent[]
} {
  const dynamicHotspots = bindings.map((binding): ImagePostHotspot => ({
    assetId: binding.asset_id,
    name: binding.name || binding.labels?.sub || binding.labels?.category || '家具',
    slideIndex: binding.slide_index,
    bbox: binding.bbox,
  }))
  const hotspotMap = new Map(
    IMAGE_POST_HOTSPOTS.map((hotspot) => [`${hotspot.assetId}:${hotspot.slideIndex}`, hotspot]),
  )
  for (const hotspot of dynamicHotspots) {
    hotspotMap.set(`${hotspot.assetId}:${hotspot.slideIndex}`, hotspot)
  }

  const assetMap = new Map(IMAGE_POST_ASSETS.map((asset) => [asset.id, asset]))
  for (const binding of bindings) {
    if (assetMap.has(binding.asset_id)) continue
    const labels = binding.labels ?? {}
    const category = furnitureCategory(labels.category)
    const slideNumber = binding.slide_index + 1
    const thumbnail = mediaUrl(binding.thumbnail_url || '')
    assetMap.set(binding.asset_id, {
      id: binding.asset_id,
      category,
      sourceCategory: labels.category,
      name: binding.name || labels.sub || labels.category || '家具',
      source: `${IMAGE_POST_AUTHOR} · 图文第 ${slideNumber} 张`,
      sourceDescription: `抖音图文原图第 ${slideNumber} 张定位生成`,
      size: `${labels.size_class || '尺寸待补充'}`,
      styleTags: [...(labels.styles || []), ...(labels.materials || []), ...(labels.colors || [])],
      thumbnail: thumbnail || binding.name || '家具',
      color: CATEGORY_COLOR[category],
      sticker: thumbnail,
      completedImageUrl: thumbnail,
      sourceCropUrl: dreamHomeApiUrl(`/storage/image-posts/${IMAGE_POST_ID}/${String(slideNumber).padStart(2, '0')}.webp`),
      modelUrl: mediaUrl(binding.model_url || ''),
      sourceVideo: {
        blogger: IMAGE_POST_AUTHOR,
        frameTime: `第 ${slideNumber} 张`,
        frameImg: dreamHomeApiUrl(`/storage/image-posts/${IMAGE_POST_ID}/${String(slideNumber).padStart(2, '0')}.webp`),
        videoId: IMAGE_POST_ID,
        startSec: binding.slide_index,
        endSec: binding.slide_index,
        appearances: dynamicHotspots
          .filter((hotspot) => hotspot.assetId === binding.asset_id)
          .map((hotspot) => ({
            startSec: hotspot.slideIndex,
            endSec: hotspot.slideIndex,
            representativeSec: hotspot.slideIndex,
          })),
      },
    })
  }
  return { hotspots: [...hotspotMap.values()], assets: [...assetMap.values()] }
}

type ImagePostAssetSeed = ImagePostHotspot & {
  additionalHotspots?: Array<Pick<ImagePostHotspot, 'slideIndex' | 'bbox'>>
  category: FurnitureCategory
  sourceCategory: string
  styleTags: string[]
  size: string
  modelPath: string
  thumbnailPath: string
  color: string
}

const SEEDS: ImagePostAssetSeed[] = [
  {
    assetId: "ast_ad5525ea3cd7",
    name: "休闲椅",
    slideIndex: 0,
    bbox: [0.48,0.52,0.2,0.13] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 1, bbox: [0.60, 0.45, 0.30, 0.22] },
      { slideIndex: 2, bbox: [0.24, 0.13, 0.56, 0.30] },
    ],
    category: "其他" as FurnitureCategory,
    sourceCategory: "单椅",
    styleTags: ["现代","布艺","金属","绿色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/6d568f4b4bc3d2353910cf6e58cf061e.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_ad5525ea3cd7.png",
    color: "#8a7355",
  },
  {
    assetId: "ast_aa869bdbc7df",
    name: "吊灯",
    slideIndex: 1,
    bbox: [0.49,0.02,0.21,0.28] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 0, bbox: [0.43, 0.24, 0.22, 0.20] },
    ],
    category: "吊灯" as FurnitureCategory,
    sourceCategory: "灯具",
    styleTags: ["现代","北欧","纸艺","白色"],
    size: "大 · 尺寸待补充",
    modelPath: "/storage/models/bef5e9b23da20958b1ffecad21f955f9.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_aa869bdbc7df.png",
    color: "#c9a227",
  },
  {
    assetId: "ast_fe736b8ec699",
    name: "双人沙发",
    slideIndex: 0,
    bbox: [0.62,0.54,0.34,0.2] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 1, bbox: [0.66, 0.60, 0.34, 0.32] },
    ],
    category: "沙发" as FurnitureCategory,
    sourceCategory: "沙发",
    styleTags: ["现代","布艺","实木","黑色","黄色","红色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/65a504f6de4b8be99a4fc2d54b7a8354.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_fe736b8ec699.png",
    color: "#7a5d4b",
  },
  {
    assetId: "ast_afd6f3601580",
    name: "边桌",
    slideIndex: 2,
    bbox: [0.27,0.48,0.48,0.38] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 0, bbox: [0.40, 0.56, 0.18, 0.15] },
      { slideIndex: 1, bbox: [0.34, 0.50, 0.30, 0.22] },
    ],
    category: "茶几" as FurnitureCategory,
    sourceCategory: "桌子",
    styleTags: ["现代","金属","黑色"],
    size: "小 · 尺寸待补充",
    modelPath: "/storage/models/100e9e3b6100b81f657f02339b3b45aa.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_afd6f3601580.png",
    color: "#695b4b",
  },
  {
    assetId: "ast_ec7bd4765edf",
    name: "圆桌",
    slideIndex: 4,
    bbox: [0.34,0.47,0.45,0.22] as [number, number, number, number],
    category: "茶几" as FurnitureCategory,
    sourceCategory: "桌子",
    styleTags: ["现代","金属","实木","深灰色","棕色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/b6b638e72907aab4dcb403d37168c88c.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_ec7bd4765edf.png",
    color: "#695b4b",
  },
  {
    assetId: "ast_9744402b7797",
    name: "餐椅",
    slideIndex: 4,
    bbox: [0.27,0.55,0.19,0.24] as [number, number, number, number],
    category: "其他" as FurnitureCategory,
    sourceCategory: "单椅",
    styleTags: ["现代","金属","木质","棕色","银色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/0b2cc597f0df003010a0e87a44514f7e.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_9744402b7797.png",
    color: "#8a7355",
  },
  {
    assetId: "ast_ec584a8d45a8",
    name: "餐椅",
    slideIndex: 4,
    bbox: [0.74,0.56,0.2,0.24] as [number, number, number, number],
    category: "其他" as FurnitureCategory,
    sourceCategory: "单椅",
    styleTags: ["现代","布艺","实木","金属","蓝色","棕色","银色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/d1e06db5b2039c6d83861a5007ea97de.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_ec584a8d45a8.png",
    color: "#8a7355",
  },
  {
    assetId: "ast_82bd6f3c7fb4",
    name: "吊灯",
    slideIndex: 4,
    bbox: [0.48,0.09,0.2,0.29] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 0, bbox: [0.77, 0.00, 0.23, 0.16] },
    ],
    category: "吊灯" as FurnitureCategory,
    sourceCategory: "灯具",
    styleTags: ["现代","金属","布艺","白色","银色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/ba6286118a0f5b6726086f39b25bfe27.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_82bd6f3c7fb4.png",
    color: "#c9a227",
  },
  {
    assetId: "ast_53378341afb0",
    name: "置物架",
    slideIndex: 6,
    bbox: [0.04,0.05,0.82,0.88] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 0, bbox: [0.04, 0.27, 0.33, 0.38] },
      { slideIndex: 1, bbox: [0.00, 0.15, 0.42, 0.40] },
      { slideIndex: 7, bbox: [0.81, 0.10, 0.19, 0.62] },
    ],
    category: "其他" as FurnitureCategory,
    sourceCategory: "柜子",
    styleTags: ["现代","工业风","金属","木材","棕色","白色","灰色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/33c71a3f59a65f442c6119c1b80aecbc.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_53378341afb0.png",
    color: "#8a7355",
  },
  {
    assetId: "ast_f26609d506f5",
    name: "边桌",
    slideIndex: 8,
    bbox: [0.43,0.35,0.43,0.46] as [number, number, number, number],
    additionalHotspots: [
      { slideIndex: 0, bbox: [0.86, 0.57, 0.13, 0.18] },
    ],
    category: "茶几" as FurnitureCategory,
    sourceCategory: "桌子",
    styleTags: ["现代","金属","银色"],
    size: "小 · 尺寸待补充",
    modelPath: "/storage/models/421f9e73e511cbb184c37df372e0b2ac.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_f26609d506f5.png",
    color: "#695b4b",
  },
  {
    assetId: "ast_66867682801e",
    name: "床铺",
    slideIndex: 9,
    bbox: [0.08,0.56,0.76,0.30] as [number, number, number, number],
    category: "其他" as FurnitureCategory,
    sourceCategory: "床",
    styleTags: ["现代","布艺","蓝色","白色"],
    size: "大 · 尺寸待补充",
    modelPath: "/storage/models/5adcfabf70a0038c00254ed73ce3b6e1.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_66867682801e.png",
    color: "#8a7355",
  },
  {
    assetId: "ast_9cc339d8da1f",
    name: "抽屉",
    slideIndex: 9,
    bbox: [0.8,0.42,0.11,0.13] as [number, number, number, number],
    category: "其他" as FurnitureCategory,
    sourceCategory: "柜子",
    styleTags: ["现代","实木","金属","棕色"],
    size: "中 · 尺寸待补充",
    modelPath: "/storage/models/cb94e86acd23b107787f8b5b5fdb1b8b.glb",
    thumbnailPath: "/storage/thumbs/selection_ast_9cc339d8da1f.png",
    color: "#8a7355",
  },
]

export const IMAGE_POST_HOTSPOTS: ImagePostHotspot[] = SEEDS.flatMap(({
  assetId, name, slideIndex, bbox, additionalHotspots = [],
}) => [
  { assetId, name, slideIndex, bbox },
  ...additionalHotspots.map((hotspot) => ({ assetId, name, ...hotspot })),
])

export const IMAGE_POST_ASSETS: LibraryComponent[] = SEEDS.map((seed) => {
  const slideNumber = seed.slideIndex + 1
  const thumbnailUrl = dreamHomeApiUrl(seed.thumbnailPath)
  return {
    id: seed.assetId,
    category: seed.category,
    sourceCategory: seed.sourceCategory,
    name: seed.name,
    source: `${IMAGE_POST_AUTHOR} · 图文第 ${slideNumber} 张`,
    sourceDescription: `抖音图文原图第 ${slideNumber} 张定位生成`,
    size: seed.size,
    styleTags: seed.styleTags,
    thumbnail: seed.name,
    color: seed.color,
    sticker: thumbnailUrl,
    completedImageUrl: thumbnailUrl,
    sourceCropUrl: `/image-posts/${IMAGE_POST_ID}/${String(slideNumber).padStart(2, '0')}.webp`,
    modelUrl: dreamHomeApiUrl(seed.modelPath),
    sourceVideo: {
      blogger: IMAGE_POST_AUTHOR,
      frameTime: `第 ${slideNumber} 张`,
      frameImg: `/image-posts/${IMAGE_POST_ID}/${String(slideNumber).padStart(2, '0')}.webp`,
      videoId: IMAGE_POST_ID,
      startSec: seed.slideIndex,
      endSec: seed.slideIndex,
      appearances: [
        { slideIndex: seed.slideIndex },
        ...(seed.additionalHotspots ?? []),
      ].map(({ slideIndex }) => ({
        startSec: slideIndex,
        endSec: slideIndex,
        representativeSec: slideIndex,
      })),
    },
  }
})
