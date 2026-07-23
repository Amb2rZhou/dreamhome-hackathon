import { useReducer, useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { FEED_VIDEOS, MOCK_OBJECTS, LIBRARY_SEED, CATEGORY_COLOR, CURRENT_BLOGGER, type FeedVideo, type FeedState, type SelectedObject, type LibraryComponent, type FurnitureCategory, type MascotState, type CraftJob, type CraftBatch, type TraceEntry } from './types'
import { genSticker } from './stickerGen'
import { captureBbox, captureVideoSelectionUpload, saveTraceToBackend, loadTracesFromBackend, traceImageUrl, type VideoSelectionUpload } from './segmentApi'
import { falJobToComponent, getFalJob } from './falGenerationApi'
import { confirmVideoSelection, submitVideoSelection } from './videoSelectionApi'
import type { SelectionMatchCandidate } from './videoSelectionApi'
import { AssetReuseDialog } from './AssetReuseDialog'
import { labelsToCategory, reusableAssetToComponent } from './assetReuse'
import { Mascot, type CollectionMascotMode } from './Mascot'
import { WorkshopDetail } from './WorkshopDetail'
import { FrameAssetsDrawer } from './FrameAssetsDrawer'
import { FurnitureAssetThumbnail } from './FurnitureAssetThumbnail'
import { VideoAssetsEntry } from './VideoAssetsEntry'
import { workshopFromAppState } from './workshopModel'
import { AVAILABLE_ASSETS_BY_VIDEO, assetsForVideoFrame, defaultAssetFrame } from './availableAssets.generated'
import {
  CommentIcon,
  HeartIcon as DouyinHeartIcon,
  MenuIcon,
  MusicIcon,
  SearchIcon,
  ShareIcon,
  StarIcon,
  UserIcon,
} from './DouyinIcons'
import { clientPointInElement } from './screenSpace'
import { hasSeenFeedOnboarding, rememberFeedOnboarding } from './onboardingState'
import './App.css'

interface State {
  phase: FeedState
  selected: SelectedObject[]
  tool: 'brush' | 'detect'
  activeObjectId: string | null
  showFailHint: boolean
  videoPlaying: boolean
  library: LibraryComponent[]
  toast: string | null
  mascot: MascotState
  craftQueue: CraftJob[]
  currentCraft: CraftJob | null
  batches: CraftBatch[]
  showCraftResult: boolean
  showCollectionDetail: boolean
  activeWorkshopBatchId: string | null
  craftStartTip: boolean
  craftStartTipShown: boolean
  traces: TraceEntry[]
  showTrace: boolean
}

interface GuideRect {
  x: number
  y: number
  w: number
  h: number
}

interface GuideTarget {
  box: GuideRect
  outlinePath: string
  label: string
}

type SessionGuideStage = 'idle' | 'pause' | 'recognize' | 'drag' | 'progress' | 'waiting' | 'complete' | 'done'

type PendingSelectionRequests = Map<string, {
  videoId: string
  time: number
  // Encoding the untouched full frame is allowed to finish in the
  // background. Keeping the promise here prevents the lasso UI from waiting
  // on a full-resolution JPEG while still guaranteeing that production waits
  // for the exact frame before it submits.
  uploadPromise: Promise<VideoSelectionUpload | null>
  labelPromise: Promise<string>
}>

const isCraftTerminal = (job: CraftJob) => (
  job.status === 'done' || job.status === 'failed' || job.status === 'waiting'
)

type Action =
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CHANGE_FEED_VIDEO' }
  | { type: 'SWITCH_TOOL'; tool: 'brush' | 'detect' }
  | { type: 'OBJECT_RECOGNIZED'; obj: SelectedObject }
  | { type: 'UPDATE_OBJECT_LABEL'; id: string; label: string; thumbnail: string }
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
  | { type: 'SHOW_TOAST'; msg: string }
  | { type: 'HIDE_TOAST' }
  | {
      type: 'START_CRAFT_BATCH'
      jobs: CraftJob[]
      publicComponents?: LibraryComponent[]
      sourceFrame: { videoId: string; time: number }
    }
  | { type: 'CRAFT_ORDERING_DONE'; id: string }
  | { type: 'HIDE_CRAFT_START_TIP' }
  | { type: 'CRAFT_DONE'; id: string; component: LibraryComponent }
  | { type: 'CRAFT_PROGRESS'; id: string; progress: number; stage?: string }
  | { type: 'CRAFT_FAILED'; id: string; error: string; stage?: string }
  | { type: 'CRAFT_WAITING'; id: string; error: string }
  | { type: 'CRAFT_BACKEND_SUBMITTED'; id: string; backendJobId: string; name: string; category: FurnitureCategory }
  | { type: 'RETRY_CRAFT'; id: string }
  | { type: 'SHOW_CRAFT_RESULT' }
  | { type: 'HIDE_CRAFT_RESULT' }
  | { type: 'CRAFT_CONFIRM_STORE' }
  | { type: 'CRAFT_DISCARD' }
  | { type: 'CLEAR_CRAFT_DONE_BUBBLE' }
  | { type: 'SHOW_COLLECTION_DETAIL'; batchId?: string }
  | { type: 'HIDE_COLLECTION_DETAIL' }
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
  toast: null,
  mascot: 'sleeping',
  craftQueue: [],
  currentCraft: null,
  showCraftResult: false,
  showCollectionDetail: false,
  activeWorkshopBatchId: null,
  craftStartTip: false,
  craftStartTipShown: false,
  batches: [],
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
      return { ...state, phase: 'browse', videoPlaying: true, selected: [], activeObjectId: null, showFailHint: false, showCollectionDetail: false }
    case 'CHANGE_FEED_VIDEO':
      return {
        ...state,
        phase: 'browse',
        videoPlaying: true,
        selected: [],
        activeObjectId: null,
        showFailHint: false,
        showCollectionDetail: false,
        showCraftResult: false,
        toast: null,
      }
    case 'SWITCH_TOOL':
      return { ...state, tool: action.tool }
    case 'OBJECT_RECOGNIZED':
      return {
        ...state,
        selected: [...state.selected, action.obj],
        activeObjectId: null,
        showFailHint: false,
      }
    case 'UPDATE_OBJECT_LABEL':
      return {
        ...state,
        selected: state.selected.map((object) => object.id === action.id
          ? {
              ...object,
              items: object.items.length > 0
                ? [{ ...object.items[0], label: action.label, thumbnail: action.thumbnail }, ...object.items.slice(1)]
                : [{ label: action.label, thumbnail: action.thumbnail }],
            }
          : object),
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
    case 'SHOW_TOAST':
      return { ...state, toast: action.msg }
    case 'HIDE_TOAST':
      return { ...state, toast: null }
    case 'START_CRAFT_BATCH': {
      const publicComponents = action.publicComponents ?? []
      const batch: CraftBatch = {
        id: `batch-${Date.now()}`,
        jobs: action.jobs.map((j) => ({ ...j, status: 'ordering' as const })),
        publicComponents,
        createdAt: Date.now(),
        sourceFrame: action.sourceFrame,
        notified: false,
        dismissed: false,
      }
      if (action.jobs.length === 0) {
        if (publicComponents.length === 0) return state
        return {
          ...state,
          batches: [...state.batches, batch],
          library: [...publicComponents, ...state.library],
          mascot: state.currentCraft ? 'working' : 'happy',
        }
      }
      if (state.currentCraft) {
        return {
          ...state,
          craftQueue: [...state.craftQueue, ...action.jobs.map((j) => ({ ...j, status: 'ordering' as const }))],
          batches: [...state.batches, batch],
          library: [...publicComponents, ...state.library],
          toast: state.craftQueue.length % 2 === 0
            ? '收到！这批我先收进工具袋，新的家具会接着排队开工～'
            : '收到啦！前面还有几件正在加工，这批马上排上～',
        }
      }
      const first = { ...action.jobs[0], status: 'ordering' as const }
      const rest = action.jobs.slice(1).map((j) => ({ ...j, status: 'ordering' as const }))
      return {
        ...state,
        currentCraft: first,
        craftQueue: [...state.craftQueue, ...rest],
        batches: [...state.batches, batch],
        library: [...publicComponents, ...state.library],
        mascot: 'working',
        craftStartTipShown: false,
      }
    }
    case 'CRAFT_ORDERING_DONE': {
      if (state.currentCraft?.id !== action.id) return state
      return {
        ...state,
        currentCraft: { ...state.currentCraft, status: 'crafting' },
        batches: state.batches.map((batch) => ({
          ...batch,
          jobs: batch.jobs.map((job) => job.id === action.id ? { ...job, status: 'crafting' } : job),
        })),
        mascot: 'working',
        craftStartTip: !state.craftStartTipShown,
        craftStartTipShown: true,
      }
    }
    case 'CRAFT_PROGRESS': {
      if (state.currentCraft?.id !== action.id) return state
      const patch = { progress: action.progress, stage: action.stage }
      return {
        ...state,
        currentCraft: { ...state.currentCraft, ...patch },
        batches: state.batches.map((batch) => ({
          ...batch,
          jobs: batch.jobs.map((job) => job.id === action.id ? { ...job, ...patch } : job),
        })),
      }
    }
    case 'HIDE_CRAFT_START_TIP':
      return { ...state, craftStartTip: false }
    case 'CRAFT_DONE': {
      if (state.currentCraft?.id !== action.id) return state
      const doneJob: CraftJob = { ...state.currentCraft, status: 'done', resultComponent: action.component }
      const batches = state.batches.map((b) => ({
        ...b,
        jobs: b.jobs.map((j) => (j.id === doneJob.id ? doneJob : j)),
      }))
      const next = state.craftQueue[0] ?? null
      const restQueue = state.craftQueue.slice(1)
      const batchDone = batches.find((b) => (
        b.jobs.some((j) => j.id === doneJob.id)
        && b.jobs.every(isCraftTerminal)
        && !b.notified
      ))
      const batchJustDone = !!batchDone
      const notifiedBatches = batchJustDone
        ? batches.map((b) => (b.id === batchDone!.id ? { ...b, notified: true, notifiedAt: Date.now() } : b))
        : batches
      return {
        ...state,
        currentCraft: next ? { ...next, status: 'ordering' } : null,
        craftQueue: restQueue,
        batches: notifiedBatches,
        library: [action.component, ...state.library],
        mascot: batchJustDone ? 'happy' : (next ? 'working' : 'sleeping'),
        craftStartTip: false,
        craftStartTipShown: next ? state.craftStartTipShown : false,
      }
    }
    case 'CRAFT_FAILED': {
      if (state.currentCraft?.id !== action.id) return state
      const failedJob: CraftJob = {
        ...state.currentCraft,
        status: 'failed',
        error: action.error,
        stage: action.stage,
      }
      const batches = state.batches.map((batch) => ({
        ...batch,
        jobs: batch.jobs.map((job) => job.id === failedJob.id ? failedJob : job),
      }))
      const next = state.craftQueue[0] ?? null
      const restQueue = state.craftQueue.slice(1)
      const terminalBatch = batches.find((batch) => (
        batch.jobs.some((job) => job.id === failedJob.id)
        && batch.jobs.every(isCraftTerminal)
        && !batch.notified
      ))
      return {
        ...state,
        currentCraft: next ? { ...next, status: 'ordering' } : null,
        craftQueue: restQueue,
        batches: terminalBatch
          ? batches.map((batch) => batch.id === terminalBatch.id
            ? { ...batch, notified: true, notifiedAt: Date.now() }
            : batch)
          : batches,
        mascot: terminalBatch ? 'happy' : (next ? 'working' : 'sleeping'),
        toast: '这件家具暂时没加工好，换个更完整的角度再试试。',
        craftStartTip: false,
        craftStartTipShown: next ? state.craftStartTipShown : false,
      }
    }
    case 'CRAFT_WAITING': {
      if (state.currentCraft?.id !== action.id) return state
      const waitingJob: CraftJob = {
        ...state.currentCraft,
        status: 'waiting',
        backendMode: 'waiting',
        error: action.error,
        stage: 'waiting_backend',
      }
      const batches = state.batches.map((batch) => ({
        ...batch,
        jobs: batch.jobs.map((job) => job.id === waitingJob.id ? waitingJob : job),
      }))
      const next = state.craftQueue[0] ?? null
      const restQueue = state.craftQueue.slice(1)
      return {
        ...state,
        currentCraft: next ? { ...next, status: 'ordering' } : null,
        craftQueue: restQueue,
        batches,
        mascot: next ? 'working' : 'sleeping',
        toast: '圈选已经保存，生成服务连接后可以直接重试。',
        craftStartTip: false,
        craftStartTipShown: next ? state.craftStartTipShown : false,
      }
    }
    case 'CRAFT_BACKEND_SUBMITTED': {
      if (state.currentCraft?.id !== action.id) return state
      const submitted: CraftJob = {
        ...state.currentCraft,
        name: action.name,
        category: action.category,
        color: CATEGORY_COLOR[action.category],
        backendMode: 'fal',
        backendJobId: action.backendJobId,
        error: undefined,
        stage: 'generate_3d',
      }
      return {
        ...state,
        currentCraft: submitted,
        batches: state.batches.map((batch) => ({
          ...batch,
          jobs: batch.jobs.map((job) => job.id === submitted.id ? submitted : job),
        })),
      }
    }
    case 'RETRY_CRAFT': {
      const waitingJob = state.batches.flatMap((batch) => batch.jobs)
        .find((job) => job.id === action.id && job.status === 'waiting')
      if (!waitingJob) return state
      const retryJob: CraftJob = {
        ...waitingJob,
        status: 'ordering',
        backendMode: 'retry',
        backendJobId: undefined,
        progress: 0,
        stage: 'submit',
        error: undefined,
      }
      const batches = state.batches.map((batch) => ({
        ...batch,
        jobs: batch.jobs.map((job) => job.id === retryJob.id ? retryJob : job),
      }))
      if (state.currentCraft) {
        return { ...state, batches, craftQueue: [...state.craftQueue, retryJob], mascot: 'working' }
      }
      return { ...state, batches, currentCraft: retryJob, mascot: 'working' }
    }
    case 'SHOW_CRAFT_RESULT':
      return { ...state, showCraftResult: true }
    case 'HIDE_CRAFT_RESULT':
      return { ...state, showCraftResult: false }
    case 'CRAFT_CONFIRM_STORE': {
      const doneBatch = state.batches.find((b) => b.jobs.every(isCraftTerminal) && !b.dismissed)
      if (!doneBatch) return { ...state, showCraftResult: false }
      const remainingBatches = state.batches.filter((b) => b.id !== doneBatch.id)
      const hasMore = !!state.currentCraft || state.craftQueue.length > 0
      return {
        ...state,
        showCraftResult: false,
        batches: remainingBatches,
        mascot: hasMore ? 'working' : 'sleeping',
        phase: 'browse',
      }
    }
    case 'CRAFT_DISCARD': {
      const doneBatch = state.batches.find((b) => b.jobs.every(isCraftTerminal) && !b.dismissed)
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
        if (b.jobs.every(isCraftTerminal) && !b.dismissed) return { ...b, dismissed: true }
        return b
      })
      return { ...state, batches, mascot: (state.currentCraft || state.craftQueue.length > 0) ? 'working' : 'sleeping' }
    }
    case 'SHOW_COLLECTION_DETAIL': {
      const requestedBatch = action.batchId
        ? state.batches.find((batch) => batch.id === action.batchId)
        : null
      const completedBatch = [...state.batches].reverse().find((batch) => (
        !batch.dismissed
        && batch.jobs.length > 0
        && batch.jobs.every(isCraftTerminal)
      ))
      const targetBatch = requestedBatch ?? completedBatch ?? state.batches[state.batches.length - 1] ?? null
      const targetIsTerminal = !!targetBatch
        && targetBatch.jobs.length > 0
        && targetBatch.jobs.every(isCraftTerminal)
      const batches = targetBatch && targetIsTerminal
        ? state.batches.map((batch) => batch.id === targetBatch.id ? { ...batch, dismissed: true } : batch)
        : state.batches
      return {
        ...state,
        batches,
        showCollectionDetail: true,
        activeWorkshopBatchId: targetBatch?.id ?? null,
        mascot: (state.currentCraft || state.craftQueue.length > 0) ? 'working' : 'sleeping',
      }
    }
    case 'HIDE_COLLECTION_DETAIL':
      return { ...state, showCollectionDetail: false, activeWorkshopBatchId: null }
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

