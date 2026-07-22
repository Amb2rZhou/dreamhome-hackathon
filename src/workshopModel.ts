import type { Blogger, CraftBatch, CraftJob, LibraryComponent } from './types'

export type WorkshopTaskStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface WorkshopReadyFurniture {
  source: 'readyMade'
  id: string
  component: LibraryComponent
}

export interface WorkshopLassoTask {
  source: 'lasso'
  batchId: string
  sourceFrame: { videoId: string; time: number }
  id: string
  name: string
  imageUrl: string
  status: WorkshopTaskStatus
  progress?: number
  resultComponentId?: string
  resultComponent?: LibraryComponent
}

export interface WorkshopBatchGroup {
  id: string
  createdAt: number
  sourceFrame: { videoId: string; time: number }
  tasks: WorkshopLassoTask[]
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
  batchGroups: WorkshopBatchGroup[]
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

function lassoTask(job: CraftJob, batch: CraftBatch): WorkshopLassoTask {
  const status = taskStatus(job)
  return {
    source: 'lasso',
    batchId: batch.id,
    sourceFrame: batch.sourceFrame,
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
  batches,
  blogger,
  sharedHomeFurniture,
}: {
  batches: CraftBatch[]
  blogger: Blogger
  sharedHomeFurniture: LibraryComponent[]
}): WorkshopData {
  if (batches.length === 0) {
    return {
      id: 'workshop-empty',
      home: { type: 'none' },
      readyFurniture: [],
      lassoTasks: [],
      batchGroups: [],
    }
  }

  const currentReadyFurniture = readyFurniture(batches.flatMap((batch) => batch.publicComponents))
  const batchGroups = batches.map((batch) => ({
    id: batch.id,
    createdAt: batch.createdAt,
    sourceFrame: batch.sourceFrame,
    tasks: batch.jobs.map((job) => lassoTask(job, batch)),
  }))
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
    id: batches.map((batch) => batch.id).join('|'),
    home,
    readyFurniture: currentReadyFurniture,
    lassoTasks: batchGroups.flatMap((group) => group.tasks),
    batchGroups,
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
