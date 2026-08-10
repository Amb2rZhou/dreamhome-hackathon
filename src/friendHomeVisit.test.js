import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCollectedHome } from '../web/prototype/pages/shared/home-experience.js'

const home = readFileSync(resolve(process.cwd(), 'web/prototype/pages/my-home/index.html'), 'utf8')
const chat = readFileSync(resolve(process.cwd(), 'web/prototype/pages/chat/index.html'), 'utf8')

describe('friend shared home visit', () => {
  it('creates a read-only owned copy with the complete share provenance', () => {
    const source = { id:'home-shared', ownerId:'sunny', name:'卧室', placements:[{ id:'p1', assetId:'ast_1', homeId:'home-shared' }] }
    let sequence = 0
    const copy = createCollectedHome({
      sourceHome:source,
      currentUserId:'amber',
      sourceHomeId:'home-origin',
      sourceShareId:'share-1',
      originalOwnerId:'sunny',
      createId:(prefix) => `${prefix}-${++sequence}`,
      createdAt:'2026-08-11T00:00:00.000Z',
    })
    expect(copy).toMatchObject({ ownerId:'amber', sourceHomeId:'home-origin', sourceShareId:'share-1', originalOwnerId:'sunny', readOnly:true })
    expect(copy.placements[0]).toMatchObject({ assetId:'ast_1', homeId:copy.id })
    expect(source.placements[0].homeId).toBe('home-shared')
  })

  it('keeps the friend visit UI separate from the owner editor and inspiration cases', () => {
    expect(home).toContain('id="friendHomeAction"')
    expect(home).toContain("classList.toggle('is-friend-share',editor&&IS_FRIEND_SHARE_VISIT)")
    expect(home).toContain('.dh-root.is-friend-share .case-layout-actions')
    expect(home).toContain("IS_FRIEND_SHARE_VISIT?'好友分享 · 只读参观'")
  })

  it('copies the home layout while preserving canonical asset references', () => {
    expect(home).toContain("sourceShareId:QUERY.get('shareId')")
    expect(home).toContain('currentUserId:CURRENT_USER_ID')
    expect(home).toContain('createCollectedHome({sourceHome:state.project')
    expect(home).toContain("if((!state.friendMode&&!IS_FRIEND_SHARE_VISIT)||!state.project)return")
    expect(home).toContain("event.preventDefault();event.stopPropagation();collectCaseHome()")
    expect(home).toContain('sourceHomeId:shareMessage?.home?.sourceHomeId||sourceHomeIdFor(state.project)')
    expect(home).toContain("sourceShareId:QUERY.get('shareId')")
    expect(home).toContain("originalOwnerId:QUERY.get('ownerId')")
  })

  it('starts every chat-card visit uncollected and reveals editing only after cloning', () => {
    expect(home).toContain('if(state.friendMode&&!IS_FRIEND_SHARE_VISIT)state.collectedCopy=existingCaseCopy()')
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT&&state.collectedCopy){openCollectedCopy(state.collectedCopy,{edit:true});return;}')
    expect(home).toContain('const existing=!IS_FRIEND_SHARE_VISIT&&existingCaseCopy()')
    expect(home).toContain("tell('已收藏到我的家',{label:'去编辑'")
    expect(home).toContain("mode=edit&userId=${encodeURIComponent(CURRENT_USER_ID)}")
  })

  it('keeps visitor controls read-only and furniture collection canonical', () => {
    expect(home).toContain('.dh-root.is-friend-share #daylightButton,.dh-root.is-friend-share #caseEditButton{display:none!important}')
    expect(home).toContain('.dh-root.is-friend-share #resetViewButton,.dh-root.is-friend-share #shareButton{display:grid!important}')
    expect(home).toContain("await addCanonicalAssetToLibrary(id,'friend-share-home')")
    expect(home).toContain('ui.assetDetailTry.hidden=state.friendMode')
  })

  it('uses the approved waving mascot and content-sized share toast', () => {
    expect(chat).toContain('../../assets/mascot/share-card-wave.png')
    expect(chat).toContain('.home-mascot-slot { position:absolute; z-index:7; right:0; bottom:-16px;')
    expect(home).toContain('.toast.is-share-success{display:inline-flex;width:auto;min-width:0;max-width:calc(100% - 32px)')
  })

  it('mounts the visitor buddy only from a friend share card and leaves editing clean', () => {
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT)')
    expect(home).toContain('mountFireBuddyHomeVisitor({THREE,scene,camera,renderer')
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT&&edit)')
    expect(home).toContain("mode=edit&userId=${encodeURIComponent(CURRENT_USER_ID)}")
  })
})
