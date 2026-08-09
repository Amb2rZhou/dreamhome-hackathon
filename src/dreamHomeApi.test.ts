import { describe, expect, it } from 'vitest'
import { defaultDreamHomeApiBase } from './dreamHomeApi'

describe('DreamHome API base', () => {
  it('connects local static previews to the local FastAPI service', () => {
    expect(defaultDreamHomeApiBase('127.0.0.1')).toBe('http://127.0.0.1:8000')
    expect(defaultDreamHomeApiBase('localhost')).toBe('http://127.0.0.1:8000')
  })

  it('keeps the Hong Kong production API host', () => {
    expect(defaultDreamHomeApiBase('dreamhouse.top')).toBe('https://api.dreamhouse.top')
  })
})
