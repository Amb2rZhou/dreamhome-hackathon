import type { FurnitureCategory, LibraryComponent } from './types'

type SupplementalAsset = {
  id: string
  name: string
  category: FurnitureCategory
  videoId: string
  blogger: string
  frame: number
  model: string
  modelSet?: 'models' | 'models-v1'
  tags: string[]
}

const supplemental: SupplementalAsset[] = [
  { id: 'ast_665e55cee687', name: '原木色衣柜', category: '其他', videoId: 'vid_40734d7f2e6c', blogger: '@鸡蛋灌饼', frame: 0, model: 'c09fb8cb849e46b99085b51d5a1baa87', tags: ['柜子', '原木色', '圈选补生成'] },
  { id: 'ast_cf21f0f0a02c', name: '飘窗沙发', category: '沙发', videoId: 'vid_40734d7f2e6c', blogger: '@鸡蛋灌饼', frame: 2.6, model: '0ce5dfb3406241c8b790a2426fcbacc7', tags: ['沙发', '飘窗', '圈选补生成'] },
  { id: 'ast_6410374831cb', name: '小收纳柜', category: '其他', videoId: 'vid_40734d7f2e6c', blogger: '@鸡蛋灌饼', frame: 6.7, model: 'cb8f0bfd04684544a011c1bd521184ae', tags: ['柜子', '白色', '圈选补生成'] },
  { id: 'ast_87dc36b29526', name: '空调', category: '其他', videoId: 'vid_5f32a0ac954a', blogger: '@lila（求关注版）', frame: 5, model: 'f13554299f7643eb872e1a36fa4e462d', tags: ['家电', '挂机'] },
  { id: 'ast_339dc6e870de', name: '吊扇', category: '吊灯', videoId: 'vid_5f32a0ac954a', blogger: '@lila（求关注版）', frame: 6, model: 'e91ce9b7d8744192b417d119b280c536', tags: ['家电', '吊扇'] },
  { id: 'ast_c0274a819f34', name: '圆桌', category: '茶几', videoId: 'vid_5f32a0ac954a', blogger: '@lila（求关注版）', frame: 7.5, model: '8ee9151906624333a88a62ab954a4560', tags: ['桌子', '玻璃', '圆形'] },
  { id: 'ast_f7189ad0a9a2', name: '电视柜', category: '其他', videoId: 'vid_5f32a0ac954a', blogger: '@lila（求关注版）', frame: 6.5, model: 'd9dd02fc30de42a2b4ee55865e45279d', tags: ['柜子', '组合柜', '带电视'] },
  { id: 'ast_ec05acc016d9', name: '吊灯', category: '吊灯', videoId: 'vid_91fe552c5f7d', blogger: '@云上的小路', frame: 0, model: '6c6cbb1474d048419dfebd047cc66b7b', modelSet: 'models-v1', tags: ['灯具', '吊灯'] },
  { id: 'ast_febb8b909137', name: '边柜', category: '其他', videoId: 'vid_91fe552c5f7d', blogger: '@云上的小路', frame: 0, model: '411a1f771e0f480ea14cf41592cab811', modelSet: 'models-v1', tags: ['柜子', '边柜'] },
  { id: 'ast_c0274a819f34', name: '圆茶几', category: '茶几', videoId: 'vid_91fe552c5f7d', blogger: '@云上的小路', frame: 0, model: '8ee9151906624333a88a62ab954a4560', tags: ['桌子', '茶几'] },
  { id: 'ast_5229f072c636', name: '客厅地毯', category: '地毯', videoId: 'vid_91fe552c5f7d', blogger: '@云上的小路', frame: 0, model: 'c74b552a2bfd41e9b28e96127beda68f', tags: ['地毯', '客厅'] },
]

const frameLabel = (seconds: number) => {
  const minute = Math.floor(seconds / 60)
  const second = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${minute}:${second}`
}

export const SCENE_SUPPLEMENTAL_ASSETS: LibraryComponent[] = supplemental.map((asset) => {
  const image = `/prototype/assets/renders/${asset.id}.png`
  const frameTime = frameLabel(asset.frame)
  return {
    id: asset.id,
    category: asset.category,
    sourceCategory: asset.tags[0] ?? asset.category,
    name: asset.name,
    source: `${asset.blogger} · ${asset.videoId} · ${frameTime}`,
    sourceDescription: `${asset.tags.join('、')}；已进入该视频的完整 1:1 场景`,
    size: '按场景校准',
    styleTags: asset.tags,
    thumbnail: asset.category === '沙发' ? '🛋️' : asset.category === '地毯' ? '🟫' : asset.category === '吊灯' ? '💡' : '🪑',
    color: asset.category === '沙发' ? '#a97d66' : asset.category === '地毯' ? '#b79a72' : '#c59a43',
    sticker: image,
    completedImageUrl: image,
    sourceCropUrl: image,
    modelUrl: `/prototype/assets/demo-backend/${asset.modelSet ?? 'models'}/${asset.model}.glb`,
    sourceVideo: {
      blogger: asset.blogger,
      frameTime,
      frameImg: image,
      videoId: asset.videoId,
      startSec: Math.max(0, asset.frame - 1.5),
      endSec: asset.frame + 1.5,
      appearances: [{
        startSec: Math.max(0, asset.frame - 1.5),
        endSec: asset.frame + 1.5,
        representativeSec: asset.frame,
      }],
    },
  }
})
