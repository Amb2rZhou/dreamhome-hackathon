import { useEffect, useMemo, useRef, useState } from 'react'
import { FurnitureModelPreview } from './FurnitureModelPreview'
import type { LibraryComponent } from './types'
import type { WorkshopData, WorkshopLassoTask } from './workshopModel'
import { workshopStatusSummary } from './workshopModel'
import './WorkshopDetail.css'

interface WorkshopDetailProps {
  data: WorkshopData
  favoriteIds: string[]
  onToggleFavorite: (id: string) => void
  onClose: () => void
  onRetryTask?: (id: string) => void
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EmptyWorkshopIcon({ kind }: { kind: 'ready' | 'lasso' }) {
  return kind === 'ready' ? (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="7" y="8" width="14" height="12" rx="3" fill="currentColor" opacity=".12" />
      <rect x="27" y="8" width="14" height="12" rx="3" fill="currentColor" opacity=".12" />
      <rect x="7" y="27" width="14" height="12" rx="3" fill="currentColor" opacity=".12" />
      <circle cx="32" cy="31" r="8" fill="#f8faf5" stroke="currentColor" strokeWidth="2" />
      <path d="m38 37 4 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M9 18 24 10l15 8-15 8L9 18Z" fill="currentColor" opacity=".15" />
      <path d="M9 18v18l15 7 15-7V18l-15 8-15-8Z" fill="currentColor" opacity=".07" />
      <path d="M9 18 24 26l15-8M24 26v17M9 18v18l15 7 15-7V18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TaskRow({
  task,
  onOpen,
  onRetry,
}: {
  task: WorkshopLassoTask
  onOpen: () => void
  onRetry: () => void
}) {
  const actionable = task.status === 'completed' || task.status === 'failed'
  const content = (
    <>
      <span className="workshop-task-thumb">
        {task.imageUrl ? <img src={task.imageUrl} alt="" /> : <span aria-hidden="true">⌗</span>}
      </span>
      <span className="workshop-task-name">{task.name}</span>
      {task.status === 'processing' && <span className="workshop-task-status is-processing"><i />加工中</span>}
      {task.status === 'completed' && <span className="workshop-task-status is-completed">查看 <b>›</b></span>}
      {task.status === 'failed' && <span className="workshop-task-status is-failed">重新圈选</span>}
    </>
  )

  if (!actionable) return <div className={`workshop-task-row status-${task.status}`}>{content}</div>
  return (
    <button
      className={`workshop-task-row status-${task.status}`}
      onClick={task.status === 'completed' ? onOpen : onRetry}
    >
      {content}
    </button>
  )
}

function FurnitureDetail({
  component,
  favorite,
  onFavorite,
  onClose,
}: {
  component: LibraryComponent
  favorite: boolean
  onFavorite: () => void
  onClose: () => void
}) {
  return (
    <div
      className="workshop-furniture-layer"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <section
        className="workshop-furniture-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${component.name}详情`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workshop-furniture-preview">
          <FurnitureModelPreview
            modelUrl={component.modelUrl}
            fallbackImage={component.completedImageUrl ?? component.sticker}
            name={component.name}
          />
        </div>
        <p className="workshop-furniture-hint">
          {component.modelUrl ? '拖动旋转查看 3D 家具' : '家具素材预览'}
        </p>

        <div className="workshop-furniture-meta">
          <div>
            <h3>
              {component.name}
              {component.sourceVideo && (
                <span className="workshop-source-mark" aria-label="来自视频">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5H5v14h14v-4M13 5h6v6M19 5l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </h3>
            <p>{component.sourceCategory ?? component.category} · {component.size}</p>
          </div>
          <button
            className={`workshop-detail-favorite ${favorite ? 'is-favorite' : ''}`}
            onClick={onFavorite}
            aria-pressed={favorite}
          >
            <HeartIcon filled={favorite} />
            {favorite ? '已收藏' : '收藏'}
          </button>
        </div>

        <div className="workshop-furniture-tags" aria-label="家具标签">
          {component.styleTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        </div>

        {component.sourceDescription && (
          <p className="workshop-furniture-description">{component.sourceDescription}</p>
        )}

        {component.sourceVideo && (
          <div className="workshop-source-context">
            {component.sourceVideo.frameImg && (
              <img src={component.sourceVideo.frameImg} alt={`${component.name}来源画面`} loading="lazy" decoding="async" />
            )}
            <div>
              <strong>来源视频</strong>
              <span>{component.sourceVideo.videoId ?? component.sourceVideo.blogger}</span>
              <small>
                {component.sourceVideo.startSec !== undefined && component.sourceVideo.endSec !== undefined
                  ? `${component.sourceVideo.startSec.toFixed(1)}–${component.sourceVideo.endSec.toFixed(1)}s`
                  : component.sourceVideo.frameTime}
              </small>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export function WorkshopDetail({ data, favoriteIds, onToggleFavorite, onClose, onRetryTask }: WorkshopDetailProps) {
  const [closing, setClosing] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [activeComponent, setActiveComponent] = useState<LibraryComponent | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const appliedLassoFavoritesRef = useRef(new Set<string>())

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    setQueueExpanded(false)
    setActiveComponent(null)
  }, [data.id])

  // 圈选打造成功的家具默认收藏；同款识别进入“现有家具”时保持未收藏。
  useEffect(() => {
    const completedIds = data.lassoTasks
      .filter((task) => task.status === 'completed' && task.resultComponent)
      .map((task) => task.resultComponent!.id)
    const freshIds = completedIds.filter((id) => !appliedLassoFavoritesRef.current.has(id))
    if (freshIds.length === 0) return
    freshIds.forEach((id) => appliedLassoFavoritesRef.current.add(id))
    freshIds.filter((id) => !favoriteIds.includes(id)).forEach(onToggleFavorite)
  }, [data.lassoTasks, favoriteIds, onToggleFavorite])

  const processing = useMemo(() => data.lassoTasks.filter((task) => task.status === 'processing'), [data.lassoTasks])
  const queued = useMemo(() => data.lassoTasks.filter((task) => task.status === 'queued'), [data.lassoTasks])
  const completed = useMemo(() => data.lassoTasks.filter((task) => task.status === 'completed'), [data.lassoTasks])
  const failed = useMemo(() => data.lassoTasks.filter((task) => task.status === 'failed'), [data.lassoTasks])
  const isEmpty = data.lassoTasks.length === 0

  const leave = (action: () => void) => {
    if (closing) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(action, 240)
  }

  return (
    <div className={`workshop-overlay ${closing ? 'is-closing' : ''}`} onClick={() => leave(onClose)}>
      <section
        className={`workshop-sheet ${closing ? 'is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="包工球的小工坊"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workshop-handle" aria-hidden="true" />
        <header className="workshop-header">
          <div className="workshop-header-copy">
            <h2>包工球的小工坊</h2>
            <p><i />{workshopStatusSummary(data)}</p>
          </div>
          <img className="workshop-header-mascot" src="/mascot-workshop-header.png" alt="" />
        </header>

        <main className="workshop-scroll">
          <section className="workshop-module workshop-lasso">
            {data.lassoTasks.length === 0 ? (
              <div className="workshop-empty">
                <span><EmptyWorkshopIcon kind="lasso" /></span>
                <strong>{isEmpty ? '小工坊现在还是空的' : '暂时没有圈选家具'}</strong>
                <small>圈出视频里的家具，再把它拖进包工球的小推车</small>
              </div>
            ) : (
              <div className="workshop-task-groups">
                {failed.length > 0 && (
                  <section className="workshop-task-group group-failed">
                    <div className="workshop-task-head"><strong>需要处理</strong><span>{failed.length} 件</span></div>
                    <div className="workshop-task-list">
                      {failed.map((task) => (
                        <TaskRow key={task.id} task={task} onOpen={() => {}} onRetry={() => onRetryTask?.(task.id)} />
                      ))}
                    </div>
                  </section>
                )}

                {(processing.length > 0 || queued.length > 0) && (
                  <section className="workshop-task-group group-queue">
                    <div className="workshop-task-head"><strong>加工队列</strong><span>{processing.length + queued.length} 件</span></div>
                    <div className="workshop-task-list">
                      {processing.map((task) => (
                        <TaskRow key={task.id} task={task} onOpen={() => {}} onRetry={() => {}} />
                      ))}
                    </div>
                    {queued.length > 0 && (
                      <div className="workshop-queue-fold">
                        <button className="workshop-queue-toggle" onClick={() => setQueueExpanded((current) => !current)} aria-expanded={queueExpanded}>
                          <span>接下来还有 {queued.length} 件待加工</span>
                          <b className={queueExpanded ? 'is-open' : ''}>⌄</b>
                        </button>
                        {queueExpanded && (
                          <div className="workshop-task-list workshop-queued-list">
                            {queued.map((task) => (
                              <TaskRow key={task.id} task={task} onOpen={() => {}} onRetry={() => {}} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {completed.length > 0 && (
                  <section className="workshop-task-group group-completed">
                    <div className="workshop-task-head"><strong>已完成</strong><span>{completed.length} 件</span></div>
                    <div className="workshop-task-list">
                      {completed.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onOpen={() => task.resultComponent && setActiveComponent(task.resultComponent)}
                          onRetry={() => {}}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>
        </main>
      </section>

      {activeComponent && (
        <FurnitureDetail
          component={activeComponent}
          favorite={favoriteIds.includes(activeComponent.id)}
          onFavorite={() => onToggleFavorite(activeComponent.id)}
          onClose={() => setActiveComponent(null)}
        />
      )}
    </div>
  )
}
