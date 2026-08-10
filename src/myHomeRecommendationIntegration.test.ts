import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'web/prototype/pages/my-home/index.html'),
  'utf8',
)

describe('my-home structured recommendation integration', () => {
  it('sends the complete structured room context to the backend', () => {
    expect(source).toContain("placedItemIds:[...new Set(placements.map((item)=>item.assetId).filter(Boolean))]")
    expect(source).toContain('categories:[...profile.categories]')
    expect(source).toContain('materials:profile.materials.slice(0,8)')
    expect(source).toContain('sourceVideoId')
    expect(source).toContain('seenItemIds:[...state.drawerAiSeenIds]')
  })

  it('resolves remote ids canonically and keeps local recommendations as fallback', () => {
    expect(source).toContain('const canonical=resolveAsset(item.id)')
    expect(source).toContain('state.drawerAiRemoteRecommendations=null;state.drawerAiBatchIds=[]')
    expect(source).toContain('if(!remote.length)return getLocalDrawerAiRecommendations()')
    expect(source).toContain('state.drawerAiBatchIds=remote.map((asset)=>asset.id)')
  })

  it('keeps current cards visible while the request is pending', () => {
    expect(source).toContain('state.drawerAiLoading=true')
    expect(source).not.toContain("ui.assetRail.innerHTML='<p class=\"asset-empty\">加载中")
  })
})
