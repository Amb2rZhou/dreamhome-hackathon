import { useReducer, useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { VIDEO_SRC, MOCK_OBJECTS, LIBRARY_SEED, CATEGORY_COLOR, BLOGGER_HOME_PACK, CURRENT_BLOGGER, type FeedState, type SelectedObject, type LibraryComponent, type FurnitureCategory, type MascotState, type CraftJob, type CraftBatch, type TraceEntry } from './types'
import { genSticker } from './stickerGen'
import { segmentCutout, coverTransform, applyPathMask, inpaint, captureBbox, dataUrlToBlob, saveTraceToBackend, loadTracesFromBackend, traceImageUrl } from './segmentApi'
import { Library } from './Library'
import { Assemble } from './Assemble'
import { LayoutPicker } from './LayoutPicker'
import { Profile } from './Profile'
import { HomeGrabSheet } from './HomeGrabSheet'
import { HomePreview } from './HomePreview'
import { Mascot } from './Mascot'
import { CraftResult } from './CraftResult'
import type { RoomLayout } from './roomLayouts'
import { DEFAULT_LAYOUTS } from './roomLayouts'
import './App.css'

interface State {
  phase: FeedState
  selected: SelectedObject[]
  tool: 'brush' | 'detect'
  activeObjectId: string | null
  showFailHint: boolean
  videoPlaying: boolean
  library: LibraryComponent[]
  layout: RoomLayout | null
  layoutSource: string
  showHomeGrab: boolean
  toast: string | null
  newlyAddedIds: string[]
  mascot: MascotState
  craftQueue: CraftJob[]
  currentCraft: CraftJob | null
  batches: CraftBatch[]
  showCraftResult: boolean
  craftStartTip: boolean
  orderingCount: number
  traces: TraceEntry[]
  showTrace: boolean
}

type Action =
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SWITCH_TOOL'; tool: 'brush' | 'detect' }
  | { type: 'OBJECT_RECOGNIZED'; obj: SelectedObject }
  | { type: 'UPDATE_SNAPSHOT'; id: string; snapshot: string }
  | { type: 'OBJECT_FAILED' }
  | { type: 'HIDE_FAIL_HINT' }
  | { type: 'SELECT_OBJECT'; id: string | null }
  | { type: 'REMOVE_OBJECT'; id: string }
  | { type: 'STORE' }
  | { type: 'SWIPE_BACK' }
  | { type: 'CONFIRM_DISCARD' }
  | { type: 'CANCEL_DISCARD' }
  | { type: 'CLOSE_PREVIEW' }
  | { type: 'GO_LIBRARY' }
  | { type: 'GO_ASSEMBLE' }
  | { type: 'DELETE_LIBRARY'; id: string }
  | { type: 'ADD_LIBRARY'; component: LibraryComponent }
  | { type: 'SET_LAYOUT'; layout: RoomLayout; source: string }
  | { type: 'REPICK_LAYOUT' }
  | { type: 'SHOW_HOME_GRAB' }
  | { type: 'HIDE_HOME_GRAB' }
  | { type: 'SHOW_TOAST'; msg: string }
  | { type: 'HIDE_TOAST' }
  | { type: 'CLEAR_NEW' }
  | { type: 'GO_PROFILE' }
  | { type: 'GRAB_HOME_ALL' }
  | { type: 'GRAB_HOME_ITEMS' }
  | { type: 'START_CRAFT_BATCH'; jobs: CraftJob[] }
  | { type: 'CRAFT_ORDERING_DONE'; id: string }
  | { type: 'HIDE_CRAFT_START_TIP' }
  | { type: 'SHOW_ORDERING'; count: number }
  | { type: 'HIDE_ORDERING' }
  | { type: 'CRAFT_DONE'; id: string; component: LibraryComponent }
  | { type: 'SHOW_CRAFT_RESULT' }
  | { type: 'HIDE_CRAFT_RESULT' }
  | { type: 'CRAFT_CONFIRM_STORE' }
  | { type: 'CRAFT_DISCARD' }
  | { type: 'CLEAR_CRAFT_DONE_BUBBLE' }
  | { type: 'ADD_TRACE'; trace: TraceEntry }
  | { type: 'UPDATE_TRACE'; id: string; patch: Partial<TraceEntry> }
  | { type: 'CLEAR_TRACES' }
  | { type: 'IMPORT_TRACES'; entries: TraceEntry[] }
  | { type: 'RELOAD_TRACES' }
  | { type: 'SHOW_TRACE' }
  | { type: 'HIDE_TRACE' }

const initialState: State = {
  phase: 'browse',
  selected: [],
  tool: 'brush',
  activeObjectId: null,
  showFailHint: false,
  videoPlaying: true,
  library: LIBRARY_SEED,
  layout: null,
  layoutSource: '',
  showHomeGrab: false,
  toast: null,
  newlyAddedIds: [],
  mascot: 'sleeping',
  craftQueue: [],
  currentCraft: null,
  showCraftResult: false,
  craftStartTip: false,
  batches: [],
  orderingCount: 0,
  traces: loadTraces(),
  showTrace: window.location.hash === '#/trace',
}

const TRACES_KEY = 'dreamhome-traces'

function loadTraces(): TraceEntry[] {
  try {
    const raw = localStorage.getItem(TRACES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveTraces(traces: TraceEntry[]) {
  // 策略：只保留最新 1 条完整数据（含图片），其余降级为纯元数据
  // 避免 localStorage 5MB 溢出导致最新结果写入失败
  const toSave = traces.map((t, i) => {
    if (i === 0) return t
    return { ...t, bboxDataUrl: null, inpaintDataUrl: null, cutoutDataUrl: null, finalDataUrl: null }
  })
  try {
    localStorage.setItem(TRACES_KEY, JSON.stringify(toSave))
  } catch (e) {
    // 仍然溢出：只保留最新 1 条纯元数据 + 最新 1 条完整数据（去掉旧图）
    try {
      const stripped = traces.map((t, i) => {
        if (i === 0) {
          // 最新一条：尝试只保留必要的图，去掉可能冗余的
          return { ...t, cutoutDataUrl: null }
        }
        return { ...t, bboxDataUrl: null, inpaintDataUrl: null, cutoutDataUrl: null, finalDataUrl: null }
      })
      localStorage.setItem(TRACES_KEY, JSON.stringify(stripped))
    } catch {
      /* 彻底放弃，不覆盖已有数据 */
    }
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'PAUSE':
      return { ...state, phase: 'session', videoPlaying: false, selected: [], activeObjectId: null, showFailHint: false }
    case 'RESUME':
      return { ...state, phase: 'browse', videoPlaying: true, selected: [], activeObjectId: null, showFailHint: false }
    case 'SWITCH_TOOL':
      return { ...state, tool: action.tool }
    case 'OBJECT_RECOGNIZED':
      return {
        ...state,
        selected: [...state.selected, action.obj],
        activeObjectId: null,
        showFailHint: false,
      }
    case 'UPDATE_SNAPSHOT':
      return {
        ...state,
        selected: state.selected.map((o) => (o.id === action.id ? { ...o, snapshot: action.snapshot } : o)),
      }
    case 'OBJECT_FAILED':
      return { ...state, showFailHint: true }
    case 'HIDE_FAIL_HINT':
      return { ...state, showFailHint: false }
    case 'SELECT_OBJECT':
      return { ...state, activeObjectId: action.id }
    case 'REMOVE_OBJECT':
      return {
        ...state,
        selected: state.selected.filter((o) => o.id !== action.id),
        activeObjectId: null,
      }
    case 'STORE': {
      return {
        ...state,
        phase: 'browse',
        videoPlaying: true,
        selected: [],
        activeObjectId: null,
      }
    }
    case 'SWIPE_BACK':
      if (state.selected.length === 0) {
        return { ...state, phase: 'browse', videoPlaying: true }
      }
      return { ...state, phase: 'confirm' }
    case 'CANCEL_DISCARD':
      return { ...state, phase: 'session' }
    case 'CONFIRM_DISCARD':
      return {
        ...state,
        phase: 'browse',
        videoPlaying: true,
        selected: [],
        activeObjectId: null,
      }
    case 'CLOSE_PREVIEW':
      return { ...state, phase: 'session' }
    case 'GO_LIBRARY':
      return { ...state, phase: 'library' }
    case 'GO_ASSEMBLE':
      return { ...state, phase: 'assemble' }
    case 'DELETE_LIBRARY':
      return { ...state, library: state.library.filter((c) => c.id !== action.id) }
    case 'ADD_LIBRARY':
      return { ...state, library: [action.component, ...state.library] }
    case 'SET_LAYOUT':
      return { ...state, layout: action.layout, layoutSource: action.source }
    case 'REPICK_LAYOUT':
      return { ...state, layout: null }
    case 'SHOW_HOME_GRAB':
      return { ...state, showHomeGrab: true }
    case 'HIDE_HOME_GRAB':
      return { ...state, showHomeGrab: false }
    case 'SHOW_TOAST':
      return { ...state, toast: action.msg }
    case 'HIDE_TOAST':
      return { ...state, toast: null }
    case 'GO_PROFILE':
      return { ...state, phase: 'profile' }
    case 'GRAB_HOME_ALL': {
      const layout = DEFAULT_LAYOUTS.find((l) => l.id === CURRENT_BLOGGER.homeLayoutId) ?? DEFAULT_LAYOUTS[0]
      return {
        ...state,
        showHomeGrab: false,
        library: [...BLOGGER_HOME_PACK, ...state.library],
        layout,
        layoutSource: `博主同款 · ${CURRENT_BLOGGER.homeName}`,
        phase: 'assemble',
        toast: '已保存整个小家，去组装看看',
      }
    }
    case 'GRAB_HOME_ITEMS':
      return {
        ...state,
        showHomeGrab: false,
        library: [...BLOGGER_HOME_PACK, ...state.library],
        newlyAddedIds: BLOGGER_HOME_PACK.map((c) => c.id),
        phase: 'library',
        toast: '已保存至素材库',
      }
    case 'CLEAR_NEW':
      return { ...state, newlyAddedIds: [] }
    case 'START_CRAFT_BATCH': {
      const batch: CraftBatch = { id: `batch-${Date.now()}`, jobs: action.jobs.map((j) => ({ ...j, status: 'ordering' as const })), notified: false, dismissed: false }
      if (action.jobs.length === 0) return state
      if (state.currentCraft) {
        return {
          ...state,
          craftQueue: [...state.craftQueue, ...action.jobs.map((j) => ({ ...j, status: 'ordering' as const }))],
          batches: [...state.batches, batch],
          toast: '包公球还在打造上一批，新的一批已排队',
        }
      }
      const first = { ...action.jobs[0], status: 'ordering' as const }
      const rest = action.jobs.slice(1).map((j) => ({ ...j, status: 'ordering' as const }))
      return {
        ...state,
        currentCraft: first,
        craftQueue: [...state.craftQueue, ...rest],
        batches: [...state.batches, batch],
        mascot: 'working',
      }
    }
    case 'CRAFT_ORDERING_DONE': {
      if (state.currentCraft?.id !== action.id) return state
      return { ...state, currentCraft: { ...state.currentCraft, status: 'crafting' }, mascot: 'working', craftStartTip: true }
    }
    case 'HIDE_CRAFT_START_TIP':
      return { ...state, craftStartTip: false }
    case 'SHOW_ORDERING':
      return { ...state, orderingCount: action.count }
    case 'HIDE_ORDERING':
      return { ...state, orderingCount: 0 }
    case 'CRAFT_DONE': {
      if (state.currentCraft?.id !== action.id) return state
      const doneJob: CraftJob = { ...state.currentCraft, status: 'done', resultComponent: action.component }
      const batches = state.batches.map((b) => ({
        ...b,
        jobs: b.jobs.map((j) => (j.id === doneJob.id ? doneJob : j)),
      }))
      const next = state.craftQueue[0] ?? null
      const restQueue = state.craftQueue.slice(1)
      const batchDone = batches.find((b) => b.jobs.every((j) => j.status === 'done') && !b.notified)
      const batchJustDone = !!batchDone
      const notifiedBatches = batchJustDone ? batches.map((b) => (b.id === batchDone!.id ? { ...b, notified: true } : b)) : batches
      return {
        ...state,
        currentCraft: next ? { ...next, status: 'ordering' } : null,
        craftQueue: restQueue,
        batches: notifiedBatches,
        mascot: batchJustDone ? 'happy' : (next ? 'working' : 'sleeping'),
      }
    }
    case 'SHOW_CRAFT_RESULT':
      return { ...state, showCraftResult: true }
    case 'HIDE_CRAFT_RESULT':
      return { ...state, showCraftResult: false }
    case 'CRAFT_CONFIRM_STORE': {
      const doneBatch = state.batches.find((b) => b.jobs.every((j) => j.status === 'done') && !b.dismissed)
      if (!doneBatch) return { ...state, showCraftResult: false }
      const added = doneBatch.jobs.map((j) => j.resultComponent!).filter(Boolean)
      const remainingBatches = state.batches.filter((b) => b.id !== doneBatch.id)
      const hasMore = !!state.currentCraft || state.craftQueue.length > 0
      return {
        ...state,
        showCraftResult: false,
        batches: remainingBatches,
        mascot: hasMore ? 'working' : 'sleeping',
        library: [...added, ...state.library],
        newlyAddedIds: added.map((c) => c.id),
        phase: 'library',
      }
    }
    case 'CRAFT_DISCARD': {
      const doneBatch = state.batches.find((b) => b.jobs.every((j) => j.status === 'done') && !b.dismissed)
      if (!doneBatch) return { ...state, showCraftResult: false }
      const remainingBatches = state.batches.filter((b) => b.id !== doneBatch.id)
      const hasMore = !!state.currentCraft || state.craftQueue.length > 0
      return {
        ...state,
        showCraftResult: false,
        batches: remainingBatches,
        mascot: hasMore ? 'working' : 'sleeping',
      }
    }
    case 'CLEAR_CRAFT_DONE_BUBBLE': {
      const batches = state.batches.map((b) => {
        if (b.jobs.every((j) => j.status === 'done') && !b.dismissed) return { ...b, dismissed: true }
        return b
      })
      return { ...state, batches, mascot: (state.currentCraft || state.craftQueue.length > 0) ? 'working' : 'sleeping' }
    }
    case 'ADD_TRACE':
      return { ...state, traces: [action.trace, ...state.traces] }
    case 'UPDATE_TRACE':
      return {
        ...state,
        traces: state.traces.map((t) =>
          t.id === action.id ? { ...t, ...action.patch } : t,
        ),
      }
    case 'CLEAR_TRACES':
      return { ...state, traces: [] }
    case 'IMPORT_TRACES': {
      const existingIds = new Set(state.traces.map((t) => t.id))
      const fresh = action.entries.filter((t) => !existingIds.has(t.id))
      const merged = [...state.traces, ...fresh].sort((a, b) => b.ts - a.ts)
      return { ...state, traces: merged }
    }
    case 'SHOW_TRACE':
      return { ...state, showTrace: true }
    case 'HIDE_TRACE':
      return { ...state, showTrace: false }
    case 'RELOAD_TRACES':
      return { ...state, traces: loadTraces() }
    default:
      return state
  }
}

const MOCK_ADD_NAMES: Record<FurnitureCategory, string[]> = {
  '沙发': ['奶油风布艺沙发', '深灰科技布沙发'],
  '茶几': ['岩板方茶几', '藤编圆茶几'],
  '吊灯': ['纸艺球形吊灯', '极简长杆吊灯'],
  '绿植': ['龟背竹落地', '多肉组合盆栽'],
  '装饰画': ['极简色块装饰画', '风景摄影挂画'],
  '地毯': ['黄麻编织地毯', '奶咖纯色地毯'],
}

let mockAddSeq = 0
function mockAdd(channel: '线下拍照' | '手绘生成'): LibraryComponent {
  const cats = Object.keys(MOCK_ADD_NAMES) as FurnitureCategory[]
  const cat = cats[mockAddSeq % cats.length]
  mockAddSeq += 1
  const names = MOCK_ADD_NAMES[cat]
  const name = names[mockAddSeq % names.length]
  const color = CATEGORY_COLOR[cat] ?? '#8d6e63'
  return {
    id: `mock-${Date.now()}-${mockAddSeq}`,
    category: cat,
    name,
    source: `来自${channel} · 刚刚（预生成）`,
    size: '待识别尺寸',
    styleTags: [channel, '预生成'],
    thumbnail: MOCK_OBJECTS.find((m) => m.label === cat)?.thumbnail ?? '🪑',
    color,
    sticker: genSticker(cat, color, mockAddSeq),
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const videoRef = useRef<HTMLVideoElement>(null)

  // traces 持久化到 localStorage
  useEffect(() => {
    saveTraces(state.traces)
  }, [state.traces])

  // hash 路由：#/trace 显示统一留痕页
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#/trace') dispatch({ type: 'SHOW_TRACE' })
      else dispatch({ type: 'HIDE_TRACE' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 跨标签同步：其他标签写入 traces 时重新加载
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRACES_KEY) dispatch({ type: 'RELOAD_TRACES' })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (state.videoPlaying) {
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [state.videoPlaying])

  const craft = state.currentCraft
  useEffect(() => {
    if (!craft) return
    if (craft.status === 'ordering') {
      const t = setTimeout(() => dispatch({ type: 'CRAFT_ORDERING_DONE', id: craft.id }), 1600)
      return () => clearTimeout(t)
    }
    if (craft.status === 'crafting') {
      const t = setTimeout(() => {
        const comp: LibraryComponent = {
          id: `crafted-${craft.id}`,
          category: craft.category,
          name: craft.name,
          source: '摘抄打造 · 刚刚',
          size: '待识别尺寸',
          styleTags: ['3D', '打造'],
          thumbnail: MOCK_OBJECTS.find((m) => m.label === craft.category)?.thumbnail ?? '🪑',
          color: craft.color,
          sticker: craft.snapshot || genSticker(craft.category, craft.color, 99),
        }
        dispatch({ type: 'CRAFT_DONE', id: craft.id, component: comp })
      }, 4500)
      return () => clearTimeout(t)
    }
  }, [craft])

  return (
    <div className="phone">
      <div className="screen">
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          className="video"
          loop
          muted
          playsInline
          autoPlay
        />

        {state.phase === 'browse' && (
          <BrowseLayer
            onPause={() => dispatch({ type: 'PAUSE' })}
            onGetHome={() => dispatch({ type: 'SHOW_HOME_GRAB' })}
            onOpenProfile={() => dispatch({ type: 'GO_PROFILE' })}
          />
        )}

        {state.showHomeGrab && (
          <HomeGrabSheet
            onGrabAll={() => dispatch({ type: 'GRAB_HOME_ALL' })}
            onGrabItems={() => dispatch({ type: 'GRAB_HOME_ITEMS' })}
            onClose={() => dispatch({ type: 'HIDE_HOME_GRAB' })}
          />
        )}

        {state.phase === 'profile' && (
          <Profile
            onClose={() => dispatch({ type: 'RESUME' })}
            onEnterHome={() => dispatch({ type: 'GRAB_HOME_ALL' })}
          />
        )}

        {state.toast && (
          <Toast msg={state.toast} onDone={() => dispatch({ type: 'HIDE_TOAST' })} />
        )}

        {state.orderingCount > 0 && <OrderingOverlay count={state.orderingCount} />}

        <Mascot
          state={state.mascot}
          doneBatch={state.batches.find((b) => b.jobs.every((j) => j.status === 'done') && !b.dismissed) ?? null}
          craftStartTip={state.craftStartTip}
          onTapBubble={() => dispatch({ type: 'SHOW_CRAFT_RESULT' })}
          onDismissBubble={() => dispatch({ type: 'CLEAR_CRAFT_DONE_BUBBLE' })}
          onDismissStartTip={() => dispatch({ type: 'HIDE_CRAFT_START_TIP' })}
        />

        {state.showCraftResult && (() => {
          const doneBatch = state.batches.find((b) => b.jobs.every((j) => j.status === 'done') && !b.dismissed)
          if (!doneBatch) return null
          const components = doneBatch.jobs.map((j) => j.resultComponent!).filter(Boolean)
          return (
            <CraftResult
              components={components}
              onStore={() => dispatch({ type: 'CRAFT_CONFIRM_STORE' })}
              onClose={() => dispatch({ type: 'HIDE_CRAFT_RESULT' })}
            />
          )
        })()}

        {state.phase === 'session' && (
          <SessionLayer
            state={state}
            dispatch={dispatch}
          />
        )}

        {state.phase === 'confirm' && (
          <ConfirmLayer
            count={state.selected.length}
            onCancel={() => dispatch({ type: 'CANCEL_DISCARD' })}
            onConfirm={() => dispatch({ type: 'CONFIRM_DISCARD' })}
          />
        )}

        {state.phase === 'preview' && (
          <PreviewLayer
            selected={state.selected}
            onClose={() => dispatch({ type: 'CLOSE_PREVIEW' })}
            onGoLibrary={() => dispatch({ type: 'GO_LIBRARY' })}
            onStartCraft={(objs) => {
              const jobs: CraftJob[] = objs.map((obj) => {
                const it = obj.items[0]
                const category = (MOCK_OBJECTS.find((m) => m.label === it.label)?.label ?? '沙发') as FurnitureCategory
                const color = CATEGORY_COLOR[category] ?? '#8d6e63'
                return {
                  id: `craft-${obj.id}`,
                  name: it.label,
                  category,
                  snapshot: obj.snapshot,
                  color,
                  status: 'ordering' as const,
                }
              })
              dispatch({ type: 'SHOW_ORDERING', count: jobs.length })
              setTimeout(() => {
                dispatch({ type: 'HIDE_ORDERING' })
                dispatch({ type: 'START_CRAFT_BATCH', jobs })
              }, 6000)
            }}
            crafting={!!state.currentCraft}
          />
        )}

        {state.phase === 'library' && (
          <Library
            components={state.library}
            newlyAddedIds={state.newlyAddedIds}
            onClose={() => dispatch({ type: 'RESUME' })}
            onDelete={(id) => dispatch({ type: 'DELETE_LIBRARY', id })}
            onGoAssemble={() => dispatch({ type: 'GO_ASSEMBLE' })}
            onAddFromVideo={() => dispatch({ type: 'RESUME' })}
            onAddFromPhoto={() => dispatch({ type: 'ADD_LIBRARY', component: mockAdd('线下拍照') })}
            onAddFromSketch={() => dispatch({ type: 'ADD_LIBRARY', component: mockAdd('手绘生成') })}
            onClearNew={() => dispatch({ type: 'CLEAR_NEW' })}
            onTraceBack={() => dispatch({ type: 'RESUME' })}
          />
        )}

        {state.phase === 'assemble' && !state.layout && (
          <LayoutPicker
            onPick={(layout, source) => dispatch({ type: 'SET_LAYOUT', layout, source })}
            onClose={() => dispatch({ type: 'GO_LIBRARY' })}
          />
        )}

        {state.phase === 'assemble' && state.layout && (
          <Assemble
            components={state.library}
            layout={state.layout}
            layoutSource={state.layoutSource}
            onClose={() => dispatch({ type: 'GO_LIBRARY' })}
            onRepickLayout={() => dispatch({ type: 'REPICK_LAYOUT' })}
          />
        )}

        {state.showTrace && (
          <TracePanel
            traces={state.traces}
            standalone={window.location.hash === '#/trace'}
            onClose={() => {
              if (window.location.hash === '#/trace') {
                history.pushState('', document.title, window.location.pathname + window.location.search)
              }
              dispatch({ type: 'HIDE_TRACE' })
            }}
            onClear={() => dispatch({ type: 'CLEAR_TRACES' })}
            onImport={(entries) => dispatch({ type: 'IMPORT_TRACES', entries })}
          />
        )}
      </div>
    </div>
  )
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [msg, onDone])
  return (
    <div className="toast-root">
      <div className="toast-box">
        <span className="toast-check">✓</span>
        <span className="toast-msg">{msg}</span>
      </div>
    </div>
  )
}

function SocialBar({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <div className={`social-bar ${dimmed ? 'dimmed' : ''}`}>
      <div className="avatar-wrap">
        <div className="avatar" />
        <button className="follow-plus">+</button>
      </div>
      <button className="social-btn">
        <span className="social-emoji">❤️</span>
        <span className="social-count">12.3w</span>
      </button>
      <button className="social-btn">
        <span className="social-emoji">💬</span>
        <span className="social-count">856</span>
      </button>
      <button className="social-btn">
        <span className="social-emoji">⭐</span>
        <span className="social-count">2.1w</span>
      </button>
      <button className="social-btn">
        <span className="social-emoji">↗️</span>
        <span className="social-count">分享</span>
      </button>
      <div className="music-disc">
        <div className="disc-inner" />
      </div>
    </div>
  )
}

function BottomInfo({ onGetHome, onOpenProfile }: { onGetHome: () => void; onOpenProfile: () => void }) {
  return (
    <div className="bottom-info">
      <button className="home-entry" onClick={onGetHome}>
        <div className="home-entry-text">
          <div className="home-entry-title">获取博主同款小家</div>
          <div className="home-entry-sub">含奶油风一居小家，{BLOGGER_HOME_PACK.length}件软装</div>
        </div>
        <div className="home-entry-preview">
          <HomePreview components={BLOGGER_HOME_PACK} layoutId={CURRENT_BLOGGER.homeLayoutId} fillContainer />
        </div>
      </button>
      <div className="author" onClick={onOpenProfile}>@{CURRENT_BLOGGER.name}</div>
      <div className="caption">
        这个北欧风客厅太治愈了，每一处软装都想抄回家 🛋️✨
        <span className="topic"> #家居灵感</span>
        <span className="topic"> #客厅装修</span>
        <span className="topic"> #软装搭配</span>
      </div>
      <div className="music">
        <span className="music-note">🎵</span>
        <span className="music-text">原声 - home_vibes · 北欧治愈系居家BGM</span>
      </div>
    </div>
  )
}

function BrowseLayer({ onPause, onGetHome, onOpenProfile }: { onPause: () => void; onGetHome: () => void; onOpenProfile: () => void }) {
  return (
    <>
      <div className="top-tabs">
        <button className="top-search">🔍</button>
        <div className="tabs-center">
          <span className="tab">关注</span>
          <span className="tab active">推荐</span>
        </div>
        <button className="top-camera">📡</button>
      </div>
      <div className="tap-area" onClick={onPause} />
      <SocialBar />
      <BottomInfo onGetHome={onGetHome} onOpenProfile={onOpenProfile} />
    </>
  )
}

function SessionLayer({
  state,
  dispatch,
}: {
  state: State
  dispatch: React.Dispatch<Action>
}) {
  const drawingRef = useRef(false)
  const movedRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const penTipRef = useRef<HTMLDivElement>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const bboxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const pathRef = useRef<{ x: number; y: number }[]>([])
  const [scanning, setScanning] = useState(false)

  const drawStrokeTo = (x: number, y: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    pathRef.current.push({ x, y })
    lastPointRef.current = { x, y }
    const b = bboxRef.current
    if (b) {
      b.minX = Math.min(b.minX, x)
      b.minY = Math.min(b.minY, y)
      b.maxX = Math.max(b.maxX, x)
      b.maxY = Math.max(b.maxY, y)
    } else {
      bboxRef.current = { minX: x, minY: y, maxX: x, maxY: y }
    }
    const pts = pathRef.current
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = 4
    ctx.beginPath()
    if (pts.length === 1) {
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(pts[0].x, pts[0].y)
    } else {
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2
        const midY = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
      }
      const last = pts[pts.length - 1]
      ctx.lineTo(last.x, last.y)
    }
    ctx.stroke()
  }

  const getCanvasPos = (clientX: number, clientY: number) => {
    const screen = document.querySelector<HTMLElement>('.screen')
    if (!screen) return null
    const rect = screen.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const updatePenTip = (p: { x: number; y: number } | null) => {
    const el = penTipRef.current
    if (!el) return
    if (!p) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = getCanvasPos(e.clientX, e.clientY)
      updatePenTip(p)
      if (!drawingRef.current) return
      movedRef.current = true
      if (p) drawStrokeTo(p.x, p.y)
    }
    const clearCanvas = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    }
    const onUp = async () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      lastPointRef.current = null
      clearCanvas()
      if (!movedRef.current) {
        dispatch({ type: 'OBJECT_FAILED' })
        setTimeout(() => dispatch({ type: 'HIDE_FAIL_HINT' }), 2000)
        return
      }
      const b = bboxRef.current
      bboxRef.current = null
      if (!b || b.maxX - b.minX < 8 || b.maxY - b.minY < 8) {
        dispatch({ type: 'OBJECT_FAILED' })
        setTimeout(() => dispatch({ type: 'HIDE_FAIL_HINT' }), 2000)
        return
      }
      const pad = 12
      const box = {
        x: Math.max(0, b.minX - pad),
        y: Math.max(0, b.minY - pad),
        w: b.maxX - b.minX + pad * 2,
        h: b.maxY - b.minY + pad * 2,
      }
      const path = pathRef.current
      pathRef.current = []
      const video = document.querySelector<HTMLVideoElement>('.video')
      // bbox 截图（带背景）—— 同时作为即时占位 snapshot 和 pipeline 输入
      let bboxDataUrl = ''
      if (video && path.length > 2) {
        bboxDataUrl = (await captureBbox(video, box)) ?? ''
      }
      const snapshot = bboxDataUrl
      const area = box.w * box.h
      const count = area > 22000 ? 3 : area > 10000 ? 2 : 1
      const offset = state.selected.reduce((n, o) => n + o.items.length, 0)
      const items = Array.from({ length: count }, (_, i) => MOCK_OBJECTS[(offset + i) % MOCK_OBJECTS.length])
      const obj: SelectedObject = {
        id: `obj-${Date.now()}`,
        box,
        items,
        snapshot,
      }
      dispatch({ type: 'OBJECT_RECOGNIZED', obj })
      dispatch({
        type: 'ADD_TRACE',
        trace: {
          id: obj.id,
          ts: Date.now(),
          path: path.map((p) => ({ x: p.x - box.x, y: p.y - box.y })),
          bbox: box,
          bboxDataUrl,
          inpaintDataUrl: null,
          cutoutDataUrl: null,
          finalDataUrl: null,
          label: items[0]?.label ?? '未知',
          status: 'pending',
        },
      })

      // pipeline：bbox截图(带背景) → wan2.7 单步提取(去背景+去遮挡+补全) → 最终透明家具
      const bboxBlob = bboxDataUrl ? dataUrlToBlob(bboxDataUrl) : null
      let inpainted: string | null = null
      let traceStatus: TraceEntry['status'] = 'failed'
      if (!bboxBlob) {
        dispatch({ type: 'UPDATE_TRACE', id: obj.id, patch: { status: 'failed' } })
      } else {
        // 单步：直接给 wan2.7 带场景的 bbox 原图 + path 高亮，提取完整家具
        inpainted = await inpaint(bboxBlob, box, path)
        traceStatus = inpainted ? 'done' : 'failed'
        dispatch({
          type: 'UPDATE_TRACE',
          id: obj.id,
          patch: {
            inpaintDataUrl: inpainted,
            finalDataUrl: inpainted,
            status: traceStatus,
          },
        })

        console.log('[pipeline]', obj.id, 'inpaint:', inpainted ? 'ok' : 'fail', 'path:', path.length, 'box:', box)
        if (inpainted) {
          dispatch({ type: 'UPDATE_SNAPSHOT', id: obj.id, snapshot: inpainted })
        }
      }

      // 持久化到后端文件系统（成功失败都保存，不受 localStorage 5MB 限制）
      try {
        const saved = await saveTraceToBackend({
          id: obj.id,
          ts: Date.now(),
          label: items[0]?.label ?? '未知',
          status: traceStatus,
          bboxDataUrl,
          inpaintDataUrl: inpainted,
          finalDataUrl: inpainted,
        })
        console.log('[pipeline] backend save:', saved ? 'ok' : 'fail')
      } catch (e) {
        console.warn('[pipeline] backend save error:', e)
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!drawingRef.current || !e.touches[0]) return
      movedRef.current = true
      const t = e.touches[0]
      const p = getCanvasPos(t.clientX, t.clientY)
      if (p) drawStrokeTo(p.x, p.y)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onUp)
    }
  }, [state.selected.length])

  const startDraw = (e: React.PointerEvent) => {
    if (scanning) return
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    }
    drawingRef.current = true
    movedRef.current = false
    lastPointRef.current = null
    bboxRef.current = null
    pathRef.current = []
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvasRef.current!.offsetWidth, canvasRef.current!.offsetHeight)
    const p = getCanvasPos(e.clientX, e.clientY)
    if (p) drawStrokeTo(p.x, p.y)
  }

  const handleCraft = () => {
    if (state.selected.length === 0) return
    const jobs: CraftJob[] = state.selected.map((obj) => {
      const it = obj.items[0]
      const category = (MOCK_OBJECTS.find((m) => m.label === it.label)?.label ?? '沙发') as FurnitureCategory
      const color = CATEGORY_COLOR[category] ?? '#8d6e63'
      return {
        id: `craft-${obj.id}`,
        name: it.label,
        category,
        snapshot: obj.snapshot,
        color,
        status: 'ordering' as const,
      }
    })
    dispatch({ type: 'STORE' })
    dispatch({ type: 'SHOW_ORDERING', count: jobs.length })
    setTimeout(() => {
      dispatch({ type: 'HIDE_ORDERING' })
      dispatch({ type: 'START_CRAFT_BATCH', jobs })
    }, 6000)
  }

  const makeContour = (label: string, w: number, h: number): { x: number; y: number }[] => {
    const jitter = (v: number, r: number) => v + (Math.random() - 0.5) * 2 * r
    const poly = (pts: [number, number][]) => pts.map(([nx, ny]) => ({ x: jitter(nx * w, w * 0.02), y: jitter(ny * h, h * 0.02) }))
    switch (label) {
      case '沙发':
        return poly([[0.04, 0.30], [0.12, 0.12], [0.30, 0.05], [0.70, 0.05], [0.88, 0.12], [0.96, 0.30], [0.98, 0.62], [0.92, 0.95], [0.08, 0.95], [0.02, 0.62]])
      case '茶几':
        return poly([[0.08, 0.22], [0.20, 0.10], [0.80, 0.10], [0.92, 0.22], [0.96, 0.50], [0.88, 0.90], [0.12, 0.90], [0.04, 0.50]])
      case '吊灯':
        return poly([[0.42, 0.04], [0.58, 0.04], [0.66, 0.10], [0.90, 0.42], [0.96, 0.62], [0.80, 0.74], [0.20, 0.74], [0.04, 0.62], [0.10, 0.42], [0.34, 0.10]])
      case '绿植':
        return poly([[0.30, 0.04], [0.50, 0.02], [0.70, 0.04], [0.92, 0.20], [0.98, 0.40], [0.86, 0.55], [0.62, 0.60], [0.66, 0.80], [0.70, 0.96], [0.30, 0.96], [0.34, 0.80], [0.38, 0.60], [0.14, 0.55], [0.02, 0.40], [0.08, 0.20]])
      case '装饰画':
        return poly([[0.04, 0.06], [0.96, 0.04], [0.98, 0.94], [0.02, 0.96]])
      case '地毯':
        return poly([[0.06, 0.30], [0.16, 0.12], [0.84, 0.12], [0.94, 0.30], [0.98, 0.70], [0.90, 0.92], [0.10, 0.92], [0.02, 0.70]])
      default:
        return poly([[0.08, 0.08], [0.92, 0.08], [0.94, 0.92], [0.06, 0.94]])
    }
  }

  const clipSnapshot = (box: { x: number; y: number; w: number; h: number }, contour: { x: number; y: number }[]): string => {
    const video = document.querySelector<HTMLVideoElement>('.video')
    if (!video) return ''
    const t = coverTransform(video)
    const sx = (box.x - t.offsetX) / t.scale
    const sy = (box.y - t.offsetY) / t.scale
    const sw = box.w / t.scale
    const sh = box.h / t.scale
    const tmp = document.createElement('canvas')
    tmp.width = box.w
    tmp.height = box.h
    const tctx = tmp.getContext('2d')
    if (!tctx) return ''
    tctx.save()
    tctx.beginPath()
    contour.forEach((p, i) => (i === 0 ? tctx.moveTo(p.x, p.y) : tctx.lineTo(p.x, p.y)))
    tctx.closePath()
    tctx.clip()
    tctx.drawImage(video, sx, sy, sw, sh, 0, 0, box.w, box.h)
    tctx.restore()
    return tmp.toDataURL('image/png')
  }

  const handleDetect = async () => {
    if (scanning) return
    setScanning(true)
    const video = document.querySelector<HTMLVideoElement>('.video')
    const base = Date.now()
    const spots = [
      { x: 30, y: 90, w: 110, h: 90 },
      { x: 180, y: 150, w: 100, h: 95 },
      { x: 80, y: 300, w: 120, h: 110 },
    ]
    const objs: SelectedObject[] = spots.map((s, i) => {
      const idx = (state.selected.length + i) % MOCK_OBJECTS.length
      const mock = MOCK_OBJECTS[idx]
      const contour = makeContour(mock.label, s.w, s.h)
      return {
        id: `obj-${base}-${i}`,
        box: s,
        items: [{ label: mock.label, thumbnail: mock.thumbnail }],
        snapshot: clipSnapshot(s, contour),
      }
    })
    objs.forEach((obj) => dispatch({ type: 'OBJECT_RECOGNIZED', obj }))
    setScanning(false)

    await Promise.all(objs.map(async (obj, idx) => {
      const s = spots[idx]
      const contour = makeContour(obj.items[0].label, s.w, s.h)
      if (!video) return
      const bboxDataUrl = await captureBbox(video, s)
      if (!bboxDataUrl) return
      const bboxBlob = dataUrlToBlob(bboxDataUrl)
      if (!bboxBlob) return
      const inpainted = await inpaint(bboxBlob, s)
      const sourceBlob = inpainted ? dataUrlToBlob(inpainted)! : bboxBlob
      const cutout = await segmentCutout(sourceBlob)
      if (!cutout) return
      const screenPath = contour.map((c) => ({ x: c.x + s.x, y: c.y + s.y }))
      try {
        const masked = await applyPathMask(cutout, screenPath, s)
        dispatch({ type: 'UPDATE_SNAPSHOT', id: obj.id, snapshot: masked })
      } catch {
        dispatch({ type: 'UPDATE_SNAPSHOT', id: obj.id, snapshot: cutout })
      }
    }))
  }

  return (
    <>
      <button className="top-play" onClick={() => dispatch({ type: 'RESUME' })}>
        ✕
      </button>

      <button
        className="trace-entry-btn"
        onClick={() => dispatch({ type: 'SHOW_TRACE' })}
      >
        留痕 {state.traces.length}
      </button>

      <canvas
        ref={canvasRef}
        className="draw-canvas"
      />

      {scanning && <div className="scan-overlay" />}

      <div
        className="draw-layer"
        onPointerDown={startDraw}
        onPointerMove={(e) => updatePenTip(getCanvasPos(e.clientX, e.clientY))}
        onPointerLeave={() => updatePenTip(null)}
      />

      <div className="pen-tip" ref={penTipRef} />

      <div
        className="object-layer"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            dispatch({ type: 'SELECT_OBJECT', id: null })
          }
        }}
      >
        {state.selected.map((obj) => (
          <div
            key={obj.id}
            className={`obj-card ${state.activeObjectId === obj.id ? 'active' : ''}`}
            style={{ left: obj.box.x, top: obj.box.y, width: obj.box.w }}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SELECT_OBJECT', id: obj.id })
            }}
          >
            <div className="obj-card-img" style={{ backgroundImage: `url(${obj.snapshot})`, height: obj.box.h }} />
            <div className="obj-card-label">
              {obj.items.map((it) => `${it.thumbnail} ${it.label}`).join(' · ')}
            </div>
            {state.activeObjectId === obj.id && (
              <button
                className="obj-x"
                style={{
                  right: obj.box.x + obj.box.w > 360 ? 'auto' : '-10px',
                  left: obj.box.x + obj.box.w > 360 ? '-10px' : 'auto',
                  top: obj.box.y < 24 ? 'auto' : '-10px',
                  bottom: obj.box.y < 24 ? '-10px' : 'auto',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'REMOVE_OBJECT', id: obj.id })
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {state.showFailHint && (
        <div className="fail-hint">没识别到，重试一下</div>
      )}

      <div className="collect-bar">
        <div className="hint-text">
          <span className="gesture-icon">✍️</span>
          圈选或点识别全部，收集心动的家居
        </div>
        <div className="collect-row">
          <button className="detect-chip" onClick={handleDetect}>
            识别全部
          </button>
          <div className="store-group">
            <span className="counter-pill">已摘 {state.selected.length}</span>
            <button
              className="store-btn"
              disabled={state.selected.length === 0}
              onClick={handleCraft}
            >
              去打造 →
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ConfirmLayer({
  count,
  onCancel,
  onConfirm,
}: {
  count: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-box">
        <div className="confirm-title">放弃本次摘抄？</div>
        <div className="confirm-desc">已摘抄的 {count} 件不会保存</div>
        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onCancel}>继续</button>
          <button className="btn-danger" onClick={onConfirm}>放弃</button>
        </div>
      </div>
    </div>
  )
}

function PreviewLayer({
  selected,
  onClose,
  onGoLibrary,
  onStartCraft,
  crafting,
}: {
  selected: SelectedObject[]
  onClose: () => void
  onGoLibrary: () => void
  onStartCraft: (objs: SelectedObject[]) => void
  crafting: boolean
}) {
  const handleCraft = () => {
    onStartCraft(selected)
  }

  return (
    <div className="preview-sheet">
      <div className="preview-header">
        <span className="preview-title">识别成功 {selected.length} 件</span>
        <button className="close-x" onClick={onClose}>✕</button>
      </div>
      <div className="preview-craft-hint">识别成功啦，去打造它们的 3D 形态吧（约 30~120 秒）</div>
      <div className="thumbs">
        {selected.map((obj) => (
          <div key={obj.id} className="thumb">
            <div className="thumb-img" style={{ backgroundImage: `url(${obj.snapshot})` }} />
            <span className="thumb-label">{obj.items.map((it) => it.label).join(' · ')}</span>
          </div>
        ))}
      </div>
      <div className="preview-actions">
        <button className="lib-btn" onClick={onGoLibrary}>
          素材库
        </button>
        <button
          className="craft-btn-main"
          disabled={crafting}
          onClick={handleCraft}
        >
          去打造 →
        </button>
      </div>
    </div>
  )
}

function OrderingOverlay({ count }: { count: number }) {
  return (
    <div className="ordering-overlay">
      <div className="ordering-box">
        <div className="ordering-stage">
          <img className="ordering-mascot" src="/mascot-thinking.png" alt="" />
        </div>
        <div className="ordering-text-main">包公球接单中…</div>
        <div className="ordering-text-sub">正在确认 {count} 件家具的打造任务</div>
        <div className="ordering-progress">
          <div className="ordering-progress-bar" />
        </div>
      </div>
    </div>
  )
}

function pathToSvgPoints(path: { x: number; y: number }[]): string {
  return path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function TracePanel({
  traces,
  onClose,
  onClear,
  onImport,
  standalone,
}: {
  traces: TraceEntry[]
  onClose: () => void
  onClear: () => void
  onImport: (entries: TraceEntry[]) => void
  standalone?: boolean
}) {
  const [zoom, setZoom] = useState<{ src: string; cap: string } | null>(null)
  const [stats, setStats] = useState<{ total: number; ok: number; failed: number; cost: number } | null>(null)
  // 后端历史 trace（图片存文件系统，不受 localStorage 限制）
  const [backendTraces, setBackendTraces] = useState<{
    id: string
    ts: number
    label: string
    status: string
    has_bbox: boolean
    has_inpaint: boolean
    has_final: boolean
  }[]>([])

  const fetchStats = async () => {
    try {
      const res = await fetch('http://localhost:8001/api/stats')
      const data = await res.json()
      setStats(data.summary)
    } catch {
      /* 后端没起时静默 */
    }
  }

  // 从后端加载历史 trace 列表
  const fetchBackendTraces = async () => {
    const list = await loadTracesFromBackend()
    setBackendTraces(list)
  }

  // 清空后端历史
  const clearBackendTraces = async () => {
    try {
      await fetch('http://localhost:8001/api/traces', { method: 'DELETE' })
      setBackendTraces([])
    } catch (e) {
      console.warn('[clear] failed:', e)
    }
  }

  useEffect(() => {
    fetchStats()
    fetchBackendTraces()
    const t = setInterval(() => {
      fetchStats()
      fetchBackendTraces()
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const importBadcase = async () => {
    try {
      const res = await fetch('/imported_traces.json')
      const arr: TraceEntry[] = await res.json()
      onImport(arr)
    } catch (e) {
      console.warn('[import] failed:', e)
    }
  }

  // 合并：内存 traces（当前 session，有 dataURL）+ 后端 traces（历史，有 URL）
  // 去重：内存已有的 id 不在后端重复显示
  const memIds = new Set(traces.map((t) => t.id))
  const backendOnly = backendTraces.filter((t) => !memIds.has(t.id))

  const exportHtml = () => {
    const rows = traces.slice().reverse().map((t, i) => {
      const w = Math.round(t.bbox.w)
      const h = Math.round(t.bbox.h)
      const statusText = t.status === 'done' ? '✓ 完成' : t.status === 'failed' ? '✕ 失败' : '… 等待中'
      const cell = (cap: string, inner: string) =>
        `<div class="cell"><div class="cap">${cap}</div>${inner}</div>`
      const imgOr = (url: string | null) =>
        url ? `<img src="${url}" />` : `<div class="empty">${t.status === 'failed' ? '失败' : '等待中…'}</div>`
      return `
      <div class="entry">
        <div class="entry-head">
          <span class="idx">#${i + 1}</span>
          <span class="label">${t.label}</span>
          <span class="time">${formatTime(t.ts)}</span>
          <span class="status ${t.status}">${statusText}</span>
        </div>
        <div class="grid">
          ${cell('画的形状', `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#ccc" stroke-dasharray="3 3"/>
            <polygon points="${pathToSvgPoints(t.path)}" fill="rgba(77,208,225,0.2)" stroke="#4dd0e1" stroke-width="3"/>
          </svg>`)}
          ${cell('bbox 框', `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(255,122,61,0.06)" stroke="#ff7a3d" stroke-width="3"/>
          </svg>`)}
          ${cell('bbox 原图', imgOr(t.bboxDataUrl))}
          ${cell('补全产物', imgOr(t.inpaintDataUrl))}
          ${cell('抠图产物', imgOr(t.cutoutDataUrl))}
          ${cell('最终产物', imgOr(t.finalDataUrl))}
        </div>
      </div>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DreamHome 抠图留痕</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#f5f4f0; margin:0; padding:24px; color:#1a1a1a; }
      h1 { font-size:20px; margin:0 0 4px; }
      .meta { color:#888; font-size:13px; margin-bottom:20px; }
      .entry { background:#fff; border-radius:14px; padding:16px; margin-bottom:16px; box-shadow:0 1px 4px rgba(0,0,0,0.06); }
      .entry-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; font-size:14px; }
      .idx { background:#1a1a1a; color:#fff; padding:2px 8px; border-radius:6px; font-size:12px; }
      .label { font-weight:600; }
      .time { color:#999; font-size:12px; }
      .status { font-size:12px; padding:2px 8px; border-radius:6px; margin-left:auto; }
      .status.done { background:#e0f2f1; color:#00796b; }
      .status.failed { background:#ffebee; color:#c62828; }
      .status.pending { background:#fff8e1; color:#f57f17; }
      .grid { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; }
      .cell { background:#faf9f6; border-radius:10px; padding:8px; }
      .cap { font-size:11px; color:#999; margin-bottom:6px; text-align:center; }
      .cell svg, .cell img { width:100%; height:130px; object-fit:contain; display:block; background:
        repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px; border-radius:6px; }
      .empty { height:130px; display:flex; align-items:center; justify-content:center; color:#bbb; font-size:13px; background:#f0f0f0; border-radius:6px; }
    </style></head><body>
    <h1>DreamHome 抠图留痕</h1>
    <div class="meta">共 ${traces.length} 条 · 导出于 ${new Date().toLocaleString()}</div>
    ${rows || '<div class="empty">还没有留痕记录</div>'}
    </body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dreamhome-trace-${Date.now()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const Zoomable = ({ src, cap, failed }: { src: string | null; cap: string; failed?: boolean }) => (
    <div className={`trace-cell ${src ? 'clickable' : ''}`} onClick={() => src && setZoom({ src, cap })}>
      <div className="trace-cap">{cap}</div>
      {src
        ? <img src={src} alt="" />
        : <div className="trace-cell-empty">{failed ? '失败' : '等待中…'}</div>}
    </div>
  )

  const panel = (
    <div className={`trace-panel ${standalone ? 'trace-standalone' : ''}`}>
      <div className="trace-head">
        <span className="trace-title">抠图留痕 · {traces.length + backendOnly.length} 条</span>
        <div className="trace-actions">
          {!standalone && (
            <button
              className="trace-act"
              onClick={() => window.open('#/trace', '_blank')}
            >
              新页打开 ↗
            </button>
          )}
          <button className="trace-act" onClick={importBadcase}>导入历史 badcase</button>
          <button className="trace-act" onClick={exportHtml} disabled={traces.length === 0}>导出 HTML</button>
          <button className="trace-act" onClick={async () => { await clearBackendTraces(); onClear(); }}>清空全部</button>
          <button className="trace-act close" onClick={onClose}>✕</button>
        </div>
      </div>
      {stats && (
        <div className="trace-stats">
          <span className="trace-stat-item">AI 调用 <b>{stats.total}</b> 次</span>
          <span className="trace-stat-item ok">成功 <b>{stats.ok}</b></span>
          <span className="trace-stat-item fail">失败 <b>{stats.failed}</b></span>
          <span className="trace-stat-item cost">预估成本 <b>¥{stats.cost.toFixed(2)}</b></span>
          <span className="trace-stat-hint">（成本为估算，以百炼控制台为准，每 3s 自动刷新）</span>
        </div>
      )}
      <div className="trace-list">
        {traces.length === 0 && <div className="trace-empty">还没有留痕记录，圈选一个试试</div>}
        {traces.map((t, i) => {
          const w = Math.round(t.bbox.w)
          const h = Math.round(t.bbox.h)
          const statusText = t.status === 'done' ? '完成' : t.status === 'failed' ? '失败' : '等待中'
          return (
            <div className="trace-entry" key={t.id}>
              <div className="trace-entry-head">
                <span className="trace-idx">#{traces.length - i}</span>
                <span className="trace-label">{t.label}</span>
                <span className="trace-time">{formatTime(t.ts)}</span>
                <span className={`trace-status ${t.status}`}>{statusText}</span>
              </div>
              <div className="trace-grid">
                <div className="trace-cell">
                  <div className="trace-cap">画的形状</div>
                  <svg viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
                    <rect x={0} y={0} width={w} height={h} fill="none" stroke="#ccc" strokeDasharray="3 3" />
                    <polygon points={pathToSvgPoints(t.path)} fill="rgba(77,208,225,0.2)" stroke="#4dd0e1" strokeWidth="3" />
                  </svg>
                </div>
                <div className="trace-cell">
                  <div className="trace-cap">bbox 框</div>
                  <svg viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
                    <rect x={0} y={0} width={w} height={h} fill="rgba(255,122,61,0.06)" stroke="#ff7a3d" strokeWidth="3" />
                  </svg>
                </div>
                <Zoomable src={t.bboxDataUrl || null} cap="bbox 原图" failed={t.status === 'failed'} />
                <Zoomable src={t.inpaintDataUrl} cap="补全产物" failed={t.status === 'failed'} />
                <Zoomable src={t.cutoutDataUrl} cap="抠图产物" failed={t.status === 'failed'} />
                <Zoomable src={t.finalDataUrl} cap="最终产物" failed={t.status === 'failed'} />
              </div>
            </div>
          )
        })}
        {/* 后端历史 trace（图片存文件系统） */}
        {backendOnly.map((t, i) => {
          const statusText = t.status === 'done' ? '完成' : t.status === 'failed' ? '失败' : '等待中'
          return (
            <div className="trace-entry" key={t.id}>
              <div className="trace-entry-head">
                <span className="trace-idx">#{traces.length + i + 1}</span>
                <span className="trace-label">{t.label}</span>
                <span className="trace-time">{formatTime(t.ts)}</span>
                <span className={`trace-status ${t.status}`}>{statusText}</span>
                <span className="trace-history-tag">历史</span>
              </div>
              <div className="trace-grid">
                <div className="trace-cell">
                  <div className="trace-cap">画的形状</div>
                  <div className="trace-cell-empty">历史无轨迹</div>
                </div>
                <div className="trace-cell">
                  <div className="trace-cap">bbox 框</div>
                  <div className="trace-cell-empty">历史无框</div>
                </div>
                <Zoomable src={t.has_bbox ? traceImageUrl(t.id, 'bbox') : null} cap="bbox 原图" failed={t.status === 'failed'} />
                <Zoomable src={t.has_inpaint ? traceImageUrl(t.id, 'inpaint') : null} cap="补全产物" failed={t.status === 'failed'} />
                <Zoomable src={null} cap="抠图产物" failed={true} />
                <Zoomable src={t.has_final ? traceImageUrl(t.id, 'final') : null} cap="最终产物" failed={t.status === 'failed'} />
              </div>
            </div>
          )
        })}
      </div>
      {zoom && (
        <div className="trace-zoom" onClick={() => setZoom(null)}>
          <div className="trace-zoom-cap">{zoom.cap}</div>
          <img src={zoom.src} alt="" />
          <div className="trace-zoom-hint">点击任意处关闭</div>
        </div>
      )}
    </div>
  )

  return standalone ? createPortal(panel, document.body) : panel
}

export default App
