import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VideoAssetsEntry } from './VideoAssetsEntry'
import type { LibraryComponent } from './types'

vi.mock('./FrameAssetsDrawer', () => ({
  FrameAssetsDrawer: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="本条视频全部 3D 组件">
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}))

const asset: LibraryComponent = {
  id: 'asset-1',
  category: '沙发',
  name: '沙发',
  source: 'test',
  size: 'unknown',
  styleTags: [],
  thumbnail: '🛋️',
  color: '#fff',
  sticker: 'data:image/svg+xml,',
}

function ControlledEntry({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <VideoAssetsEntry
      videoId={videoId}
      assets={[asset]}
      favoriteIds={[]}
      onFavorite={() => {}}
      onFavoriteAll={() => {}}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  )
}

describe('VideoAssetsEntry', () => {
  it('keeps drawer ownership above the video entry across rerenders', () => {
    const view = render(<ControlledEntry videoId="video-a" />)
    fireEvent.click(screen.getByRole('button', { name: /查看本条视频的全部/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    view.rerender(<ControlledEntry videoId="video-a" />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
