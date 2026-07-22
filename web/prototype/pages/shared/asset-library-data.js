import { BACKEND_ASSETS } from './library-assets.generated.js';

const FAVORITES_KEY = 'dreamhome.asset-library.v1';
const USER_ASSETS_KEY = 'dreamhome.user-assets.v1';

export const COMPONENT_FAMILIES = [
  { id: 'floorplan', label: '户型类' },
  { id: 'floor', label: '地板类' },
  { id: 'wallpaper', label: '墙纸类' },
  { id: 'furniture', label: '家具类' },
];

// 家具子类＝后端真实分类（type.category，中文），按数量降序，零映射。
export const FURNITURE_CATEGORIES = (() => {
  const counts = new Map();
  for (const rec of BACKEND_ASSETS) counts.set(rec.type.category, (counts.get(rec.type.category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id, label: id }));
})();

// 真实分类 → CSS/3D 占位 primitive（真实卡片用照片；primitive 仅用于 3D 占位几何与「我的家」抽屉剪影）
export const CATEGORY_PRIMITIVE = {
  灯具: 'lamp', 柜子: 'cabinet', 绿植: 'plant', 桌子: 'table', 单椅: 'chair',
  装饰: 'plant', 地毯: 'cabinet', 沙发: 'sofa', 家电: 'cabinet', 床: 'bed', 卫浴: 'cabinet',
};
// size_missing（162/169 件无真实米制尺寸）时的每类兜底尺寸 [宽,高,深]（米）
export const CATEGORY_DIMENSIONS = {
  灯具: [.4, 1.4, .4], 柜子: [1.0, 1.2, .45], 绿植: [.4, .7, .4], 桌子: [1.2, .75, .7], 单椅: [.55, .9, .55],
  装饰: [.3, .4, .3], 地毯: [1.6, .02, 2.2], 沙发: [1.9, .82, .9], 家电: [.6, 1.0, .6], 床: [1.6, .5, 2.0], 卫浴: [.6, .8, .5],
};
// 常见中文色名 → hex（供 3D 占位着色；缺省暖木色）
const COLOR_HEX = {
  白色: '#e7e0d3', 米白色: '#e9e0cb', 米白: '#e9e0cb', 米色: '#ddceb0',
  棕色: '#8d5a3a', 深棕色: '#6b4632', 深褐色: '#5f4230', 黑色: '#3b3833',
  灰色: '#9a978e', 浅灰色: '#c3c1b8', 浅灰: '#c3c1b8', 银色: '#b9bcc0',
  绿色: '#7f9677', 浅绿色: '#b3c9a8', 蓝色: '#7f95ad', 浅蓝: '#a9bcca',
  红色: '#b5654e', 黄色: '#d8b25a', 金色: '#c7a24a', 橙色: '#c98a4a',
  粉色: '#d8a9a4', 透明: '#d8d4cc', 彩色: '#c0a06a', 浅木色: '#cbb089', 原木色: '#cbb089',
};
const DEFAULT_OBJECT_COLOR = '#b98d61';
const lightenHex = (hex, amount = .3) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('');
};
const colorForAsset = (rec) => {
  for (const c of rec.labels?.colors ?? []) if (COLOR_HEX[c]) return COLOR_HEX[c];
  return DEFAULT_OBJECT_COLOR;
};

// 后端记录 → 前端资产（适配层；将来接 API 只需把 import 换成 fetch、复用此函数）
export const adaptBackendAsset = (rec) => {
  const category = rec.type.category;
  const sourceType = rec.source_type || (rec.video_id ? 'video' : 'platform');
  const sourceLabel = rec.source_label || (sourceType === 'offline_photo' ? '线下拍照生成' : '平台组件');
  const known = rec.size_status === 'known' && rec.physical_size_m?.width != null;
  const color = colorForAsset(rec);
  const dims = known
    ? [rec.physical_size_m.width, rec.physical_size_m.height, rec.physical_size_m.depth]
    : (CATEGORY_DIMENSIONS[category] || [1, .8, .6]);
  return {
    id: rec.asset_id, kind: 'furniture', name: rec.name, source: 'platform', sourceType, sourceLabel,
    category, subcategory: rec.type.subcategory, primitive: CATEGORY_PRIMITIVE[category] || 'cabinet',
    color, accent: lightenHex(color, .3),
    dimensions: dims,
    // 「我的家」房间放置：真实 GLB 走 rawModel 归一化到 sizePrior（真实米制或分类兜底尺寸），避免原始网格尺度失真
    rawModel: !!(rec.model_url), sizePrior: { w: dims[0], h: dims[1], d: dims[2] }, mount: 'floor',
    sizeStatus: rec.size_status, thumbnail: rec.thumbnail, videoId: rec.video_id,
    modelUrl: rec.model_url || null, frameUrl: rec.frame_url || null,
    videoUrl: rec.video_url || null, videoSec: rec.representative_sec ?? null,
    colors: rec.labels?.colors ?? [], materials: rec.labels?.materials ?? [], styles: rec.labels?.styles ?? [],
  };
};

const asset = (id, kind, name, options = {}) => ({ id, kind, name, source: 'platform', ...options });

