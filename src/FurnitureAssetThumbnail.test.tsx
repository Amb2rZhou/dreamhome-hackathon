import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  FurnitureAssetThumbnail,
  furnitureThumbnailUrl,
} from './FurnitureAssetThumbnail'
import type { LibraryComponent } from './types'

const component: LibraryComponent = {
  id: 'ast_test123',
  category: '沙发',
  name: '测试沙发',
  source: '测试来源',
  size: '尺寸待补充',
  styleTags: [],
  thumbnail: '🛋️',
  color: '#a97d66',
  sticker: '/asset-cdn/ast_test123/completed_input.png',
  completedImageUrl: '/asset-cdn/ast_test123/completed_input.jpg',
}

describe('FurnitureAssetThumbnail delivery fallback', () => {
  it('maps legacy asset-cdn images to the reviewed bundled thumbnail', () => {
    expect(furnitureThumbnailUrl(component)).toBe(
      '/prototype/assets/library/ast_test123.jpg',
    )
  })

  it('replaces a failed image with a generated non-broken fallback', () => {
    render(<FurnitureAssetThumbnail component={component} alt="测试沙发" />)
    const image = screen.getByRole('img', { name: '测试沙发' })

    expect(image).toHaveAttribute(
      'src',
      '/prototype/assets/library/ast_test123.jpg',
    )
    fireEvent.error(image)
    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
  })
})
