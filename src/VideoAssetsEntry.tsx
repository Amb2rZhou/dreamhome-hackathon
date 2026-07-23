import { useEffect, useMemo, useState } from 'react'
import { FrameAssetsDrawer } from './FrameAssetsDrawer'
import type { LibraryComponent } from './types'
import './VideoAssetsEntry.css'

export function VideoAssetsEntry({
  assets,
  favoriteIds,
  onFavorite,
  onFavoriteAll,
}: {
  assets: LibraryComponent[]
  favoriteIds: string[]
  onFavorite: (id: string) => void
  onFavoriteAll: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const assetIds = useMemo(() => assets.map((asset) => asset.id), [assets])
  const allSaved = assetIds.length > 0 && assetIds.every((id) => favoriteIds.includes(id))

  useEffect(() => {
    setOpen(false)
    setSavedNotice(false)
  }, [assets])

  const favoriteAll = () => {
    if (assetIds.length === 0 || allSaved) return
    onFavoriteAll(assetIds)
    setSavedNotice(true)
    window.setTimeout(() => setSavedNotice(false), 2200)
  }

  return (
    <>
      <button
        type="button"
        className="video-assets-entry"
        aria-haspopup="dialog"
        aria-label={assets.length > 0
          ? `查看本条视频的全部 ${assets.length} 个 3D 组件`
          : '查看本条视频的全部 3D 组件'}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 2.8 7.8 4.5v9L12 20.8l-7.8-4.5v-9L12 2.8Z" />
          <path d="m4.4 7.4 7.6 4.4 7.6-4.4M12 11.8v8.7" />
        </svg>
        <span>全部 3D 组件</span>
        <b>{assets.length}</b>
        <i aria-hidden="true">›</i>
      </button>

      {savedNotice && (
        <div className="video-assets-saved" role="status">
          已收藏本条视频的 {assets.length} 个组件
        </div>
      )}

      {open && (
        <FrameAssetsDrawer
          assets={assets}
          favoriteIds={favoriteIds}
          onFavorite={onFavorite}
          onFavoriteAll={favoriteAll}
          onClose={() => setOpen(false)}
          title={`本条视频 · 全部 ${assets.length} 个 3D 组件`}
          subtitle="按整条视频汇总，不受当前播放帧限制"
          ariaLabel="本条视频全部 3D 组件"
        />
      )}
    </>
  )
}
