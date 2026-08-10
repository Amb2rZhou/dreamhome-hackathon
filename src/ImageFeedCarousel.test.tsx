import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageFeedCarousel } from './ImageFeedCarousel'

describe('ImageFeedCarousel', () => {
  afterEach(() => vi.useRealTimers())

  it('moves between real image slides without pretending they are a video', () => {
    render(<ImageFeedCarousel images={['/one.jpg', '/two.jpg']} title="图文 Demo" playing={false} />)
    expect(screen.getByAltText('图文 Demo，第 1 张')).toHaveAttribute('src', '/one.jpg')
    fireEvent.click(screen.getByRole('button', { name: '查看第 2 张' }))
    expect(screen.getByAltText('图文 Demo，第 2 张')).toHaveAttribute('src', '/two.jpg')
  })

  it('shows an explicit pending state when original media is unavailable', () => {
    render(<ImageFeedCarousel images={[]} title="图文 Demo" playing={false} />)
    expect(screen.getByRole('img', { name: '图文 Demo原图待导入' })).toBeInTheDocument()
  })

  it('offers an explicit background-music control when audio exists', () => {
    render(
      <ImageFeedCarousel
        images={['/one.jpg']}
        title="图文 Demo"
        audioSrc="/music.mp3"
        playing={false}
      />,
    )
    expect(screen.getByRole('button', { name: '播放背景音乐' })).toBeInTheDocument()
  })

  it('automatically advances while the image post is playing', () => {
    vi.useFakeTimers()
    render(<ImageFeedCarousel images={['/one.jpg', '/two.jpg']} title="图文 Demo" playing />)

    act(() => vi.advanceTimersByTime(4200))

    expect(screen.getByAltText('图文 Demo，第 2 张')).toHaveAttribute('src', '/two.jpg')
  })

  it('keeps the current slide fixed while paused', () => {
    vi.useFakeTimers()
    render(<ImageFeedCarousel images={['/one.jpg', '/two.jpg']} title="图文 Demo" playing={false} />)

    act(() => vi.advanceTimersByTime(8400))

    expect(screen.getByAltText('图文 Demo，第 1 张')).toHaveAttribute('src', '/one.jpg')
  })

  it('binds hotspots to their original slide and opens the matching 3D asset', () => {
    const onHotspotActivate = vi.fn()
    const hotspots = [
      { assetId: 'ast_chair', name: '休闲椅', slideIndex: 0, bbox: [0.4, 0.5, 0.2, 0.2] as [number, number, number, number] },
      { assetId: 'ast_lamp', name: '吊灯', slideIndex: 1, bbox: [0.4, 0.1, 0.2, 0.2] as [number, number, number, number] },
    ]
    render(
      <ImageFeedCarousel
        images={['/one.jpg', '/two.jpg']}
        title="图文 Demo"
        playing={false}
        hotspots={hotspots}
        onHotspotActivate={onHotspotActivate}
      />,
    )

    fireEvent.load(screen.getByAltText('图文 Demo，第 1 张'))
    fireEvent.click(screen.getByRole('button', { name: '查看休闲椅3D' }))
    expect(onHotspotActivate).toHaveBeenCalledWith(hotspots[0])
    expect(screen.queryByRole('button', { name: '查看吊灯3D' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看第 2 张' }))
    expect(screen.queryByRole('button', { name: '查看吊灯3D' })).not.toBeInTheDocument()
    fireEvent.load(screen.getByAltText('图文 Demo，第 2 张'))
    expect(screen.getByRole('button', { name: '查看吊灯3D' })).toBeInTheDocument()
  })

  it('reuses one canonical asset across multiple image appearances', () => {
    const onHotspotActivate = vi.fn()
    const hotspots = [
      { assetId: 'ast_chair', name: '休闲椅', slideIndex: 0, bbox: [0.4, 0.5, 0.2, 0.2] as [number, number, number, number] },
      { assetId: 'ast_chair', name: '休闲椅', slideIndex: 1, bbox: [0.6, 0.4, 0.2, 0.2] as [number, number, number, number] },
    ]
    render(
      <ImageFeedCarousel
        images={['/one.jpg', '/two.jpg']}
        title="图文 Demo"
        playing={false}
        hotspots={hotspots}
        onHotspotActivate={onHotspotActivate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看第 2 张' }))
    fireEvent.load(screen.getByAltText('图文 Demo，第 2 张'))
    fireEvent.click(screen.getByRole('button', { name: '查看休闲椅3D' }))

    expect(onHotspotActivate).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'ast_chair', slideIndex: 1 }))
  })

  it('does not show hotspots or enter selection before the image is ready', () => {
    const onPause = vi.fn()
    render(
      <ImageFeedCarousel
        images={['/slow.jpg']}
        title="图文 Demo"
        playing
        onPause={onPause}
        hotspots={[{ assetId: 'ast_chair', name: '休闲椅', slideIndex: 0, bbox: [0.4, 0.5, 0.2, 0.2] }]}
      />,
    )

    const image = screen.getByAltText('图文 Demo，第 1 张')
    expect(screen.queryByRole('button', { name: '查看休闲椅3D' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '圈选图片里的家具' })).not.toBeInTheDocument()
    fireEvent.click(image)
    expect(onPause).not.toHaveBeenCalled()

    fireEvent.load(image)
    expect(screen.getByRole('button', { name: '查看休闲椅3D' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '圈选图片里的家具' }))
    expect(onPause).toHaveBeenCalledOnce()
  })
})