export const COMPONENT_ASSETS = [
  // 户型类：改用 Amber 的单间户型模板（横厅/窄长/方形/L形客厅、飘窗/转角卧室），生成即进入拟真单间 + 全套新编辑器。
  asset('floorplan-wide-living', 'floorplan', '横厅客厅', { templateId: 'wide-living', supported: true, previewImage: '../../assets/scenes/templates/wide-living.png?v=3' }),
  asset('floorplan-long-living', 'floorplan', '窄长客厅', { templateId: 'long-living', supported: true, previewImage: '../../assets/scenes/templates/long-living.png?v=2' }),
  asset('floorplan-square-lounge', 'floorplan', '方形会客厅', { templateId: 'square-lounge', supported: true, previewImage: '../../assets/scenes/templates/square-lounge.png?v=2' }),
  asset('floorplan-l-living', 'floorplan', 'L形客厅', { templateId: 'l-living', supported: true, previewImage: '../../assets/scenes/templates/l-living.png?v=2' }),
  asset('floorplan-bay-bedroom', 'floorplan', '飘窗卧室', { templateId: 'bay-bedroom', supported: true, previewImage: '../../assets/scenes/templates/bay-bedroom.png?v=2' }),
  asset('floorplan-corner-bedroom', 'floorplan', '转角卧室', { templateId: 'corner-bedroom', supported: true, previewImage: '../../assets/scenes/templates/corner-bedroom.png?v=2' }),
  asset('floor-oak', 'floor', '原木浅橡', { finish: { color: '#cfae7f', accent: '#ad895b', pattern: 'grain' } }),
  asset('floor-terrazzo', 'floor', '暖白水磨石', { finish: { color: '#ded9cb', accent: '#a9afa5', pattern: 'speckle' } }),
  asset('floor-walnut', 'floor', '胡桃木拼花', { finish: { color: '#835d42', accent: '#b58764', pattern: 'parquet' } }),
  asset('floor-stone', 'floor', '雾灰岩板', { finish: { color: '#c5c5bc', accent: '#92978e', pattern: 'stone' } }),
  asset('wallpaper-linen', 'wallpaper', '亚麻暖白', { finish: { color: '#eee6d7', accent: '#d4c5ad', pattern: 'linen' } }),
  asset('wallpaper-sage', 'wallpaper', '苔藓绿植感', { finish: { color: '#bbcab4', accent: '#7f9677', pattern: 'leaf' } }),
  asset('wallpaper-grid', 'wallpaper', '米灰细格', { finish: { color: '#dfddd5', accent: '#aaa99f', pattern: 'grid' } }),
  asset('wallpaper-rust', 'wallpaper', '砖红手作纹', { finish: { color: '#c6846e', accent: '#9e5f4c', pattern: 'woven' } }),
  // 家具类：来自后端真实资产数据集（169 件：149 件视频资产 + 20 件线下拍照资产），经 adaptBackendAsset 适配。
  ...BACKEND_ASSETS.map(adaptBackendAsset),
];

export const ASSET_BY_ID = new Map(COMPONENT_ASSETS.map((item) => [item.id, item]));

// User-generated assets（画一笔 / 拍一张 产出），独立存储、与预置资产合并查询。
export function getUserAssets() {
  try {
    const stored = JSON.parse(localStorage.getItem(USER_ASSETS_KEY) || '{}');
    const assets = Array.isArray(stored.assets) ? stored.assets : [];
    return assets.filter((item) => item && typeof item.id === 'string');
  } catch {
    return [];
  }
}

function setUserAssets(assets) {
  const seen = new Set();
  const known = assets.filter((item) => item && typeof item.id === 'string' && !seen.has(item.id) && seen.add(item.id));
  localStorage.setItem(USER_ASSETS_KEY, JSON.stringify({ version: 1, assets: known }));
  return known;
}

// 灵感库是平台与用户共建的资产库：用户自生成的组件对本人「自动收藏」，
// 对其他用户则以 visibility:'public' 进入公共库，可见、可收藏（小程序侧由后端可见性字段承载）。
export function addUserAsset(nextAsset) {
  const record = { source: 'user', kind: 'furniture', visibility: 'public', ...nextAsset };
  const assets = getUserAssets().filter((item) => item.id !== record.id);
  assets.push(record);
  setUserAssets(assets);
  // 创作者视角：新组件默认已收藏（首次入库时加入，后续更新不重复补收藏）
  autoCollectOwn(record.id);
  return record;
}

// 首次生成的用户组件自动收藏；已在收藏或曾被本人取消过则不强行加入。
function autoCollectOwn(id) {
  const seededKey = USER_ASSETS_KEY + '.autocollected';
  let seeded;
  try { seeded = new Set(JSON.parse(localStorage.getItem(seededKey) || '[]')); } catch { seeded = new Set(); }
  if (seeded.has(id)) return;
  seeded.add(id);
  localStorage.setItem(seededKey, JSON.stringify([...seeded]));
  const favorites = getFavorites();
  if (!favorites.has(id)) { favorites.add(id); setFavorites(favorites); }
}

export function removeUserAsset(id) {
  setUserAssets(getUserAssets().filter((item) => item.id !== id));
}

function userAssetById(id) {
  return getUserAssets().find((item) => item.id === id) || null;
}

export function getAssets(kind, category) {
  const combined = COMPONENT_ASSETS.concat(getUserAssets());
  return combined.filter((item) => item.kind === kind && (!category || item.category === category));
}

export function getAsset(id) {
  return ASSET_BY_ID.get(id) || userAssetById(id);
}

export function getFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}');
    const ids = Array.isArray(stored.ids) ? stored.ids : [];
    const userIds = new Set(getUserAssets().map((item) => item.id));
    return new Set(ids.filter((id) => ASSET_BY_ID.has(id) || userIds.has(id)));
  } catch {
    return new Set();
  }
}

export function setFavorites(ids) {
  const userIds = new Set(getUserAssets().map((item) => item.id));
  const known = [...new Set(ids)].filter((id) => ASSET_BY_ID.has(id) || userIds.has(id));
  localStorage.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, ids: known }));
  return new Set(known);
}

export function toggleFavorite(id) {
  const favorites = getFavorites();
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  return setFavorites(favorites);
}

export function isSupportedFloorplan(asset) {
  return asset?.kind === 'floorplan' && asset.supported === true;
}