function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [favoriteAssetIds, setFavoriteAssetIds] = useState<string[]>(() => {
    try {
      const legacy = JSON.parse(window.localStorage.getItem('dreamhome-favorite-assets') || '[]')
      const product = JSON.parse(window.localStorage.getItem('dreamhome.asset-library.v1') || '{}')
      const legacyIds = Array.isArray(legacy) ? legacy : []
      const productIds = Array.isArray(product?.ids) ? product.ids : []
      return Array.from(new Set([...legacyIds, ...productIds].filter(
        (id): id is string => typeof id === 'string',
      )))
    } catch {
      return []
    }
  })
  const [feedIndex, setFeedIndex] = useState(0)
  const [pausedFrame, setPausedFrame] = useState(() => ({
    videoId: FEED_VIDEOS[0].id,
    time: defaultAssetFrame(FEED_VIDEOS[0].id),
  }))
  const [collectionMascotMode, setCollectionMascotMode] = useState<CollectionMascotMode>('none')
  const [reuseCandidate, setReuseCandidate] = useState<SelectionMatchCandidate | null>(null)
  const reuseDecisionRef = useRef<((reuse: boolean) => void) | null>(null)
  // 教学只由冷启动气泡的“开始逛逛”启动；普通暂停不会擅自拉起新手引导。
  const [sessionGuideStage, setSessionGuideStage] = useState<SessionGuideStage>('idle')
  const videoRef = useRef<HTMLVideoElement>(null)
  const selectionRequestsRef = useRef<PendingSelectionRequests>(new Map())
  const feedTouchStartY = useRef<number | null>(null)
  const suppressPause = useRef(false)
  const wheelLocked = useRef(false)
  const activeFeedVideo = FEED_VIDEOS[feedIndex]
  const activeFrameAssets = useMemo(
    () => assetsForVideoFrame(pausedFrame.videoId, pausedFrame.time),
    [pausedFrame],
  )
  const activeVideoAssets = useMemo(
    () => AVAILABLE_ASSETS_BY_VIDEO[activeFeedVideo.id] ?? [],
    [activeFeedVideo.id],
  )
  useEffect(() => {
    const preloads = activeFrameAssets.map((component) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = component.completedImageUrl ?? component.sticker
      return image
    })
    return () => preloads.forEach((image) => { image.src = '' })
  }, [activeFrameAssets])
  const liveWorkshopData = useMemo(() => workshopFromAppState({
    batches: state.batches,
    blogger: CURRENT_BLOGGER,
    sharedHomeFurniture: [],
  }), [state.batches])
  // 调试 URL 也不再注入模拟/实时识别资产。
  // 没有用户主动圈选形成的批次时，小工坊必须保持空白态。
  const workshopData = liveWorkshopData
  const awaitingCollectionView = state.batches.some((batch) => (
    !batch.dismissed
    && batch.jobs.length > 0
    && batch.jobs.every(isCraftTerminal)
  ))
  const iosStatusDark = state.showTrace
  const iosHomeDark = iosStatusDark || state.showCollectionDetail || state.showCraftResult || state.phase === 'preview'
  const toggleFavoriteAsset = useCallback((id: string) => {
    setFavoriteAssetIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id])
  }, [])
  const favoriteAllAssets = useCallback((ids: string[]) => {
    setFavoriteAssetIds((current) => Array.from(new Set([...current, ...ids])))
  }, [])
  useEffect(() => {
    window.localStorage.setItem('dreamhome-favorite-assets', JSON.stringify(favoriteAssetIds))
    // Keep the Feed and the five-tab product shell on one canonical favorite
    // collection so “一键收藏” appears immediately under “我的收藏”.
    window.localStorage.setItem('dreamhome.asset-library.v1', JSON.stringify({
      version: 1,
      ids: favoriteAssetIds,
    }))
  }, [favoriteAssetIds])

  useEffect(() => {
    if (!awaitingCollectionView) return
    setSessionGuideStage((current) => (
      current === 'progress' || current === 'waiting' ? 'complete' : current
    ))
  }, [awaitingCollectionView])

  useEffect(() => {
    if (sessionGuideStage !== 'progress') return
    // This hint must never trap the user behind an onboarding overlay.
    const timer = window.setTimeout(() => setSessionGuideStage('waiting'), 4200)
    return () => window.clearTimeout(timer)
  }, [sessionGuideStage])

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
  }, [state.videoPlaying, feedIndex])

  useEffect(() => {
    const next = FEED_VIDEOS[(feedIndex + 1) % FEED_VIDEOS.length]
    const active = videoRef.current
    const preload = document.createElement('video')
    let warmTimer = 0
    const warmNext = () => {
      warmTimer = window.setTimeout(() => {
        preload.muted = true
        preload.playsInline = true
        preload.preload = 'auto'
        preload.src = next.src
        preload.load()
      }, 450)
    }
    if (active?.readyState && active.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      warmNext()
    } else {
      active?.addEventListener('canplay', warmNext, { once: true })
    }
    return () => {
      window.clearTimeout(warmTimer)
      active?.removeEventListener('canplay', warmNext)
      preload.removeAttribute('src')
      preload.load()
    }
  }, [feedIndex])

  const changeFeedVideo = (direction: 1 | -1) => {
    if (state.phase !== 'browse' || state.showCollectionDetail || state.showCraftResult || state.showTrace) return
    const nextIndex = (feedIndex + direction + FEED_VIDEOS.length) % FEED_VIDEOS.length
    const nextVideo = FEED_VIDEOS[nextIndex]
    setFeedIndex(nextIndex)
    setPausedFrame({ videoId: nextVideo.id, time: defaultAssetFrame(nextVideo.id) })
    setCollectionMascotMode('none')
    dispatch({ type: 'CHANGE_FEED_VIDEO' })
  }

  const requestReuseDecision = useCallback((candidate: SelectionMatchCandidate) => (
    new Promise<boolean>((resolve) => {
      reuseDecisionRef.current?.(false)
      reuseDecisionRef.current = resolve
      setReuseCandidate(candidate)
    })
  ), [])

  const finishReuseDecision = useCallback((reuse: boolean) => {
    const resolve = reuseDecisionRef.current
    reuseDecisionRef.current = null
    setReuseCandidate(null)
    resolve?.(reuse)
  }, [])

  useEffect(() => () => {
    reuseDecisionRef.current?.(false)
    reuseDecisionRef.current = null
  }, [])

  const craft = state.currentCraft
  useEffect(() => {
    if (!craft) return
    if (craft.status === 'ordering') {
      const t = setTimeout(() => dispatch({ type: 'CRAFT_ORDERING_DONE', id: craft.id }), 1600)
      return () => clearTimeout(t)
    }
    if (craft.status === 'crafting') {
      if (craft.backendMode === 'unavailable') {
        const timer = window.setTimeout(() => dispatch({
          type: 'CRAFT_WAITING',
          id: craft.id,
          error: craft.error || '3D 服务提交失败',
        }), 250)
        return () => window.clearTimeout(timer)
      }
      if (craft.backendMode === 'retry') {
        let cancelled = false
        const submit = async () => {
          try {
            const pendingSelection = craft.sourceSelectionId
              ? selectionRequestsRef.current.get(craft.sourceSelectionId)
              : null
            if (!pendingSelection) throw new Error('原始帧和圈选已丢失，请保持页面打开后重试')
            const upload = await pendingSelection.uploadPromise
            if (!upload) throw new Error('原始帧准备失败，请保持页面打开后重试')
            const selected = await submitVideoSelection({
              videoId: pendingSelection.videoId,
              time: pendingSelection.time,
              upload,
              categoryHint: craft.name === '待分类家具' ? '' : craft.name,
            })
            const candidate = selected.exact_match ?? selected.candidates[0]
            // Even an exact backend match must be visually confirmed: the user
            // needs to inspect the canonical GLB from every angle before binding it.
            const shouldReuse = candidate ? await requestReuseDecision(candidate) : false
            if (cancelled) return
            if (candidate && shouldReuse) {
              const reused = await confirmVideoSelection({
                videoId: pendingSelection.videoId,
                selectId: selected.select_id,
                useAssetId: candidate.asset.asset_id,
                generateNew: false,
              })
              if (!reused.asset_id) throw new Error('同款资产复用失败，请稍后重试')
              if (cancelled) return
              dispatch({
                type: 'CRAFT_DONE',
                id: craft.id,
                component: reusableAssetToComponent(candidate.asset, craft.snapshot),
              })
              dispatch({ type: 'SHOW_TOAST', msg: '找到已有同款 3D，已直接复用，没有重复生成。' })
              return
            }
            const submitted = await confirmVideoSelection({
              videoId: pendingSelection.videoId,
              selectId: selected.select_id,
              generateNew: true,
              qualityMode: 'production',
            })
            if (!submitted.job_id) throw new Error('正式生产后端未返回 3D 任务')
            if (cancelled) return
            const productionName = selected.labels.sub || selected.labels.category || craft.name
            const productionCategory = labelsToCategory(selected.labels)
            dispatch({
              type: 'CRAFT_BACKEND_SUBMITTED',
              id: craft.id,
              backendJobId: submitted.job_id,
              name: productionName,
              category: productionCategory,
            })
          } catch (error) {
            if (cancelled) return
            console.warn('[selection] production pipeline unavailable; preserving selection', error)
            dispatch({
              type: 'CRAFT_WAITING',
              id: craft.id,
              error: error instanceof Error ? error.message : '3D 生成服务暂时不可用',
            })
          }
        }
        void submit()
        return () => { cancelled = true }
      }
      if (craft.backendMode === 'fal' && craft.backendJobId) {
        let cancelled = false
        let timer = 0
        const poll = async () => {
          try {
            const job = await getFalJob(craft.backendJobId!)
            if (cancelled) return
            dispatch({ type: 'CRAFT_PROGRESS', id: craft.id, progress: job.progress ?? 0, stage: 'generate_3d' })
            if (job.status === 'succeeded') {
              dispatch({
                type: 'CRAFT_DONE',
                id: craft.id,
                component: falJobToComponent(job, {
                  id: craft.id,
                  name: craft.name,
                  category: craft.category,
                  snapshot: craft.snapshot,
                }),
              })
              return
            }
            if (job.status === 'failed') {
              dispatch({
                type: 'CRAFT_FAILED',
                id: craft.id,
                error: job.error || 'FAL generation failed',
                stage: 'generate_3d',
              })
              return
            }
            timer = window.setTimeout(poll, 1600)
          } catch (error) {
            if (cancelled) return
            timer = window.setTimeout(poll, 2400)
            console.warn('[DreamHome API] job polling failed; retrying', error)
          }
        }
        void poll()
        return () => {
          cancelled = true
          window.clearTimeout(timer)
        }
      }
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
      }, 15_000)
      return () => clearTimeout(t)
    }
  }, [craft, requestReuseDecision])

  return (
    <div
      className={`iphone-device ${iosStatusDark ? 'ios-status-dark' : ''} ${iosHomeDark ? 'ios-home-dark' : ''}`}
      aria-label="DreamHome iPhone 16 preview"
    >
      <span className="iphone-side-btn iphone-side-btn--action" aria-hidden="true" />
      <span className="iphone-side-btn iphone-side-btn--volume" aria-hidden="true" />
      <span className="iphone-side-btn iphone-side-btn--power" aria-hidden="true" />
      <div className="phone-viewport">
        <div className="phone">
          <div
            className="screen"
            onWheel={(event) => {
              if (Math.abs(event.deltaY) < 32 || wheelLocked.current) return
              wheelLocked.current = true
              changeFeedVideo(event.deltaY > 0 ? 1 : -1)
              window.setTimeout(() => { wheelLocked.current = false }, 420)
            }}
            onTouchStart={(event) => {
              feedTouchStartY.current = state.phase === 'browse' ? event.changedTouches[0]?.clientY ?? null : null
            }}
            onTouchEnd={(event) => {
              const startY = feedTouchStartY.current
              feedTouchStartY.current = null
              if (startY === null) return
              const endY = event.changedTouches[0]?.clientY ?? startY
              const deltaY = startY - endY
              if (Math.abs(deltaY) < 56) return
              suppressPause.current = true
              changeFeedVideo(deltaY > 0 ? 1 : -1)
              window.setTimeout(() => { suppressPause.current = false }, 320)
            }}
          >
        <video
          key={activeFeedVideo.id}
          ref={videoRef}
          src={activeFeedVideo.src}
          className="video feed-video-enter"
          loop
          muted
          playsInline
          autoPlay
          preload="auto"
        />

        {state.phase === 'browse' && (
          <BrowseLayer
            video={activeFeedVideo}
            videoAssets={activeVideoAssets}
            favoriteAssetIds={favoriteAssetIds}
            onToggleFavoriteAsset={toggleFavoriteAsset}
            onFavoriteAllAssets={favoriteAllAssets}
            onPause={() => {
              if (suppressPause.current) return
              const video = videoRef.current
              if (video) {
                video.pause()
                setPausedFrame({ videoId: activeFeedVideo.id, time: video.currentTime })
                void import('./mobileSam').then(({ prepareEdgeSamFrame }) => (
                  prepareEdgeSamFrame(video)
                )).catch((error) => {
                  console.warn('[EdgeSAM] paused frame pre-encode failed', error)
                })
                void import('./objectGuide').then(({ prepareFurnitureLabels }) => (
                  prepareFurnitureLabels(video)
                )).catch((error) => {
                  console.warn('[GuideDetector] paused frame detection failed', error)
                })
              }
              setSessionGuideStage((current) => current === 'pause' ? 'recognize' : current)
              dispatch({ type: 'PAUSE' })
            }}
          />
        )}

        {state.phase === 'browse' && sessionGuideStage === 'pause' && <PauseGuideOverlay />}

        {state.toast && (
          <ToastLifetime msg={state.toast} onDone={() => dispatch({ type: 'HIDE_TOAST' })} />
        )}

        {reuseCandidate && (
          <AssetReuseDialog
            candidate={reuseCandidate}
            onReuse={() => finishReuseDecision(true)}
            onGenerate={() => finishReuseDecision(false)}
          />
        )}

        <Mascot
          state={state.mascot}
          awaitingCollectionView={awaitingCollectionView}
          craftStartTip={state.craftStartTip}
          busy={!!state.currentCraft || state.craftQueue.length > 0}
          collectionMode={state.phase === 'session' ? collectionMascotMode : 'none'}
          guideMode={state.phase === 'session'
            ? (state.selected.length > 0 && collectionMascotMode === 'none' ? 'drag' : null)
            : null}
          progressGuideActive={sessionGuideStage === 'progress'}
          notice={state.toast ?? (state.showFailHint ? '这件家具还没完整露出来，换一帧或圈近一点再试试。' : null)}
          onOpenCollection={() => dispatch({ type: 'SHOW_COLLECTION_DETAIL' })}
          onBeginOnboarding={() => {
            if (hasSeenFeedOnboarding()) return
            rememberFeedOnboarding()
            setSessionGuideStage('pause')
          }}
          onProgressGuideOpened={() => setSessionGuideStage('waiting')}
          onCompletionGuideOpened={() => setSessionGuideStage('done')}
          onDismissStartTip={() => dispatch({ type: 'HIDE_CRAFT_START_TIP' })}
        />

        {sessionGuideStage === 'progress' && <ProgressGuideOverlay />}

        {state.phase === 'session' && (
          <SessionLayer
            state={state}
            dispatch={dispatch}
            videoId={activeFeedVideo.id}
            pausedTime={pausedFrame.time}
            selectionRequests={selectionRequestsRef.current}
            frameAssets={activeFrameAssets}
            favoriteAssetIds={favoriteAssetIds}
            onToggleFavoriteAsset={toggleFavoriteAsset}
            onMascotModeChange={setCollectionMascotMode}
            showRecognizeGuide={sessionGuideStage === 'recognize'}
            onRecognizeGuideShown={() => {
              setSessionGuideStage((current) => current === 'recognize' ? 'drag' : current)
            }}
            showDragGuide={sessionGuideStage === 'drag'}
            onDragGuideShown={() => {}}
            onCraftDropped={() => setSessionGuideStage((current) => (
              current === 'drag' ? 'progress' : current
            ))}
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
            onStartCraft={(objs) => {
              // 小工坊只接收用户主动圈选后生成的加工任务；
              // 暂停帧里的实时识别资产不再自动导入。
              const publicComponents: LibraryComponent[] = []
              const jobs: CraftJob[] = objs.filter((obj) => obj.source === 'custom').map((obj) => {
                const it = obj.items[0]
                const category = (MOCK_OBJECTS.find((m) => m.label === it.label)?.label ?? '其他') as FurnitureCategory
                const color = CATEGORY_COLOR[category] ?? '#8d6e63'
                return {
                  id: `craft-${obj.id}`,
                  name: it.label,
                  category,
                  snapshot: obj.snapshot,
                  color,
                  status: 'ordering' as const,
                  backendMode: 'retry' as const,
                  sourceSelectionId: obj.id,
                }
              })
              dispatch({ type: 'SHOW_TOAST', msg: '已收到，正在创建 3D 任务…' })
              dispatch({ type: 'START_CRAFT_BATCH', jobs, publicComponents, sourceFrame: pausedFrame })
            }}
            crafting={!!state.currentCraft}
          />
        )}

        {state.showCollectionDetail && (
          <WorkshopDetail
            data={workshopData}
            favoriteIds={favoriteAssetIds}
            onToggleFavorite={toggleFavoriteAsset}
            onClose={() => dispatch({ type: 'HIDE_COLLECTION_DETAIL' })}
            onRetryTask={(id) => dispatch({ type: 'RETRY_CRAFT', id })}
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
        <IOSChrome />
      </div>
    </div>
  )
}

function IOSChrome() {
  return (
    <div className="ios-chrome" aria-hidden="true">
      <div className="ios-statusbar">
        <span className="ios-time">9:41</span>
        <span className="ios-status-icons">
          <span className="ios-signal"><i /><i /><i /></span>
          <span className="ios-network">5G</span>
          <span className="ios-battery" />
        </span>
      </div>
      <div className="ios-dynamic-island" />
      <div className="ios-home-indicator" />
    </div>
  )
}

function ToastLifetime({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [msg, onDone])
  return null
}

function SocialBar({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <div className={`social-bar ${dimmed ? 'dimmed' : ''}`}>
      <button className="avatar-wrap" aria-label="作者头像">
        <span className="avatar"><UserIcon /></span>
        <span className="follow-plus">+</span>
      </button>
      <button className="social-btn" aria-label="点赞 12.3万">
        <DouyinHeartIcon className="social-icon social-icon-heart" />
        <span className="social-count">12.3w</span>
      </button>
      <button className="social-btn" aria-label="评论 856">
        <CommentIcon className="social-icon" />
        <span className="social-count">856</span>
      </button>
      <button className="social-btn" aria-label="收藏 2.1万">
        <StarIcon className="social-icon" />
        <span className="social-count">2.1w</span>
      </button>
      <button className="social-btn" aria-label="分享">
        <ShareIcon className="social-icon social-icon-share" />
        <span className="social-count">分享</span>
      </button>
      <div className="music-disc">
        <span className="disc-inner"><MusicIcon /></span>
      </div>
    </div>
  )
}

function BottomInfo({ video }: { video: FeedVideo }) {
  const showDefaultTopics = !video.captionBadge && !video.captionAction

  return (
    <div className="bottom-info">
      <div className="author-line">
        <span className="author">{video.author}</span>
        {video.authorBadge && <span className="author-badge">{video.authorBadge}</span>}
        {video.publishedAt && <span className="published-at">· {video.publishedAt}</span>}
      </div>
      <div className="caption">
        {video.captionBadge && <span className="caption-badge">{video.captionBadge}</span>}
        {video.caption}
        {video.captionAction && <span className="caption-action"> {video.captionAction}</span>}
        {showDefaultTopics && (
          <>
            <span className="topic"> #家居灵感</span>
            <span className="topic"> #客厅装修</span>
            <span className="topic"> #软装搭配</span>
          </>
        )}
      </div>
      <div className="music">
        <MusicIcon className="music-note" />
        <span className="music-text">{video.music}</span>
      </div>
    </div>
  )
}

const VIDEO_SCENES: Record<string, string> = {
  vid_40734d7f2e6c: '卧室（单间公寓）',
  vid_91fe552c5f7d: '48 平长厅公寓',
}

function SceneActions({ videoId }: { videoId: string }) {
  const sceneName = VIDEO_SCENES[videoId]
  const favoritesKey = 'dreamhome.favorite-video-layouts.v1'
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!sceneName) return
    try {
      const ids = JSON.parse(window.localStorage.getItem(favoritesKey) || '[]')
      setSaved(Array.isArray(ids) && ids.includes(videoId))
    } catch {
      setSaved(false)
    }
  }, [sceneName, videoId])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!sceneName) return null

  const toggleFavorite = () => {
    let ids: string[] = []
    try {
      const parsed = JSON.parse(window.localStorage.getItem(favoritesKey) || '[]')
      ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
      ids = []
    }
    const nextSaved = !ids.includes(videoId)
    const next = nextSaved ? Array.from(new Set([...ids, videoId])) : ids.filter((id) => id !== videoId)
    window.localStorage.setItem(favoritesKey, JSON.stringify(next))
    setSaved(nextSaved)
    setNotice(nextSaved ? `已收藏 ${sceneName}` : '已取消收藏布局')
  }

  return (
    <>
      <section className="scene-actions-inline" aria-label={`${sceneName}的同款小家`}>
        <a
          className="scene-action-inline scene-action-inline--primary"
          href={`/prototype/pages/my-home/index.html?case=${encodeURIComponent(videoId)}`}
          target="_top"
          aria-label={`查看${sceneName}的 1:1 同款小家`}
        >
          查看同款小家
        </a>
        <button
          type="button"
          className="scene-action-inline"
          aria-pressed={saved}
          onClick={toggleFavorite}
        >
          {saved ? '✓ 已收藏布局' : '收藏布局'}
        </button>
      </section>
      {notice && <div className="scene-action-notice" role="status">{notice}</div>}
    </>
  )
}

