import { useEffect, useMemo, useRef, useState } from 'react'
import { FrameAssetsDrawer } from './FrameAssetsDrawer'
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
  batchLabel,
  onOpen,
  onRetry,
}: {
  task: WorkshopLassoTask
  batchLabel: string
  onOpen: () => void
  onRetry: () => void
}) {
  const actionable = task.status === 'completed' || task.status === 'failed' || task.status === 'waiting'
  const content = (
    <>
      <span className="workshop-task-thumb">
        {task.imageUrl ? <img src={task.imageUrl} alt="" /> : <span aria-hidden="true">⌗</span>}
      </span>
      <span className="workshop-task-name">
        <strong>{task.name}</strong>
        <small>{batchLabel}</small>
        {(task.status === 'waiting' || task.status === 'failed') && task.error && (
          <small className="workshop-task-error" title={task.error}>{task.error}</small>
        )}
      </span>
      {task.status === 'processing' && <span className="workshop-task-status is-processing"><i />加工中</span>}
      {task.status === 'completed' && <span className="workshop-task-status is-completed">查看 <b>›</b></span>}
      {task.status === 'waiting' && <span className="workshop-task-status is-waiting">重试生成</span>}
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

export function WorkshopDetail({ data, favoriteIds, onToggleFavorite, onClose, onRetryTask }: WorkshopDetailProps) {
  const [closing, setClosing] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const appliedLassoFavoritesRef = useRef(new Set<string>())

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    setQueueExpanded(false)
    setActiveBatchId(null)
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
  const completedComponents = useMemo(() => {
    if (!activeBatchId) return []
    const batch = data.batchGroups.find((group) => group.id === activeBatchId)
    return batch?.tasks.flatMap((task) => (
      task.status === 'completed' && task.resultComponent ? [task.resultComponent] : []
    )) ?? []
  }, [activeBatchId, data.batchGroups])
  const failed = useMemo(() => data.lassoTasks.filter((task) => task.status === 'failed'), [data.lassoTasks])
  const waiting = useMemo(() => data.lassoTasks.filter((task) => task.status === 'waiting'), [data.lassoTasks])
  const isEmpty = data.lassoTasks.length === 0
  const batchLabelFor = (task: WorkshopLassoTask) => {
    const batchIndex = data.batchGroups.findIndex((group) => group.id === task.batchId)
    const seconds = Math.max(0, Math.round(task.sourceFrame.time))
    const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    return `第 ${batchIndex + 1} 批 · ${timestamp}`
  }

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
                {waiting.length > 0 && (
                  <section className="workshop-task-group group-waiting">
                    <div className="workshop-task-head"><strong>等待生成服务</strong><span>{waiting.length} 件</span></div>
                    <div className="workshop-task-list">
                      {waiting.map((task) => (
                        <TaskRow key={task.id} task={task} batchLabel={batchLabelFor(task)} onOpen={() => {}} onRetry={() => onRetryTask?.(task.id)} />
                      ))}
                    </div>
                  </section>
                )}

                {failed.length > 0 && (
                  <section className="workshop-task-group group-failed">
                    <div className="workshop-task-head"><strong>需要处理</strong><span>{failed.length} 件</span></div>
                    <div className="workshop-task-list">
                      {failed.map((task) => (
                        <TaskRow key={task.id} task={task} batchLabel={batchLabelFor(task)} onOpen={() => {}} onRetry={() => onRetryTask?.(task.id)} />
                      ))}
                    </div>
                  </section>
                )}

                {(processing.length > 0 || queued.length > 0) && (
                  <section className="workshop-task-group group-queue">
                    <div className="workshop-task-head"><strong>加工队列</strong><span>{processing.length + queued.length} 件</span></div>
                    <div className="workshop-task-list">
                      {processing.map((task) => (
                        <TaskRow key={task.id} task={task} batchLabel={batchLabelFor(task)} onOpen={() => {}} onRetry={() => {}} />
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
                              <TaskRow key={task.id} task={task} batchLabel={batchLabelFor(task)} onOpen={() => {}} onRetry={() => {}} />
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
                          batchLabel={batchLabelFor(task)}
                          onOpen={() => task.resultComponent && setActiveBatchId(task.batchId)}
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

      {activeBatchId && completedComponents.length > 0 && (
        <FrameAssetsDrawer
          assets={completedComponents}
          favoriteIds={favoriteIds}
          onFavorite={onToggleFavorite}
          onClose={() => setActiveBatchId(null)}
          title={`本次圈选完成 ${completedComponents.length} 件`}
          subtitle="点选缩略图，切换查看这批打造好的 3D 家具"
          ariaLabel="本次圈选完成家具详情"
        />
      )}
    </div>
  )
}
