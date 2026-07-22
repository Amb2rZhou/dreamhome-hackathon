import type { Blogger, CraftBatch, CraftJob, LibraryComponent } from './types'

export type WorkshopTaskStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface WorkshopReadyFurniture {
  source: 'readyMade'
  id: string
  component: LibraryComponent
}

export interface WorkshopLassoTask {
  source: 'lasso'
  id: string
  name: string
  imageUrl: string
  status: WorkshopTaskStatus
  progress?: number
  resultComponentId?: string
  resultComponent?: LibraryComponent
}

export type WorkshopHomeContext =
  | { type: 'none' }
  | {
      type: 'shared'
      id: string
      name: string
      subtitle: string
      layoutId: string
      furniture: WorkshopReadyFurniture[]
    }

export interface WorkshopData {
  id: string
  home: WorkshopHomeContext
  readyFurniture: WorkshopReadyFurniture[]
  lassoTasks: WorkshopLassoTask[]
}

function taskStatus(job: CraftJob): WorkshopTaskStatus {
  if (job.status === 'done') return 'completed'
  if (job.status === 'failed') return 'failed'
  if (job.status === 'crafting') return 'processing'
  return 'queued'
}

function readyFurniture(components: LibraryComponent[]): WorkshopReadyFurniture[] {
  return components.map((component) => ({
    source: 'readyMade' as const,
    id: component.id,
    component,
  }))
}

function lassoTask(job: CraftJob): WorkshopLassoTask {
  const status = taskStatus(job)
  return {
    source: 'lasso',
    id: job.id,
    name: job.name,
    imageUrl: job.resultComponent?.sticker || job.snapshot,
    status,
    progress: status === 'completed' ? 100 : status === 'failed' ? job.progress ?? 0 : job.progress ?? (status === 'processing' ? 58 : 0),
    resultComponentId: job.resultComponent?.id,
    resultComponent: job.resultComponent,
  }
}

export function workshopFromAppState({
  batch,
  blogger,
  sharedHomeFurniture,
}: {
  batch: CraftBatch | null
  blogger: Blogger
  sharedHomeFurniture: LibraryComponent[]
}): WorkshopData {
  if (!batch) {
    return {
      id: 'workshop-empty',
      home: { type: 'none' },
      readyFurniture: [],
      lassoTasks: [],
    }
  }

  const currentReadyFurniture = readyFurniture(batch.publicComponents)
  const home = blogger.hasHome
    ? {
        type: 'shared' as const,
        id: blogger.id,
        name: blogger.homeName,
        subtitle: blogger.homeDesc,
        layoutId: blogger.homeLayoutId,
        furniture: readyFurniture(sharedHomeFurniture),
      }
    : { type: 'none' as const }

  return {
    id: batch.id,
    home,
    readyFurniture: currentReadyFurniture,
    lassoTasks: batch.jobs.map(lassoTask),
  }
}

const mockJobs = (components: LibraryComponent[]): WorkshopLassoTask[] => {
  const processing = components[0]
  const queuedFirst = components[1]
  const queuedSecond = components[2]
  const completed = components[3]
  return [
    {
      source: 'lasso',
      id: 'mock-processing',
      name: processing?.name ?? '待识别家具',
      imageUrl: processing?.completedImageUrl ?? processing?.sticker ?? '',
      status: 'processing',
      progress: 58,
    },
    {
      source: 'lasso',
      id: 'mock-queued-1',
      name: queuedFirst?.name ?? '待识别家具',
      imageUrl: queuedFirst?.completedImageUrl ?? queuedFirst?.sticker ?? '',
      status: 'queued',
      progress: 0,
    },
    {
      source: 'lasso',
      id: 'mock-queued-2',
      name: queuedSecond?.name ?? '待识别家具',
      imageUrl: queuedSecond?.completedImageUrl ?? queuedSecond?.sticker ?? '',
      status: 'queued',
      progress: 0,
    },
    {
      source: 'lasso',
      id: 'mock-completed',
      name: completed?.name ?? '已完成家具',
      imageUrl: completed?.completedImageUrl ?? completed?.sticker ?? '',
      status: 'completed',
      progress: 100,
      resultComponentId: completed?.id,
      resultComponent: completed,
    },
  ]
}

export function createWorkshopMocks({
  library,
  homeFurniture,
  blogger,
}: {
  library: LibraryComponent[]
  homeFurniture: LibraryComponent[]
  blogger: Blogger
}): Record<'empty' | 'assets' | 'home', WorkshopData> {
  return {
    empty: {
      id: 'mock-empty',
      home: { type: 'none' },
      readyFurniture: [],
      lassoTasks: [],
    },
    assets: {
      id: 'mock-assets',
      home: { type: 'none' },
      readyFurniture: readyFurniture(library),
      lassoTasks: mockJobs(library),
    },
    home: {
      id: 'mock-home',
      home: {
        type: 'shared',
        id: blogger.id,
        name: blogger.homeName,
        subtitle: blogger.homeDesc,
        layoutId: blogger.homeLayoutId,
        furniture: readyFurniture(homeFurniture),
      },
      readyFurniture: readyFurniture(library),
      lassoTasks: mockJobs(library),
    },
  }
}

export function workshopStatusSummary(data: WorkshopData): string {
  const processing = data.lassoTasks.filter((task) => task.status === 'processing').length
  const queued = data.lassoTasks.filter((task) => task.status === 'queued').length
  const completed = data.lassoTasks.filter((task) => task.status === 'completed').length
  const failed = data.lassoTasks.filter((task) => task.status === 'failed').length
  const parts: string[] = []
  if (processing) parts.push(`${processing} 件加工中`)
  if (queued) parts.push(`${queued} 件待加工`)
  if (completed) parts.push(`${completed} 件已完成`)
  if (failed) parts.push(`${failed} 件需处理`)
  return parts.length > 0 ? parts.join(' · ') : '暂时没有加工任务'
}
