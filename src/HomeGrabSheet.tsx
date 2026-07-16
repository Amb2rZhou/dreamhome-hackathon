import { HomePreview } from './HomePreview'
import { BLOGGER_HOME_PACK, CURRENT_BLOGGER } from './types'
import './HomeGrabSheet.css'

interface HomeGrabSheetProps {
  onGrabAll: () => void
  onGrabItems: () => void
  onClose: () => void
}

export function HomeGrabSheet({ onGrabAll, onGrabItems, onClose }: HomeGrabSheetProps) {
  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="hg-handle" />
        <div className="hg-header">
          <div className="hg-title-wrap">
            <span className="hg-title">{CURRENT_BLOGGER.homeName}</span>
            <span className="hg-sub">{CURRENT_BLOGGER.homeDesc} · 博主实测户型</span>
          </div>
          <button className="hg-close" onClick={onClose}>✕</button>
        </div>

        <div className="hg-preview-wrap">
          <HomePreview components={BLOGGER_HOME_PACK} layoutId={CURRENT_BLOGGER.homeLayoutId} fillContainer interactive />
          <div className="hg-preview-hint">拖动可转动小家</div>
        </div>

        <div className="hg-body">
          <div className="hg-grid-label">含 {BLOGGER_HOME_PACK.length} 件软装</div>
          <div className="hg-grid">
            {BLOGGER_HOME_PACK.map((c, i) => (
              <div key={c.id} className="hg-grid-item">
                <div className="hg-grid-thumb">
                  <img className="hg-grid-sticker" src={c.sticker} alt={c.name} style={{ transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)` }} />
                </div>
                <div className="hg-grid-name">{c.name}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="hg-actions">
          <button className="hg-btn hg-btn-items" onClick={onGrabItems}>
            保存同款家居
          </button>
          <button className="hg-btn hg-btn-all" onClick={onGrabAll}>
            保存整个小家
          </button>
        </div>
      </div>
    </div>
  )
}