function DreamHomeNavIcon({ kind }: { kind: 'capture' | 'feed' | 'library' | 'favorites' | 'home' }) {
  const paths = {
    capture: <><path d="M8.7 4.6h6.6l1.3 2.1h2.8A2.6 2.6 0 0 1 22 9.3v8.3a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 17.6V9.3a2.6 2.6 0 0 1 2.6-2.6h2.8l1.3-2.1Z" /><circle cx="12" cy="13.3" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" /></>,
    feed: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m10 8.2 6.2 3.8-6.2 3.8V8.2Z" /></>,
    library: <><path d="M12 2.6a6.4 6.4 0 0 0-3.9 11.5c.5.4.7.9.8 1.5l.1.9h6l.1-.9c.1-.6.3-1.1.8-1.5A6.4 6.4 0 0 0 12 2.6Z" /><rect x="8.7" y="17.4" width="6.6" height="1.9" rx="1" /></>,
    favorites: <path d="M7 3.6h10a2.2 2.2 0 0 1 2.2 2.2v13.9c0 .9-.9 1.4-1.7.9L12 17.2l-5.5 3.4c-.8.5-1.7 0-1.7-.9V5.8A2.2 2.2 0 0 1 7 3.6Z" />,
    home: <path d="m3.2 10.4 8.8-7.6 8.8 7.6v8a2 2 0 0 1-2 2h-4.1v-5.7H9.3v5.7H5.2a2 2 0 0 1-2-2v-8Z" />,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>
}

function DreamHomeBottomNav() {
  const items = [
    { kind: 'capture' as const, label: '拍一张', href: '/prototype/pages/capture/index.html' },
    { kind: 'feed' as const, label: '刷一刷', href: '/prototype/pages/discover/index.html', active: true },
    { kind: 'library' as const, label: '资产库', href: '/prototype/pages/inspiration-library/index.html' },
    { kind: 'favorites' as const, label: '收藏', href: '/prototype/pages/my-favorites/index.html' },
    { kind: 'home' as const, label: '我的家', href: '/prototype/pages/my-home/index.html' },
  ]
  return (
    <nav className="douyin-bottom-nav dreamhome-bottom-nav" aria-label="DreamHome 主功能导航">
      {items.map((item) => (
        <a
          key={item.kind}
          className={`douyin-nav-item dreamhome-nav-item ${item.active ? 'is-active' : ''}`}
          href={item.href}
          target="_top"
          aria-current={item.active ? 'page' : undefined}
        >
          <DreamHomeNavIcon kind={item.kind} />
          <span className="dreamhome-nav-label">{item.label}</span>
        </a>
      ))}
    </nav>
  )
}

function BrowseLayer({
  video,
  videoAssets,
  favoriteAssetIds,
  onToggleFavoriteAsset,
  onFavoriteAllAssets,
  onPause,
}: {
  video: FeedVideo
  videoAssets: LibraryComponent[]
  favoriteAssetIds: string[]
  onToggleFavoriteAsset: (id: string) => void
  onFavoriteAllAssets: (ids: string[]) => void
  onPause: () => void
}) {
  return (
    <>
      <div className="top-tabs">
        <button className="top-menu" aria-label="打开菜单"><MenuIcon /></button>
        <div className="tabs-center" aria-label="视频频道">
          <span className="tab">同城</span>
          <span className="tab">直播</span>
          <span className="tab">团购</span>
          <span className="tab">关注</span>
          <span className="tab">商城</span>
          <span className="tab active">推荐</span>
        </div>
        <button className="top-search" aria-label="搜索"><SearchIcon /></button>
      </div>
      <div className="tap-area" onClick={onPause} />
      <SocialBar />
      <VideoAssetsEntry
        assets={videoAssets}
        favoriteIds={favoriteAssetIds}
        onFavorite={onToggleFavoriteAsset}
        onFavoriteAll={onFavoriteAllAssets}
      />
      <BottomInfo video={video} />
      <SceneActions videoId={video.id} />
      <DreamHomeBottomNav />
    </>
  )
}

function PauseGuideOverlay() {
  return (
    <div className="pause-guide" aria-live="polite">
      <div className="pause-guide-card">
        <div className="pause-guide-copy">
          <strong>刷到心动的家居，记得先暂停画面</strong>
          <span>轻点画面暂停，把这份家居灵感留下来。</span>
        </div>
        <img
          className="pause-guide-mascot"
          src="/mascot-motion/guide-pointer-v1.png"
          alt="包工球提示轻点画面"
        />
      </div>
      <div className="pause-guide-gesture" aria-hidden="true">
        <span className="pause-guide-tap-ring" />
        <GuideHandIcon className="pause-guide-hand" />
      </div>
    </div>
  )
}

function ProgressGuideOverlay() {
  return (
    <>
      <div className="progress-guide-shade" aria-hidden="true" />
      <div className="progress-guide-card" aria-live="polite">
        <strong>随时来看看做到哪一步</strong>
        <span>轻点右下角的包工球就能看进度。看完继续刷就好，做好了它会来提醒你～</span>
      </div>
    </>
  )
}

type SessionGuideMode = 'recognize' | 'drag'

function GuideHandIcon({
  className,
  style,
}: {
  className: string
  style?: React.CSSProperties
}) {
  return (
    <svg className={className} style={style} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M44.5 58.2c-7.7 4.4-17.2 2.3-22.4-4.3L10.6 40.5c-2.2-2.8-1.6-6.8 1.2-8.8 2.7-2 6.5-1.4 8.5 1.2l4.9 6.1V13.2c0-4.2 3-7.2 6.9-7.2s6.9 3 6.9 7.2v17.1l2.4-6.4c1.3-3.5 4.8-5.4 8.1-4.1 3.1 1.2 4.6 4.6 3.4 7.8l-1.6 4.1c2.4-2.4 6.1-2.5 8.5-.2 2.5 2.3 2.6 6.1.3 8.7l-2.6 2.9c2.5-1.2 5.6-.3 7.1 2.1 1.7 2.7.9 6.2-1.8 8.1l-10.5 7.3c-2.2 1.5-5 1.4-7.8-2.4Z"
        fill="white"
        stroke="rgba(18,22,28,0.2)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SessionGuideOverlay({
  mode,
  focusBox,
  guideTarget,
}: {
  mode: SessionGuideMode
  focusBox: GuideRect | null
  guideTarget: GuideTarget | null
}) {
  const [metrics, setMetrics] = useState({
    width: 393,
    height: 852,
    mascot: { x: 305, y: 560, w: 80, h: 80 },
  })

  useEffect(() => {
    const updateMetrics = () => {
      const screen = document.querySelector<HTMLElement>('.screen')
      if (!screen) return
      const screenRect = screen.getBoundingClientRect()
      const localWidth = screen.clientWidth || 393
      const localHeight = screen.clientHeight || 852
      const scaleX = screenRect.width / localWidth
      const scaleY = screenRect.height / localHeight
      const toLocalRect = (rect: DOMRect | undefined, fallback: GuideRect): GuideRect => rect
        ? {
            x: (rect.left - screenRect.left) / scaleX,
            y: (rect.top - screenRect.top) / scaleY,
            w: rect.width / scaleX,
            h: rect.height / scaleY,
          }
        : fallback
      const mascotRect = document.querySelector<HTMLElement>('.mascot-root')?.getBoundingClientRect()
      setMetrics({
        width: localWidth,
        height: localHeight,
        mascot: toLocalRect(mascotRect, { x: localWidth - 88, y: localHeight - 292, w: 80, h: 80 }),
      })
    }
    const frame = window.requestAnimationFrame(updateMetrics)
    window.addEventListener('resize', updateMetrics)
    window.addEventListener('pointerup', updateMetrics)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateMetrics)
      window.removeEventListener('pointerup', updateMetrics)
    }
  }, [mode, focusBox?.x, focusBox?.y, focusBox?.w, focusBox?.h, guideTarget?.box.x, guideTarget?.box.y, guideTarget?.box.w, guideTarget?.box.h])

  const recognizeFocus: GuideRect = guideTarget?.box ?? {
    x: metrics.width * 0.18,
    y: metrics.height * 0.3,
    w: metrics.width * 0.64,
    h: metrics.height * 0.24,
  }
  const dragFocus = focusBox ? (() => {
    const width = Math.min(metrics.width - 24, focusBox.w + 24)
    const height = Math.min(metrics.height - 108, focusBox.h + 24)
    return {
      x: Math.min(metrics.width - width - 12, Math.max(12, focusBox.x - 12)),
      y: Math.min(metrics.height - height - 24, Math.max(84, focusBox.y - 12)),
      w: width,
      h: height,
    }
  })() : null
  const focus = mode === 'drag' && dragFocus ? dragFocus : recognizeFocus
  const mascotCenter = {
    x: metrics.mascot.x + metrics.mascot.w / 2,
    y: metrics.mascot.y + metrics.mascot.h / 2,
  }
  const focusCenter = {
    x: focus.x + focus.w / 2,
    y: focus.y + focus.h / 2,
  }
  const dragDelta = {
    x: mascotCenter.x - focusCenter.x,
    y: mascotCenter.y - focusCenter.y,
  }
  const recognizeTargetPath = guideTarget?.outlinePath ?? ''
  const gestureCenter = {
    x: metrics.width * 0.5,
    y: Math.min(metrics.height - 210, Math.max(300, metrics.height * 0.52)),
  }
  const gestureRadius = {
    x: Math.min(112, metrics.width * 0.29),
    y: Math.min(82, metrics.height * 0.105),
  }
  const recognizeGesturePath = [
    `M ${gestureCenter.x} ${gestureCenter.y - gestureRadius.y}`,
    `C ${gestureCenter.x + gestureRadius.x * 0.72} ${gestureCenter.y - gestureRadius.y}, ${gestureCenter.x + gestureRadius.x} ${gestureCenter.y - gestureRadius.y * 0.45}, ${gestureCenter.x + gestureRadius.x} ${gestureCenter.y}`,
    `C ${gestureCenter.x + gestureRadius.x} ${gestureCenter.y + gestureRadius.y * 0.62}, ${gestureCenter.x + gestureRadius.x * 0.58} ${gestureCenter.y + gestureRadius.y}, ${gestureCenter.x} ${gestureCenter.y + gestureRadius.y}`,
    `C ${gestureCenter.x - gestureRadius.x * 0.68} ${gestureCenter.y + gestureRadius.y}, ${gestureCenter.x - gestureRadius.x} ${gestureCenter.y + gestureRadius.y * 0.42}, ${gestureCenter.x - gestureRadius.x} ${gestureCenter.y}`,
    `C ${gestureCenter.x - gestureRadius.x} ${gestureCenter.y - gestureRadius.y * 0.6}, ${gestureCenter.x - gestureRadius.x * 0.62} ${gestureCenter.y - gestureRadius.y}, ${gestureCenter.x} ${gestureCenter.y - gestureRadius.y}`,
  ].join(' ')
  const dragPath = [
    `M ${focusCenter.x} ${focusCenter.y}`,
    `C ${focusCenter.x + dragDelta.x * 0.3} ${focusCenter.y + Math.min(58, dragDelta.y * 0.16)}, ${mascotCenter.x - dragDelta.x * 0.18} ${mascotCenter.y - Math.max(42, dragDelta.y * 0.22)}, ${mascotCenter.x} ${mascotCenter.y}`,
  ].join(' ')
  const promptTop = mode === 'recognize'
    ? 86
    : focus.y < 190
      ? Math.min(metrics.height - 154, focus.y + focus.h + 18)
      : Math.max(102, focus.y - 78)

  return (
    <div
      className={`session-guide session-guide--${mode}`}
      aria-live="polite"
    >
      <svg className="session-guide-shade" viewBox={`0 0 ${metrics.width} ${metrics.height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <mask id={`session-guide-mask-${mode}`} maskUnits="userSpaceOnUse" x="0" y="0" width={metrics.width} height={metrics.height}>
            <rect width={metrics.width} height={metrics.height} fill="white" />
            {mode === 'recognize' && recognizeTargetPath && <path d={recognizeTargetPath} fill="black" />}
            {mode === 'drag' && (
              <>
                <rect x={focus.x} y={focus.y} width={focus.w} height={focus.h} rx="18" fill="black" />
                <circle cx={mascotCenter.x} cy={mascotCenter.y} r={Math.max(metrics.mascot.w, metrics.mascot.h) * 0.64} fill="black" />
              </>
            )}
          </mask>
        </defs>
        <rect
          width={metrics.width}
          height={metrics.height}
          fill={mode === 'recognize' ? 'rgba(8, 12, 16, 0.76)' : 'rgba(8, 12, 16, 0.68)'}
          mask={`url(#session-guide-mask-${mode})`}
        />
      </svg>

      <div className="session-guide-prompt" style={{ top: promptTop }}>
        <div className="session-guide-copy session-guide-copy--with-mascot">
          <div className="session-guide-copy-text">
            <strong>{mode === 'recognize'
              ? '圈选想留下的家居'
              : '把选中的家具交给包工球'}</strong>
            <span>{mode === 'recognize'
              ? '沿着任意家具外沿画一圈，松手后自动识别'
              : '按住任意已选区域，直接拖进右下角的小推车'}</span>
          </div>
        </div>
        <img
          className={`session-guide-card-mascot ${mode === 'drag' ? 'session-guide-card-mascot--pointer' : ''}`}
          src={mode === 'recognize'
            ? '/mascot-motion/guide-checklist-v1.png'
            : '/mascot-motion/guide-pointer-v1.png'}
          alt={mode === 'recognize' ? '包工球拿着检查清单' : '包工球拿着教棍提示拖拽'}
        />
      </div>

      {mode === 'recognize' && recognizeGesturePath && (
        <>
          <svg className="session-guide-trace-layer" viewBox={`0 0 ${metrics.width} ${metrics.height}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="session-guide-trace session-guide-trace--circle" d={recognizeGesturePath} pathLength="1" />
          </svg>
          <GuideHandIcon
            className="session-guide-hand session-guide-hand--circle"
            style={{ offsetPath: `path('${recognizeGesturePath}')` }}
          />
        </>
      )}

      {mode === 'drag' && (
        <>
          <div
            className="session-guide-cart-ring"
            style={{
              left: mascotCenter.x - Math.max(metrics.mascot.w, metrics.mascot.h) * 0.66,
              top: mascotCenter.y - Math.max(metrics.mascot.w, metrics.mascot.h) * 0.66,
              width: Math.max(metrics.mascot.w, metrics.mascot.h) * 1.32,
              height: Math.max(metrics.mascot.w, metrics.mascot.h) * 1.32,
            }}
            aria-hidden="true"
          />
          <span
            className="session-guide-hold-ring"
            style={{ left: focusCenter.x - 20, top: focusCenter.y - 20 }}
            aria-hidden="true"
          />
          <svg className="session-guide-trace-layer" viewBox={`0 0 ${metrics.width} ${metrics.height}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="session-guide-trace session-guide-trace--drag" d={dragPath} pathLength="1" />
          </svg>
          <GuideHandIcon
            className="session-guide-hand session-guide-hand--drag"
            style={{ offsetPath: `path('${dragPath}')` }}
          />
        </>
      )}
    </div>
  )
}

function SessionLayer({
  state,
  dispatch,
  videoId,
  pausedTime,
  selectionRequests,
  frameAssets,
  favoriteAssetIds,
  onToggleFavoriteAsset,
  onMascotModeChange,
  showRecognizeGuide,
  onRecognizeGuideShown,
  showDragGuide,
  onDragGuideShown,
  onCraftDropped,
}: {
  state: State
  dispatch: React.Dispatch<Action>
  videoId: string
  pausedTime: number
  selectionRequests: PendingSelectionRequests
  frameAssets: LibraryComponent[]
  favoriteAssetIds: string[]
  onToggleFavoriteAsset: (id: string) => void
  onMascotModeChange: (mode: CollectionMascotMode) => void
  showRecognizeGuide: boolean
  onRecognizeGuideShown: () => void
  showDragGuide: boolean
  onDragGuideShown: () => void
  onCraftDropped: () => void
}) {
  const drawingRef = useRef(false)
  const movedRef = useRef(false)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const recognizingRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const penTipRef = useRef<HTMLDivElement>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const bboxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const pathRef = useRef<{ x: number; y: number }[]>([])
  const holdTimerRef = useRef<number | null>(null)
  const pickupResetTimerRef = useRef<number | null>(null)
  const pickupCaptureTargetRef = useRef<HTMLElement | null>(null)
  const pickupFinalizedRef = useRef(true)
  const pressRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    objectId: string
  } | null>(null)
  const gestureModeRef = useRef<'idle' | 'drawing' | 'pickup'>('idle')
  const cutoutHitMasksRef = useRef(new Map<string, {
    width: number
    height: number
    alpha: Uint8ClampedArray
  }>())
  const [pickup, setPickup] = useState<{
    phase: 'idle' | 'pressing' | 'dragging' | 'dropping' | 'returning'
    x: number
    y: number
    hovering: boolean
  }>({ phase: 'idle', x: 0, y: 0, hovering: false })
  const pickupPhaseRef = useRef<'idle' | 'pressing' | 'dragging' | 'dropping' | 'returning'>('idle')
  const pickupHoveringRef = useRef(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [frameAssetsOpen, setFrameAssetsOpen] = useState(false)
  const [recognizeGuideVisible, setRecognizeGuideVisible] = useState(showRecognizeGuide)
  const recognizeGuideShownRef = useRef(false)
  const [dragGuideVisible, setDragGuideVisible] = useState(false)
  const showDragGuideRef = useRef(showDragGuide)
  const onDragGuideShownRef = useRef(onDragGuideShown)

  useEffect(() => {
    showDragGuideRef.current = showDragGuide
    onDragGuideShownRef.current = onDragGuideShown
  }, [onDragGuideShown, showDragGuide])

  const selectedCount = state.selected.reduce((sum, obj) => sum + obj.items.length, 0)
  // The pickup card represents the user's explicit submission. Furniture
  // discovered automatically in the paused frame stays browse-only and must
  // not inflate this count.
  const collectionCount = selectedCount
  const sessionGuideMode: SessionGuideMode | null = pickup.phase === 'idle'
    ? selectedCount === 0
      ? (recognizeGuideVisible ? 'recognize' : null)
      : (dragGuideVisible ? 'drag' : null)
    : null

  useEffect(() => {
    onMascotModeChange('none')
    return () => onMascotModeChange('none')
  }, [onMascotModeChange])

  useEffect(() => {
    if (!recognizeGuideVisible || recognizeGuideShownRef.current) return
    recognizeGuideShownRef.current = true
    onRecognizeGuideShown()
  }, [onRecognizeGuideShown, recognizeGuideVisible])

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('.video')
    if (!video) return
    let cancelled = false
    const prepare = () => {
      window.requestAnimationFrame(async () => {
        if (cancelled) return
        void import('./mobileSam').then(({ prepareEdgeSamFrame }) => (
          prepareEdgeSamFrame(video)
        )).catch((error) => {
          console.warn('[EdgeSAM] frame preparation failed', error)
        })
        void import('./objectGuide').then(({ prepareFurnitureLabels }) => (
          prepareFurnitureLabels(video)
        )).catch((error) => {
          console.warn('[GuideDetector] frame preparation failed', error)
        })
      })
    }
    const preparePausedFrame = () => {
      if (video.paused) prepare()
      else video.addEventListener('pause', prepare, { once: true })
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) preparePausedFrame()
    else video.addEventListener('loadeddata', preparePausedFrame, { once: true })
    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', preparePausedFrame)
      video.removeEventListener('pause', prepare)
    }
  }, [])

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
    return clientPointInElement(screen, clientX, clientY)
  }

  const cacheCutoutHitMask = (objectId: string, image: HTMLImageElement) => {
    if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const alpha = new Uint8ClampedArray(canvas.width * canvas.height)
    for (let sourceIndex = 3, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 4, targetIndex += 1) {
      alpha[targetIndex] = pixels[sourceIndex]
    }
    cutoutHitMasksRef.current.set(objectId, {
      width: canvas.width,
      height: canvas.height,
      alpha,
    })
  }

  const hitTestCutout = (point: { x: number; y: number }) => {
    for (let index = state.selected.length - 1; index >= 0; index -= 1) {
      const object = state.selected[index]
      const { box } = object
      if (
        point.x < box.x
        || point.x > box.x + box.w
        || point.y < box.y
        || point.y > box.y + box.h
      ) continue
      const mask = cutoutHitMasksRef.current.get(object.id)
      if (box.w <= 0 || box.h <= 0) continue
      // The alpha hit mask is prepared after the cutout image paints. Until
      // then, fall back to its visible bounding box so the object can be
      // picked up immediately instead of feeling locked for one render/load.
      if (!mask) return object
      const maskX = Math.min(mask.width - 1, Math.max(0, Math.floor(((point.x - box.x) / box.w) * mask.width)))
      const maskY = Math.min(mask.height - 1, Math.max(0, Math.floor(((point.y - box.y) / box.h) * mask.height)))
      if (mask.alpha[maskY * mask.width + maskX] >= 32) return object
    }
    return null
  }

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const isInsideCart = (clientX: number, clientY: number) => {
    const rect = document.querySelector<HTMLElement>('.mascot-root')?.getBoundingClientRect()
    if (!rect) return false
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const attractionRadius = Math.max(rect.width, rect.height) * 1.35
    return Math.hypot(clientX - centerX, clientY - centerY) <= attractionRadius
  }

  const beginPickup = (e: React.PointerEvent, object: SelectedObject) => {
    if (selectedCount === 0) return
    const point = getCanvasPos(e.clientX, e.clientY)
    if (!point) return
    setDragGuideVisible(false)
    e.preventDefault()
    e.stopPropagation()
    clearHoldTimer()
    if (pickupResetTimerRef.current !== null) {
      window.clearTimeout(pickupResetTimerRef.current)
      pickupResetTimerRef.current = null
    }
    movedRef.current = false
    pickupFinalizedRef.current = false
    pressRef.current = {
      pointerId: e.pointerId,
      startX: point.x,
      startY: point.y,
      objectId: object.id,
    }
    dispatch({ type: 'SELECT_OBJECT', id: object.id })
    pickupPhaseRef.current = 'pressing'
    pickupHoveringRef.current = false
    setPickup({ phase: 'pressing', x: point.x, y: point.y, hovering: false })
    const captureTarget = e.currentTarget as HTMLElement
    pickupCaptureTargetRef.current = captureTarget
    try {
      captureTarget.setPointerCapture(e.pointerId)
    } catch {
      // Global release listeners still end the gesture when capture is not
      // available (notably after an iOS system gesture interrupts the page).
    }
    holdTimerRef.current = window.setTimeout(() => {
      if (!pressRef.current) return
      drawingRef.current = false
      movedRef.current = false
      pathRef.current = []
      bboxRef.current = null
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) context.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      pickupPhaseRef.current = 'dragging'
      setPickup((current) => ({ ...current, phase: 'dragging' }))
      onMascotModeChange('collecting')
      holdTimerRef.current = null
    }, 360)
  }

  const movePickup = (e: React.PointerEvent) => {
    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId) return
    const point = getCanvasPos(e.clientX, e.clientY)
    if (!point) return
    e.preventDefault()
    e.stopPropagation()
    if (pickupPhaseRef.current === 'pressing') {
      const distance = Math.hypot(point.x - press.startX, point.y - press.startY)
      if (distance <= 4) return

      // A cutout is already an explicit selection, so movement means drag.
      // Previously movement cancelled pickup until a 360 ms long-press had
      // elapsed, which made a freshly extracted object feel unresponsive.
      clearHoldTimer()
      drawingRef.current = false
      movedRef.current = true
      pathRef.current = []
      bboxRef.current = null
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) context.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      const hovering = isInsideCart(e.clientX, e.clientY)
      pickupPhaseRef.current = 'dragging'
      pickupHoveringRef.current = hovering
      setPickup({ phase: 'dragging', x: point.x, y: point.y, hovering })
      onMascotModeChange(hovering ? 'ready' : 'collecting')
      return
    }
    if (pickupPhaseRef.current !== 'dragging') return
    const hovering = isInsideCart(e.clientX, e.clientY)
    pickupHoveringRef.current = hovering
    setPickup({
      phase: 'dragging',
      x: point.x,
      y: point.y,
      hovering,
    })
    onMascotModeChange(hovering ? 'ready' : 'collecting')
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
    const appendDrawingPoint = (point: { x: number; y: number } | null) => {
      if (!drawingRef.current || !point) return
      const start = drawStartRef.current
      if (!start) return
      if (!movedRef.current) {
        // Delay lasso activation until the gesture is clearly a drag. This
        // keeps a normal tap available for resuming the paused video while
        // tolerating the small amount of movement common on touch screens.
        if (Math.hypot(point.x - start.x, point.y - start.y) < 10) return
        movedRef.current = true
        drawStrokeTo(start.x, start.y)
      }
      drawStrokeTo(point.x, point.y)
    }
    const onMove = (e: MouseEvent | PointerEvent) => {
      const p = getCanvasPos(e.clientX, e.clientY)
      updatePenTip(p)
      appendDrawingPoint(p)
    }
    const clearCanvas = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    }
    const onUp = async (event: Event) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      drawStartRef.current = null
      lastPointRef.current = null
      updatePenTip(null)
      if (!movedRef.current) {
        pathRef.current = []
        bboxRef.current = null
        clearCanvas()
        // A cancelled system gesture should be inert. A deliberate tap on the
        // unobstructed video resumes playback without requiring the close
        // button; controls and cards sit above this drawing surface.
        if (event.type !== 'pointercancel') dispatch({ type: 'RESUME' })
        return
      }
      const b = bboxRef.current
      bboxRef.current = null
      if (!b || b.maxX - b.minX < 8 || b.maxY - b.minY < 8) {
        clearCanvas()
        dispatch({ type: 'OBJECT_FAILED' })
        setTimeout(() => dispatch({ type: 'HIDE_FAIL_HINT' }), 2000)
        return
      }
      // Give EdgeSAM room to recover object parts just outside an imperfect
      // lasso (vase bases, table legs) without expanding the visible gesture.
      const pad = 20
      const box = {
        x: Math.max(0, b.minX - pad),
        y: Math.max(0, b.minY - pad),
        w: b.maxX - b.minX + pad * 2,
        h: b.maxY - b.minY + pad * 2,
      }
      const path = pathRef.current
      pathRef.current = []
      recognizingRef.current = true
      setIsRecognizing(true)
      // Let React paint once before preparing the lightweight preview. The
      // lasso must not remain blocked on EdgeSAM: slower devices can take
      // several seconds to initialise ONNX/WASM.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const video = document.querySelector<HTMLVideoElement>('.video')
      const selectionTime = video?.currentTime ?? pausedTime
      const realtimeLabelPromise = video
        ? import('./objectGuide').then(({ detectGuideFurniture }) => (
          detectGuideFurniture(video, box)
        ))
          .then((detection) => detection?.label || '家具')
          .catch((error) => {
            console.warn('[GuideDetector] realtime label failed', error)
            return '家具'
          })
        : Promise.resolve('家具')
      const selectionUploadPromise = video
        ? captureVideoSelectionUpload(video, box, path).catch((error) => {
            console.warn('[selection] unable to prepare original frame', error)
            return null
          })
        : Promise.resolve(null)
      // The contextual bbox is an immediate, temporary preview. The original
      // full frame remains the production input and EdgeSAM can refine this
      // preview asynchronously without blocking the gesture.
      let bboxDataUrl = ''
      if (video && path.length > 2) {
        bboxDataUrl = (await captureBbox(video, box)) ?? ''
      }
      const objId = `obj-${Date.now()}`
      const recognizedItem = { label: '识别中…', thumbnail: '✦' }
      dispatch({
        type: 'ADD_TRACE',
        trace: {
          id: objId,
          ts: Date.now(),
          path: path.map((p) => ({ x: p.x - box.x, y: p.y - box.y })),
          bbox: box,
          bboxDataUrl,
          inpaintDataUrl: null,
          cutoutDataUrl: null,
          finalDataUrl: null,
          label: recognizedItem.label,
          status: 'pending',
        },
      })
      // Start EdgeSAM now, but never await it on the interaction path.
      // Web SAM is presentation-only; production still receives the original
      // frame and selection coordinates.
      const edgeSamPromise = video
        ? import('./mobileSam').then(({ segmentWithEdgeSam }) => (
          segmentWithEdgeSam(video, path, box)
        )).catch((error) => {
            console.warn('[EdgeSAM] background cutout failed; keeping contextual preview', error)
            return null
          })
        : Promise.resolve(null)
      const preview = bboxDataUrl || genSticker('其他', CATEGORY_COLOR.其他, 99)
      const obj: SelectedObject = {
        id: objId,
        box,
        items: [recognizedItem],
        snapshot: preview,
        source: 'custom',
      }
      // Register the pending source artifact before exposing the sticker. The
      // user can continue immediately; production awaits this promise only
      // after the object is fed to the mascot.
      selectionRequests.set(objId, {
        videoId,
        time: selectionTime,
        uploadPromise: selectionUploadPromise,
        labelPromise: realtimeLabelPromise,
      })
      dispatch({ type: 'OBJECT_RECOGNIZED', obj })
      // The preview is now usable. Retire the hand-drawn loop immediately;
      // EdgeSAM and realtime labelling continue in the background.
      window.requestAnimationFrame(() => {
        recognizingRef.current = false
        setIsRecognizing(false)
        clearCanvas()
      })
      if (showDragGuideRef.current) {
        setDragGuideVisible(true)
        onDragGuideShownRef.current()
      } else {
        setDragGuideVisible(false)
      }
      void realtimeLabelPromise.then((realtimeLabel) => {
        const realtimeThumbnail = MOCK_OBJECTS.find((item) => item.label === realtimeLabel)?.thumbnail ?? '✦'
        dispatch({
          type: 'UPDATE_OBJECT_LABEL',
          id: objId,
          label: realtimeLabel,
          thumbnail: realtimeThumbnail,
        })
        dispatch({ type: 'UPDATE_TRACE', id: objId, patch: { label: realtimeLabel } })
      })

      void Promise.all([edgeSamPromise, realtimeLabelPromise]).then(async ([edgeSamResult, realtimeLabel]) => {
        const refinedCutout = edgeSamResult?.dataUrl ?? null
        if (refinedCutout) {
          dispatch({ type: 'UPDATE_SNAPSHOT', id: objId, snapshot: refinedCutout })
        }
        const finalPreview = refinedCutout || preview
        dispatch({
          type: 'UPDATE_TRACE',
          id: objId,
          patch: {
            label: realtimeLabel,
            cutoutDataUrl: refinedCutout,
            inpaintDataUrl: null,
            finalDataUrl: finalPreview,
            status: 'done',
          },
        })
        console.log(
          '[pipeline]',
          objId,
          refinedCutout ? 'edgeSam: ok' : 'edgeSam: fallback preview',
          'label:', realtimeLabel,
          'path:', path.length,
          'box:', box,
        )

        // Persist diagnostic trace without blocking selection or dragging.
        try {
          const saved = await saveTraceToBackend({
            id: objId,
            ts: Date.now(),
            label: realtimeLabel,
            status: 'done',
            bboxDataUrl,
            inpaintDataUrl: null,
          })
          console.log('[pipeline] backend save:', saved ? 'ok' : 'fail')
        } catch (error) {
          console.warn('[pipeline] backend save error:', error)
        }
      })
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!drawingRef.current || !e.touches[0]) return
      const t = e.touches[0]
      const p = getCanvasPos(t.clientX, t.clientY)
      appendDrawingPoint(p)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onUp)
    }
  }, [state.selected.length, pausedTime, videoId, selectionRequests, dispatch])

  const startDraw = (e: React.PointerEvent) => {
    if (recognizingRef.current) return
    setRecognizeGuideVisible(false)
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
    drawStartRef.current = p
    if (!p) drawingRef.current = false
  }

  const handleCraft = async () => {
    if (state.selected.length === 0) return
    const selectedObjects = [...state.selected]
    // 实时帧识别结果只辅助圈选，不自动进入小工坊。
    // 小工坊的数据源始终是用户明确圈选并提交的对象。
    const publicComponents: LibraryComponent[] = []
    const customObjects = selectedObjects.filter((obj) => obj.source === 'custom')
    onMascotModeChange('none')
    dispatch({ type: 'STORE' })
    if (customObjects.length > 0) {
      dispatch({ type: 'SHOW_TOAST', msg: '已收到，正在创建 3D 任务…' })
      onCraftDropped()
    }

    const labeledCustomObjects = await Promise.all(customObjects.map(async (obj) => {
      const pendingLabel = selectionRequests.get(obj.id)?.labelPromise
      const label = pendingLabel
        ? await Promise.race([
            pendingLabel,
            new Promise<string>((resolve) => window.setTimeout(() => resolve(obj.items[0]?.label || '家具'), 1200)),
          ])
        : obj.items[0]?.label || '家具'
      return {
        ...obj,
        items: obj.items.length > 0
          ? [{ ...obj.items[0], label }, ...obj.items.slice(1)]
          : [{ label, thumbnail: '✦' }],
      }
    }))

    const jobs: CraftJob[] = labeledCustomObjects.map((obj) => {
      const initialLabel = obj.items[0]?.label || '家具'
      const fallbackCategory = (MOCK_OBJECTS.find((item) => item.label === initialLabel)?.label ?? '其他') as FurnitureCategory
      return {
        id: `craft-${obj.id}-0`,
        name: initialLabel,
        category: fallbackCategory,
        snapshot: obj.snapshot,
        color: CATEGORY_COLOR[fallbackCategory],
        status: 'ordering',
        backendMode: 'retry',
        sourceSelectionId: obj.id,
      }
    })

    dispatch({
      type: 'START_CRAFT_BATCH',
      jobs,
      publicComponents,
      sourceFrame: { videoId, time: pausedTime },
    })
  }

  const endPickup = (
    pointerId: number,
    options: { cancelled?: boolean; clientX?: number; clientY?: number } = {},
  ) => {
    const press = pressRef.current
    if (!press || press.pointerId !== pointerId || pickupFinalizedRef.current) return
    pickupFinalizedRef.current = true
    clearHoldTimer()
    pressRef.current = null
    gestureModeRef.current = 'idle'
    updatePenTip(null)
    const captureTarget = pickupCaptureTargetRef.current
    pickupCaptureTargetRef.current = null
    if (captureTarget?.hasPointerCapture(pointerId)) {
      try {
        captureTarget.releasePointerCapture(pointerId)
      } catch {
        // Capture may already have been released by the browser. Finalization
        // is deliberately independent from capture ownership.
      }
    }
    if (pickupPhaseRef.current === 'dragging') {
      const hovering = !options.cancelled
        && (typeof options.clientX === 'number' && typeof options.clientY === 'number'
          ? isInsideCart(options.clientX, options.clientY)
          : pickupHoveringRef.current)
      pickupHoveringRef.current = hovering
      if (hovering) {
        pickupPhaseRef.current = 'dropping'
        setPickup((current) => ({ ...current, phase: 'dropping', hovering: true }))
        onMascotModeChange('receiving')
        window.setTimeout(() => { void handleCraft() }, 360)
      } else {
        pickupPhaseRef.current = 'returning'
        setPickup((current) => ({ ...current, phase: 'returning', hovering: false }))
        onMascotModeChange('none')
        dispatch({ type: 'SHOW_TOAST', msg: '重新试试，再靠近一点就能放进来！' })
        pickupResetTimerRef.current = window.setTimeout(() => {
          pickupResetTimerRef.current = null
          pickupPhaseRef.current = 'idle'
          pickupHoveringRef.current = false
          setPickup({ phase: 'idle', x: 0, y: 0, hovering: false })
        }, 240)
      }
      return
    }

    // Pickup only begins on an opaque sticker pixel. A quick tap therefore
    // selects the exact cutout it started on, never its transparent rectangle.
    if (!movedRef.current) {
      drawingRef.current = false
      pathRef.current = []
      bboxRef.current = null
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) context.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      dispatch({ type: 'SELECT_OBJECT', id: press.objectId })
    }
    pickupPhaseRef.current = 'idle'
    pickupHoveringRef.current = false
    setPickup({ phase: 'idle', x: 0, y: 0, hovering: false })
    onMascotModeChange('none')
  }

  useEffect(() => {
    const finishPointer = (event: PointerEvent) => {
      endPickup(event.pointerId, {
        cancelled: event.type === 'pointercancel',
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }
    const finishMouse = (event: MouseEvent) => {
      const pointerId = pressRef.current?.pointerId
      if (pointerId === undefined) return
      endPickup(pointerId, { clientX: event.clientX, clientY: event.clientY })
    }
    const cancelActivePickup = () => {
      const pointerId = pressRef.current?.pointerId
      if (pointerId !== undefined) endPickup(pointerId, { cancelled: true })
    }
    const finishTouch = (event: TouchEvent) => {
      const pointerId = pressRef.current?.pointerId
      if (pointerId === undefined) return
      const touch = event.changedTouches.item(0)
      endPickup(pointerId, touch
        ? { clientX: touch.clientX, clientY: touch.clientY }
        : {})
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') cancelActivePickup()
    }

    // Pointer capture is helpful but not sufficient: Safari can drop it when
    // the pointer crosses an iframe/browser boundary. Capture-phase global
    // listeners guarantee that releasing anywhere ends the pickup exactly once.
    window.addEventListener('pointerup', finishPointer, true)
    window.addEventListener('pointercancel', finishPointer, true)
    window.addEventListener('mouseup', finishMouse, true)
    window.addEventListener('touchend', finishTouch, true)
    window.addEventListener('touchcancel', cancelActivePickup, true)
    window.addEventListener('blur', cancelActivePickup)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointerup', finishPointer, true)
      window.removeEventListener('pointercancel', finishPointer, true)
      window.removeEventListener('mouseup', finishMouse, true)
      window.removeEventListener('touchend', finishTouch, true)
      window.removeEventListener('touchcancel', cancelActivePickup, true)
      window.removeEventListener('blur', cancelActivePickup)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  useEffect(() => () => {
    clearHoldTimer()
    if (pickupResetTimerRef.current !== null) window.clearTimeout(pickupResetTimerRef.current)
  }, [])

  return (
    <>
      {sessionGuideMode && (
        <SessionGuideOverlay
          mode={sessionGuideMode}
          focusBox={state.selected[0]?.box ?? null}
          guideTarget={null}
        />
      )}

      <button className="top-play" onClick={() => dispatch({ type: 'RESUME' })}>
        ✕
      </button>

      {frameAssets.length > 0 && (
        <button
          type="button"
          className="frame-assets-batch"
          aria-label={`查看本次发现的 ${frameAssets.length} 件现成家具`}
          aria-haspopup="dialog"
          onClick={() => setFrameAssetsOpen(true)}
        >
          <img className="frame-assets-mascot" src="/mascot-discovery-banner.png" alt="" />
          <svg className="frame-assets-sparkle" viewBox="0 0 42 42" aria-hidden="true">
            <path d="M14 2c1.2 7.1 4.1 10 11.2 11.2C18.1 14.4 15.2 17.3 14 24.4 12.8 17.3 9.9 14.4 2.8 13.2 9.9 12 12.8 9.1 14 2Z" />
            <path d="M31.5 4.5c.7 4.2 2.5 6 6.7 6.7-4.2.7-6 2.5-6.7 6.7-.7-4.2-2.5-6-6.7-6.7 4.2-.7 6-2.5 6.7-6.7Z" />
          </svg>
          <div className="frame-assets-copy">
            <strong>本次发现 {frameAssets.length} 件现成家具</strong>
            <span>点开看看这批灵感，稍后一起收进灵感库</span>
          </div>
          <div className="frame-assets-thumbs" aria-hidden="true">
            {frameAssets.slice(0, 4).map((component) => (
              <span key={component.id}><FurnitureAssetThumbnail component={component} /></span>
            ))}
            {frameAssets.length > 4 && <b>+{frameAssets.length - 4}</b>}
          </div>
          <span className="frame-assets-chevron" aria-hidden="true">›</span>
        </button>
      )}

      {frameAssetsOpen && (
        <FrameAssetsDrawer
          assets={frameAssets}
          favoriteIds={favoriteAssetIds}
          onFavorite={onToggleFavoriteAsset}
          onClose={() => setFrameAssetsOpen(false)}
        />
      )}

      <canvas
        ref={canvasRef}
        className={`draw-canvas ${isRecognizing ? 'is-recognizing' : ''}`}
      />

      <div
        className={`draw-layer ${isRecognizing ? 'is-recognizing' : ''}`}
        onPointerDown={(event) => {
          const point = getCanvasPos(event.clientX, event.clientY)
          const hit = point ? hitTestCutout(point) : null
          if (hit) {
            gestureModeRef.current = 'pickup'
            beginPickup(event, hit)
          } else {
            gestureModeRef.current = 'drawing'
            startDraw(event)
          }
        }}
        onPointerMove={(event) => {
          updatePenTip(getCanvasPos(event.clientX, event.clientY))
          if (gestureModeRef.current === 'pickup') movePickup(event)
        }}
        onPointerUp={(event) => {
          if (gestureModeRef.current === 'pickup') {
            event.preventDefault()
            event.stopPropagation()
            endPickup(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
          }
          gestureModeRef.current = 'idle'
        }}
        onPointerCancel={(event) => {
          if (gestureModeRef.current === 'pickup') {
            event.preventDefault()
            event.stopPropagation()
            endPickup(event.pointerId, { cancelled: true })
          }
          gestureModeRef.current = 'idle'
        }}
        onLostPointerCapture={(event) => {
          endPickup(event.pointerId, { cancelled: true })
        }}
        onPointerLeave={() => updatePenTip(null)}
      />

      <div className="pen-tip" ref={penTipRef} />

      <div
        className="object-layer"
      >
        {state.selected.map((obj) => (
          <div
            key={obj.id}
            className={`obj-card ${state.activeObjectId === obj.id ? 'active' : ''}`}
            style={{ left: obj.box.x, top: obj.box.y, width: obj.box.w, height: obj.box.h }}
          >
            <img
              className="obj-card-cutout"
              src={obj.snapshot}
              alt="已抠出的家具"
              draggable={false}
              onLoad={(event) => cacheCutoutHitMask(obj.id, event.currentTarget)}
            />
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

      {pickup.phase === 'pressing' && (
        <div
          className="pickup-hold-ring"
          style={{ transform: `translate3d(${pickup.x - 19}px, ${pickup.y - 19}px, 0)` }}
          aria-hidden="true"
        />
      )}

      {pickup.phase !== 'idle' && pickup.phase !== 'pressing' && (
        <div
          className={`pickup-card pickup-card--${pickup.phase} ${pickup.hovering ? 'is-hovering' : ''}`}
          style={{ transform: `translate3d(${pickup.x - 28}px, ${pickup.y - 74}px, 0)` }}
          aria-label={`拖动 ${collectionCount} 件家具`}
        >
          <div className="pickup-card-visual">
            <span className="pickup-card-sheet pickup-card-sheet--back" />
            <span className="pickup-card-sheet pickup-card-sheet--middle" />
            <span className="pickup-card-sheet pickup-card-sheet--front">
              <b>{collectionCount > 9 ? '9+' : collectionCount}</b>
              <i className="pickup-card-dots"><em /><em /><em /></i>
            </span>
          </div>
        </div>
      )}

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
  onStartCraft,
  crafting,
}: {
  selected: SelectedObject[]
  onClose: () => void
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
  // 后端历史 trace（图片存文件系统，不受 localStorage 限制）
  const [backendTraces, setBackendTraces] = useState<{
    id: string
    ts: number
    label: string
    status: string
    has_bbox: boolean
    has_inpaint: boolean
  }[]>([])

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
    fetchBackendTraces()
    const t = setInterval(() => {
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
          ${cell('EdgeSAM 抠图', imgOr(t.cutoutDataUrl))}
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
      .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
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
                <Zoomable src={t.cutoutDataUrl} cap="EdgeSAM 抠图" failed={t.status === 'failed'} />
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
                <Zoomable src={t.has_inpaint ? traceImageUrl(t.id, 'inpaint') : null} cap="识别产物" failed={t.status === 'failed'} />
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
