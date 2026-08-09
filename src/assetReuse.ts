import { CATEGORY_COLOR, type FurnitureCategory, type LibraryComponent } from './types'
import type { ReusableAsset, SelectionLabels } from './videoSelectionApi'

const SUPPORTED_CATEGORIES = new Set<FurnitureCategory>([
  '沙发', '茶几', '吊灯', '绿植', '装饰画', '地毯', '其他',
])

export function labelsToCategory(labels: SelectionLabels | undefined): FurnitureCategory {
  const category = labels?.category || '其他'
  return SUPPORTED_CATEGORIES.has(category as FurnitureCategory)
    ? category as FurnitureCategory
    : '其他'
}

export function reusableAssetToComponent(asset: ReusableAsset, fallbackSnapshot: string): LibraryComponent {
  const category = labelsToCategory(asset.labels)
  const thumbnail = asset.thumb_url || fallbackSnapshot
  return {
    id: asset.asset_id,
    category,
    sourceCategory: asset.labels?.category,
    name: asset.name || asset.labels?.sub || asset.labels?.category || '已有家具',
    source: '复用资产库 · 无需重复生成',
    sourceDescription: '已绑定现有的同款 3D 资产',
    size: '使用资产库尺寸',
    styleTags: ['已有 3D', '同款复用'],
    thumbnail,
    color: CATEGORY_COLOR[category],
    sticker: thumbnail,
    completedImageUrl: thumbnail,
    modelUrl: asset.glb_url || undefined,
    sourceVideo: asset.source?.video_id
      ? {
          blogger: 'DreamHome 资产库',
          frameTime: `${Math.max(0, asset.source.t_best || 0).toFixed(1)}s`,
          videoId: asset.source.video_id,
        }
      : undefined,
  }
}
