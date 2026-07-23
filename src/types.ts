import { genSticker } from './stickerGen'

export type FeedState = 'browse' | 'pause' | 'session' | 'confirm' | 'preview'

export type MascotState = 'sleeping' | 'happy' | 'working'

export interface CraftJob {
  id: string
  name: string
  category: FurnitureCategory
  snapshot: string
  color: string
  status: 'ordering' | 'crafting' | 'waiting' | 'done' | 'failed'
  progress?: number
  stage?: string
  error?: string
  backendJobId?: string
  backendMode?: 'fal' | 'local-fallback' | 'retry' | 'waiting' | 'unavailable'
  sourceSelectionId?: string
  resultComponent?: LibraryComponent
}

export interface CraftBatch {
  id: string
  jobs: CraftJob[]
  publicComponents: LibraryComponent[]
  createdAt: number
  sourceFrame: {
    videoId: string
    time: number
  }
  notified: boolean
  notifiedAt?: number
  dismissed: boolean
}

export interface SelectedObject {
  id: string
  box: { x: number; y: number; w: number; h: number }
  items: { label: string; thumbnail: string }[]
  snapshot: string
  source: 'public' | 'custom'
  publicAssetId?: string
}

export interface TraceEntry {
  id: string
  ts: number
  path: { x: number; y: number }[]
  bbox: { x: number; y: number; w: number; h: number }
  bboxDataUrl: string
  inpaintDataUrl: string | null
  cutoutDataUrl: string | null
  finalDataUrl: string | null
  label: string
  status: 'pending' | 'done' | 'failed'
}

export interface Blogger {
  id: string
  name: string
  handle: string
  avatarColor: string
  bio: string
  followers: string
  likes: string
  hasHome: boolean
  homeLayoutId: string
  homeName: string
  homeDesc: string
}

export type FurnitureCategory = '沙发' | '茶几' | '吊灯' | '绿植' | '装饰画' | '地毯' | '其他'

export interface LibraryComponent {
  id: string
  category: FurnitureCategory
  sourceCategory?: string
  name: string
  source: string
  sourceDescription?: string
  size: string
  styleTags: string[]
  thumbnail: string
  color: string
  sticker: string
  completedImageUrl?: string
  sourceCropUrl?: string
  modelUrl?: string
  sourceVideo?: {
    blogger: string
    frameTime: string
    frameImg?: string
    videoId?: string
    startSec?: number
    endSec?: number
    appearances?: Array<{
      startSec: number
      endSec: number
      representativeSec: number
    }>
  }
}

export interface FeedVideo {
  id: string
  src: string
  author: string
  authorBadge?: string
  publishedAt?: string
  captionBadge?: string
  captionAction?: string
  caption: string
  music: string
  source: 'local' | 'amber'
}

const amberFeedVideo = (
  id: string,
  ordinal: string,
  overrides: Partial<Omit<FeedVideo, 'id' | 'src' | 'source'>> = {},
): FeedVideo => ({
  id,
  // The eight Douyin source videos are versioned with the static prototype.
  // Keep the feed pointed at that canonical GitHub/Vercel asset location.
  src: `/prototype/assets/videos/${id}.mp4`,
  author: '@家居灵感研究所',
  caption: `家装灵感实拍 ${ordinal} · 把喜欢的家具圈进小工坊`,
  music: '原声 - Amber 家装灵感视频',
  source: 'amber',
  ...overrides,
})

