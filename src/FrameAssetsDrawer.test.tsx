import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FrameAssetsDrawer } from './FrameAssetsDrawer'

describe('FrameAssetsDrawer interaction isolation', () => {
  it('supports mouse close without leaking the click to the Feed', () => {
    const onFeedClick = vi.fn()
    const onClose = vi.fn()
    render(
      <div onClick={onFeedClick}>
        <FrameAssetsDrawer assets={[]} onFavorite={() => {}} onClose={onClose} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭全部 3D 组件' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onFeedClick).not.toHaveBeenCalled()
  })

  it('contains touch and wheel gestures so the Feed cannot switch videos', () => {
    const onFeedTouchEnd = vi.fn()
    const onFeedWheel = vi.fn()
    const onClose = vi.fn()
    const view = render(
      <div onTouchEnd={onFeedTouchEnd} onWheel={onFeedWheel}>
        <FrameAssetsDrawer assets={[]} onFavorite={() => {}} onClose={onClose} />
      </div>,
    )
    const layer = view.container.querySelector('.frame-assets-drawer-layer')
    expect(layer).not.toBeNull()

    fireEvent.touchStart(layer!)
    fireEvent.touchMove(layer!)
    fireEvent.touchEnd(layer!)
    fireEvent.wheel(layer!, { deltaY: 120 })

    expect(onFeedTouchEnd).not.toHaveBeenCalled()
    expect(onFeedWheel).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
