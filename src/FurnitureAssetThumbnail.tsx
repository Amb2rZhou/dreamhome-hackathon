import { useEffect, useMemo, useState } from 'react'
import { genSticker } from './stickerGen'
import type { LibraryComponent } from './types'
import './FurnitureAssetThumbnail.css'

function normalizeBundledThumbnailUrl(component: LibraryComponent, url: string) {
  // Older static discover bundles kept the backend-facing provenance URL.
  // Canonical reviewed thumbnails are shipped as JPG files in the prototype.
  if (url.startsWith(`/asset-cdn/${component.id}/`)) {
    return `/prototype/assets/library/${component.id}.jpg`
  }
  return url
}

export function furnitureThumbnailUrl(component: LibraryComponent) {
  return normalizeBundledThumbnailUrl(
    component,
    component.completedImageUrl ?? component.sticker,
  )
}

function furnitureThumbnailCandidates(component: LibraryComponent) {
  const urls = [component.completedImageUrl, component.sticker]
    .filter((url): url is string => Boolean(url))
    .map((url) => normalizeBundledThumbnailUrl(component, url))

  return Array.from(new Set([
    ...urls,
    genSticker(component.category, component.color),
  ]))
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
  const candidates = useMemo(
    () => furnitureThumbnailCandidates(component),
    [component],
  )
  const [candidateIndex, setCandidateIndex] = useState(0)

  useEffect(() => setCandidateIndex(0), [candidates])

  return (
    <img
      className={`furniture-asset-thumbnail ${className}`.trim()}
      src={candidates[candidateIndex]}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setCandidateIndex((current) => (
        Math.min(current + 1, candidates.length - 1)
      ))}
    />
  )
}
