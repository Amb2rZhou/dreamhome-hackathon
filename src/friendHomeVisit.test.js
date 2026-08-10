import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const home = readFileSync(resolve(process.cwd(), 'web/prototype/pages/my-home/index.html'), 'utf8')

describe('friend shared home visit', () => {
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
  })

  it('mounts the visitor buddy only from a friend share card and leaves editing clean', () => {
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT)')
    expect(home).toContain('mountFireBuddyHomeVisitor({THREE,scene,camera,renderer')
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT&&edit)')
    expect(home).toContain("mode=edit&userId=${encodeURIComponent(CURRENT_USER_ID)}")
  })
})