export const FEED_VIDEOS: FeedVideo[] = [
  amberFeedVideo('vid_40734d7f2e6c', '02', {
    author: '@鸡蛋灌饼',
    publishedAt: '5天前',
    captionBadge: '查看图文版',
    caption: '我说幸福万万岁！ #治愈系小窝 #宅家 #卧室布置',
    music: '原声 - 鸡蛋灌饼',
  }),
  {
    id: 'home-1',
    src: '/videos/home-1.mp4',
    author: '@家居灵感研究所',
    caption: '这个北欧风客厅太治愈了，每一处软装都想抄回家',
    music: '原声 - home_vibes · 北欧治愈系居家BGM',
    source: 'local',
  },
  amberFeedVideo('vid_b75d95dc92a7', '01', {
    author: '@拾点',
    publishedAt: '04月22日',
    caption: '房价会跌，生活总不能跌吧～ #原木风室内装修 #日式原木风家居 #温馨…',
    captionAction: '展开',
    music: '原声 - 拾点',
  }),
  amberFeedVideo('vid_5c7efd168eb7', '03', {
    author: '@拾点',
    publishedAt: '01月01日',
    caption: '普通人家在大城市的小房子｜69平3室2厅 #家的样子 #小户型 #理想的…',
    captionAction: '展开',
    music: '原声 - 拾点',
  }),
  amberFeedVideo('vid_182cbf77954d', '04', {
    author: '@山月知心的家',
    publishedAt: '5天前',
    caption: '第 83 集｜两个人住，东西不多，清清爽爽的原木风小家 - 轻风格的家，',
    captionAction: '展开',
    music: '原声 - 山月知心的家',
  }),
  amberFeedVideo('vid_58a7a1504281', '05', {
    author: '@sweet安宅',
    authorBadge: '章节要点⌃',
    publishedAt: '01月06日',
    caption: 'room tour｜大城市普通人的家🏡 #ins风客厅布置 #人生选择题 #享受…',
    captionAction: '展开',
    music: '生活水底、nightfall',
  }),
  amberFeedVideo('vid_91fe552c5f7d', '06', {
    author: '@云上的小路',
    publishedAt: '05月24日',
    caption: '买不起大房子，有一个48平的小家也很不错啊#抖音宝藏生活家#温馨的…',
    captionAction: '展开',
    music: '原声 - 云上的小路',
  }),
  amberFeedVideo('vid_5f32a0ac954a', '07', {
    author: '@lila（求关注版）',
    publishedAt: '07月03日',
    caption: '27岁时给自己买的一室一厅',
    music: '原声 - lila（求关注版）',
  }),
  amberFeedVideo('vid_605df2fff231', '08', {
    author: '@一叁Iris',
    publishedAt: '2025年08月11日',
    caption: '一镜到底｜云参观耗时大半年装修好的家吧🏡 #家的样子 #一镜到底 #中…',
    captionAction: '展开',
    music: '原声 - 一叁Iris',
  }),
]

// 兼容仍依赖单视频常量的旧模块；Feed 主界面使用 FEED_VIDEOS。
export const VIDEO_SRC = FEED_VIDEOS[0].src

export const MOCK_OBJECTS = [
  { label: '沙发', thumbnail: '🛋️' },
  { label: '茶几', thumbnail: '🪵' },
  { label: '吊灯', thumbnail: '💡' },
  { label: '绿植', thumbnail: '🪴' },
  { label: '装饰画', thumbnail: '🖼️' },
  { label: '地毯', thumbnail: '🟫' },
] as const

export const CATEGORY_COLOR: Record<FurnitureCategory, string> = {
  '沙发': '#8d6e63',
  '茶几': '#a1887f',
  '吊灯': '#c9a227',
  '绿植': '#4a7c37',
  '装饰画': '#5c6bc0',
  '地毯': '#9e6b5a',
  '其他': '#c59a43',
}

