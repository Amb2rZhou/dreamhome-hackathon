import type { SelectionMatchCandidate } from './videoSelectionApi'
import { AssetMatchViewer } from './AssetMatchViewer'
import './AssetReuseDialog.css'

export function AssetReuseDialog({
  candidate,
  onReuse,
  onGenerate,
}: {
  candidate: SelectionMatchCandidate
  onReuse: () => void
  onGenerate: () => void
}) {
  const asset = candidate.asset
  const category = asset.labels?.sub || asset.labels?.category || '家具'
  const score = Math.max(0, Math.min(100, Math.round(candidate.score * 100)))

  return (
    <div className="asset-reuse-backdrop" role="presentation">
      <section className="asset-reuse-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-reuse-title">
        <div className="asset-reuse-preview">
          <AssetMatchViewer
            modelUrl={asset.glb_url}
            fallbackImage={asset.thumb_url}
            name={asset.name || category}
          />
          <i>已有 3D</i>
        </div>
        <div className="asset-reuse-copy">
          <p>资产库里找到疑似同款</p>
          <h2 id="asset-reuse-title">{asset.name || category}</h2>
          <span>
            相似度 {score}%{candidate.reason ? ` · ${candidate.reason}` : ''}
          </span>
        </div>
        <button type="button" className="asset-reuse-primary" onClick={onReuse}>
          直接使用已有 3D
        </button>
        <button type="button" className="asset-reuse-secondary" onClick={onGenerate}>
          不是同款 · 重新生成新的 3D
        </button>
      </section>
    </div>
  )
}
