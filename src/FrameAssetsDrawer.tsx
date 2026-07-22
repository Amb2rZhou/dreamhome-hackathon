import { useEffect, useMemo, useState } from 'react'
import { FurnitureAssetThumbnail, furnitureThumbnailUrl } from './FurnitureAssetThumbnail'
import { FurnitureModelPreview } from './FurnitureModelPreview'
import type { LibraryComponent } from './types'
import './FrameAssetsDrawer.css'

export function FrameAssetsDrawer({
  assets,
  favoriteIds = [],
  onClose,
  onFavorite,
  title,
  subtitle,
  ariaLabel,
}: {
  assets: LibraryComponent[]
  favoriteIds?: string[]
  onClose: () => void
  onFavorite: (id: string) => void
  title?: string
  subtitle?: string
  ariaLabel?: string
}) {
  const [activeId, setActiveId] = useState(assets[0]?.id ?? '')
  const activeIndex = useMemo(() => {
    const index = assets.findIndex((asset) => asset.id === activeId)
    return index >= 0 ? index : 0
  }, [activeId, assets])
  const active = assets[activeIndex]

  useEffect(() => {
    if (assets.some((asset) => asset.id === activeId)) return
    setActiveId(assets[0]?.id ?? '')
  }, [activeId, assets])

  if (!active) return null

  return (
    <div
      className="frame-assets-drawer-layer"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-hidden="false"
    >
      <section
        className="frame-assets-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? '本帧识别家具详情'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="frame-assets-drawer-handle" aria-hidden="true" />

        <header className="frame-assets-drawer-header">
          <div>
            <strong>{title ?? `本帧识别 ${assets.length} 件`}</strong>
            <span>{subtitle ?? '点选缩略图，直接切换对应 3D 家具'}</span>
          </div>
        </header>

        <div className="frame-assets-drawer-preview" role="tabpanel" aria-label={`${active.name} 3D预览`}>
          <FurnitureModelPreview
            key={active.id}
            modelUrl={active.modelUrl}
            fallbackImage={furnitureThumbnailUrl(active)}
            name={active.name}
          />
        </div>

        <div className="frame-assets-drawer-tabs" role="tablist" aria-label="本帧家具">
          {assets.map((asset, index) => (
            <button
              type="button"
              key={asset.id}
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`查看${asset.name}`}
              className={index === activeIndex ? 'is-active' : ''}
              onClick={() => setActiveId(asset.id)}
            >
              <span><FurnitureAssetThumbnail component={asset} /></span>
              <small>{asset.name}</small>
            </button>
          ))}
        </div>

        <div className="frame-assets-drawer-info">
          <div className="frame-assets-drawer-meta">
            <span>{activeIndex + 1} / {assets.length}</span>
            <h3>{active.name}</h3>
            <p>{active.sourceCategory ?? active.category} · {active.size}</p>
            <div className="frame-assets-drawer-tags">
              {active.styleTags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}
            </div>
          </div>
          <div className="frame-assets-drawer-actions">
            <button
              type="button"
              className={`frame-assets-favorite ${favoriteIds.includes(active.id) ? 'is-favorite' : ''}`}
              aria-pressed={favoriteIds.includes(active.id)}
              onClick={() => onFavorite(active.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
              </svg>
              {favoriteIds.includes(active.id) ? '已收藏' : '收藏'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