const RAW_SEED: Omit<LibraryComponent, 'sticker'>[] = [
  { id: 'seed-1', category: '沙发', name: '北欧布艺三人沙发', source: '来自探家视频 · 今天 14:32', size: '220 × 90 × 85 cm', styleTags: ['北欧', '布艺', '米色'], thumbnail: '🛋️', color: CATEGORY_COLOR['沙发'], sourceVideo: { blogger: '@家居灵感研究所', frameTime: '0:14' } },
  { id: 'seed-2', category: '吊灯', name: '黄铜分子吊灯', source: '来自装修视频 · 今天 14:30', size: '∅ 60 × 45 cm', styleTags: ['工业', '黄铜', '多头'], thumbnail: '💡', color: CATEGORY_COLOR['吊灯'], sourceVideo: { blogger: '@装修日记本', frameTime: '0:32' } },
  { id: 'seed-3', category: '绿植', name: '琴叶榕落地', source: '来自探家视频 · 昨天 21:08', size: '∅ 30 × 160 cm', styleTags: ['大型绿植', '陶盆'], thumbnail: '🪴', color: CATEGORY_COLOR['绿植'], sourceVideo: { blogger: '@绿植生活馆', frameTime: '0:08' } },
  { id: 'seed-4', category: '茶几', name: '胡桃木圆茶几', source: '来自线下拍照 · 昨天 16:50', size: '∅ 70 × 45 cm', styleTags: ['实木', '胡桃木', '圆几'], thumbnail: '🪵', color: CATEGORY_COLOR['茶几'] },
  { id: 'seed-5', category: '装饰画', name: '抽象肌理装饰画', source: '来自探家视频 · 本周三', size: '60 × 80 cm', styleTags: ['抽象', '肌理', '竖版'], thumbnail: '🖼️', color: CATEGORY_COLOR['装饰画'], sourceVideo: { blogger: '@墙面艺术', frameTime: '0:21' } },
  { id: 'seed-6', category: '地毯', name: '羊毛几何地毯', source: '来自装修视频 · 本周二', size: '200 × 140 cm', styleTags: ['羊毛', '几何', '暖灰'], thumbnail: '🟫', color: CATEGORY_COLOR['地毯'], sourceVideo: { blogger: '@软装搭配师', frameTime: '0:45' } },
  { id: 'seed-7', category: '沙发', name: '焦糖色皮艺单椅', source: '来自探家视频 · 本周一', size: '80 × 85 × 75 cm', styleTags: ['复古', '皮艺', '焦糖'], thumbnail: '🛋️', color: '#b86b3a', sourceVideo: { blogger: '@复古家居', frameTime: '0:17' } },
  { id: 'seed-8', category: '吊灯', name: '和纸竹编吊灯', source: '来自线下拍照 · 更早', size: '∅ 45 × 38 cm', styleTags: ['日式', '竹编', '和纸'], thumbnail: '💡', color: '#cbb88a' },
]

export const LIBRARY_SEED: LibraryComponent[] = RAW_SEED.map((c) => ({ ...c, sticker: genSticker(c.category, c.color) }))

const BLOGGER_HOME_NAMES: Record<FurnitureCategory, string> = {
  '沙发': '奶咖色模块沙发',
  '茶几': '洞石茶几',
  '吊灯': '纸膜气球灯',
  '绿植': '天堂鸟落地',
  '装饰画': '肌理浮雕画',
  '地毯': '剑麻几何地毯',
  '其他': '待分类家具',
}

export const BLOGGER_HOME_PACK: LibraryComponent[] = (
  [
    { category: '沙发', color: '#b8a08a' },
    { category: '茶几', color: '#cdb89a' },
    { category: '吊灯', color: '#d9c27a' },
    { category: '绿植', color: '#6b8e5a' },
    { category: '装饰画', color: '#8a9bbf' },
    { category: '地毯', color: '#c2a890' },
  ] as { category: FurnitureCategory; color: string }[]
).map((c, i) => ({
  id: `home-pack-${i}`,
  category: c.category,
  name: BLOGGER_HOME_NAMES[c.category],
  source: '来自博主同款小家',
  size: '博主实测尺寸',
  styleTags: ['博主同款', '奶油风'],
  thumbnail: MOCK_OBJECTS.find((m) => m.label === c.category)?.thumbnail ?? '🪑',
  color: c.color,
  sticker: genSticker(c.category, c.color, i + 10),
  sourceVideo: { blogger: '@家居灵感研究所', frameTime: `0:${10 + i * 6}` },
}))

export const CURRENT_BLOGGER: Blogger = {
  id: 'blogger-1',
  name: '家居灵感研究所',
  handle: 'home_vibes',
  avatarColor: '#b8a08a',
  bio: '分享治愈系居家灵感 · 奶油风软装',
  followers: '128.6w',
  likes: '982.1w',
  hasHome: true,
  homeLayoutId: '1b1l',
  homeName: '奶油风一居小家',
  homeDesc: '12 件软装 · 8㎡客厅',
}
