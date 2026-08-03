import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Mascot } from './Mascot'

vi.mock('./BlackKeyMedia', () => ({
  BlackKeyVideo: ({ onError }: { onError?: () => void }) => (
    <button type="button" data-testid="animated-mascot" onClick={onError}>animated</button>
  ),
  BlackKeyImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

const props = {
  state: 'sleeping' as const,
  awaitingCollectionView: false,
  craftStartTip: false,
  busy: false,
  collectionMode: 'none' as const,
  guideMode: null,
  progressGuideActive: false,
  notice: null,
  onOpenCollection: vi.fn(),
  onBeginOnboarding: vi.fn(),
  onProgressGuideOpened: vi.fn(),
  onCompletionGuideOpened: vi.fn(),
  onDismissStartTip: vi.fn(),
}

describe('Mascot media fallback', () => {
  beforeEach(() => {
    window.localStorage.setItem('dreamhome-feed-onboarding-v1', '1')
  })

  it('shows one animated instance and no static mascot while media works', () => {
    render(<Mascot {...props} />)

    expect(screen.getAllByTestId('animated-mascot')).toHaveLength(1)
    expect(screen.queryByAltText('包工球')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开包工球的小工坊' })).toBeInTheDocument()
  })

  it('replaces animation with the static fallback only after media failure', () => {
    render(<Mascot {...props} />)
    fireEvent.click(screen.getByTestId('animated-mascot'))

    expect(screen.queryByTestId('animated-mascot')).not.toBeInTheDocument()
    expect(screen.getByAltText('包工球')).toHaveAttribute('data-media', 'fallback')
  })
})
