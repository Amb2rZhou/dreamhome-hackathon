import { useState } from 'react'
import { CURRENT_BLOGGER, BLOGGER_HOME_PACK, type LibraryComponent } from './types'
import { HomePreview } from './HomePreview'
import './Profile.css'

interface ProfileProps {
  onClose: () => void
  onEnterHome: () => void
}

export function Profile({ onClose, onEnterHome }: ProfileProps) {
  const [active, setActive] = useState<LibraryComponent | null>(null)

  return (
    <div className="profile-root">
      <div className="prof-topbar">
        <button className="prof-back" onClick={onClose}>←</button>
        <div className="prof-handle">@{CURRENT_BLOGGER.handle}</div>
        <button className="prof-more">⋯</button>
      </div>

      <div className="prof-header">
        <div className="prof-avatar" style={{ background: CURRENT_BLOGGER.avatarColor }}>
          {CURRENT_BLOGGER.name.slice(0, 1)}
        </div>
        <div className="prof-name">{CURRENT_BLOGGER.name}</div>
        <div className="prof-bio">{CURRENT_BLOGGER.bio}</div>
        <div className="prof-stats">
          <div className="prof-stat"><b>{CURRENT_BLOGGER.followers}</b><span>粉丝</span></div>
          <div className="prof-stat"><b>{CURRENT_BLOGGER.likes}</b><span>获赞</span></div>
          <div className="prof-stat"><b>{BLOGGER_HOME_PACK.length}</b><span>小家组件</span></div>
        </div>
        <div className="prof-actions">
          <button className="prof-follow">关注</button>
          <button className="prof-msg">私信</button>
        </div>
      </div>

      <div className="prof-divider" />

      <div className="prof-tabs">
        <span className="prof-tab active">小家</span>
        <span className="prof-tab">视频 42</span>
        <span className="prof-tab">喜欢</span>
      </div>

      <div className="prof-home-entry" onClick={onEnterHome}>
        <div className="prof-home-preview">
          <HomePreview components={BLOGGER_HOME_PACK} layoutId={CURRENT_BLOGGER.homeLayoutId} size={120} />
        </div>
        <div className="prof-home-info">
          <div className="prof-home-name">{CURRENT_BLOGGER.homeName}</div>
          <div className="prof-home-desc">{CURRENT_BLOGGER.homeDesc} · 进入我的小家</div>
        </div>
        <span className="prof-home-arrow">进入 ›</span>
      </div>

      <div className="prof-grid">
        {BLOGGER_HOME_PACK.map((c, i) => (
          <button key={c.id} className="prof-card" onClick={() => setActive(c)}>
            <div className="prof-thumb">
              <img className="prof-sticker" src={c.sticker} alt={c.name} style={{ transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)` }} />
            </div>
            <div className="prof-card-name">{c.name}</div>
            <div className="prof-card-cat">{c.category}</div>
          </button>
        ))}
      </div>

      {active && (
        <div className="prof-detail-overlay" onClick={() => setActive(null)}>
          <div className="prof-detail-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="prof-detail-handle" />
            <div className="prof-detail-preview">
              <HomePreview components={[active]} layoutId={CURRENT_BLOGGER.homeLayoutId} size={200} />
            </div>
            <div className="prof-detail-info">
              <div className="prof-detail-name">{active.name}</div>
              <div className="prof-detail-tags">
                <span className="prof-detail-cat-tag">{active.category}</span>
                {active.styleTags.map((t) => <span key={t} className="prof-detail-style-tag">{t}</span>)}
              </div>
              <div className="prof-detail-row"><span className="prof-detail-label">来源</span><span>{active.source}</span></div>
              <div className="prof-detail-row"><span className="prof-detail-label">尺寸</span><span>{active.size}</span></div>
              <button className="prof-detail-close" onClick={() => setActive(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
