import type { LibraryComponent } from './types'
import './FurnitureAssetThumbnail.css'

export function furnitureThumbnailUrl(component: LibraryComponent) {
  return component.completedImageUrl ?? component.sticker
}

export function FurnitureAssetThumbnail({
  component,
  alt = '',
  className = '',
}: {
  component: LibraryComponent
  alt?: string
  className?: string
}) {
  return (
    <img
      className={`furniture-asset-thumbnail ${className}`.trim()}
      src={furnitureThumbnailUrl(component)}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  )
}
