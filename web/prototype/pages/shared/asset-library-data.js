const FAVORITES_KEY = 'dreamhome.asset-library.v1';
const CRAFTED_KEY = 'dreamhome.crafted-assets.v1';

export const COMPONENT_FAMILIES = [
  { id: 'floorplan', label: '户型类' },
  { id: 'floor', label: '地板类' },
  { id: 'wallpaper', label: '墙纸类' },
  { id: 'furniture', label: '家具类' },
];

export const FURNITURE_CATEGORIES = [
  { id: 'table', label: '桌几' },
  { id: 'seating', label: '座椅' },
  { id: 'sofa', label: '沙发' },
  { id: 'lighting', label: '灯具' },
  { id: 'decor', label: '装饰' },
  { id: 'bed', label: '床具' },
  { id: 'bedding', label: '床品' },
  { id: 'cabinet', label: '柜体' },
  { id: 'kitchen', label: '厨具' },
  { id: 'bathroom', label: '卫浴' },
  { id: 'storage', label: '收纳' },
];

const asset = (id, kind, name, options = {}) => ({ id, kind, name, source: 'platform', ...options });

export const COMPONENT_ASSETS = [
  asset('floorplan-one-one', 'floorplan', '一室一厅', { templateId: 'one-one', thumbnail: 'plan-one', supported: true }),
  asset('floorplan-two-one', 'floorplan', '两室一厅', { templateId: 'two-one', thumbnail: 'plan-two', supported: true }),
  asset('floorplan-three-two', 'floorplan', '三室两厅', { templateId: 'three-two', thumbnail: 'plan-three', supported: true }),
  asset('floorplan-courtyard', 'floorplan', '庭院平层', { templateId: 'courtyard', thumbnail: 'plan-courtyard', supported: false }),
  asset('floor-oak', 'floor', '原木浅橡', { finish: { color: '#cfae7f', accent: '#ad895b', pattern: 'grain' } }),
  asset('floor-terrazzo', 'floor', '暖白水磨石', { finish: { color: '#ded9cb', accent: '#a9afa5', pattern: 'speckle' } }),
  asset('floor-walnut', 'floor', '胡桃木拼花', { finish: { color: '#835d42', accent: '#b58764', pattern: 'parquet' } }),
  asset('floor-stone', 'floor', '雾灰岩板', { finish: { color: '#c5c5bc', accent: '#92978e', pattern: 'stone' } }),
  asset('wallpaper-linen', 'wallpaper', '亚麻暖白', { finish: { color: '#eee6d7', accent: '#d4c5ad', pattern: 'linen' } }),
  asset('wallpaper-sage', 'wallpaper', '苔藓绿植感', { finish: { color: '#bbcab4', accent: '#7f9677', pattern: 'leaf' } }),
  asset('wallpaper-grid', 'wallpaper', '米灰细格', { finish: { color: '#dfddd5', accent: '#aaa99f', pattern: 'grid' } }),
  asset('wallpaper-rust', 'wallpaper', '砖红手作纹', { finish: { color: '#c6846e', accent: '#9e5f4c', pattern: 'woven' } }),
  asset('table-round', 'furniture', '圆角餐桌', { category: 'table', primitive: 'table', color: '#c89261', accent: '#8d5a3a', dimensions: [1.4, .74, 1.4], sourceType: 'platform' }),
  asset('table-low', 'furniture', '云朵茶几', { category: 'table', primitive: 'table', color: '#d7c3a4', accent: '#9d8466', dimensions: [1.2, .42, .72], sourceType: 'platform' }),
  asset('chair-walnut', 'furniture', '胡桃餐椅', { category: 'seating', primitive: 'chair', color: '#7f5b44', accent: '#c8a682', dimensions: [.52, .95, .56], sourceType: 'platform' }),
  asset('chair-sage', 'furniture', '鼠尾草单椅', { category: 'seating', primitive: 'chair', color: '#8da38a', accent: '#d5e1d0', dimensions: [.78, .84, .76], sourceType: 'platform' }),
  asset('sofa-cloud', 'furniture', '云朵三人沙发', { category: 'sofa', primitive: 'sofa', color: '#e2ddd0', accent: '#af9f8e', dimensions: [2.16, .84, .92], sourceType: 'platform' }),
  asset('sofa-moss', 'furniture', '苔藓模块沙发', { category: 'sofa', primitive: 'sofa', color: '#789070', accent: '#c3d2bd', dimensions: [1.8, .78, .9], sourceType: 'platform' }),
  asset('lamp-reading', 'furniture', '阅读落地灯', { category: 'lighting', primitive: 'lamp', color: '#d5a25d', accent: '#fff2cf', dimensions: [.38, 1.6, .38], sourceType: 'platform' }),
  asset('lamp-orbit', 'furniture', '轨道吊灯', { category: 'lighting', primitive: 'lamp', color: '#556257', accent: '#ead6a0', dimensions: [.5, 1.3, .5], sourceType: 'platform' }),
  asset('plant-moss', 'furniture', '苔藓盆景', { category: 'decor', primitive: 'plant', color: '#637b59', accent: '#cfb58d', dimensions: [.5, .8, .5], sourceType: 'platform' }),
  asset('vase-clay', 'furniture', '陶土花器', { category: 'decor', primitive: 'plant', color: '#ba7358', accent: '#e1c19b', dimensions: [.36, .66, .36], sourceType: 'platform' }),
  asset('bed-linen', 'furniture', '亚麻双人床', { category: 'bed', primitive: 'bed', color: '#d7c7b4', accent: '#8c725c', dimensions: [1.8, .52, 2.05], sourceType: 'platform' }),
  asset('bed-oak', 'furniture', '浅橡单人床', { category: 'bed', primitive: 'bed', color: '#c69c72', accent: '#efe1cb', dimensions: [1.2, .5, 2], sourceType: 'platform' }),
  asset('bedding-sand', 'furniture', '砂岩床品', { category: 'bedding', primitive: 'bed', color: '#d8c3a6', accent: '#f2e9da', dimensions: [1.7, .28, 2], sourceType: 'platform' }),
  asset('cabinet-sage', 'furniture', '鼠尾草柜', { category: 'cabinet', primitive: 'cabinet', color: '#83967d', accent: '#d7e1d3', dimensions: [1.5, 1.45, .45], sourceType: 'platform' }),
  asset('cabinet-oak', 'furniture', '原木电视柜', { category: 'cabinet', primitive: 'cabinet', color: '#ba8f63', accent: '#e2c29a', dimensions: [1.8, .58, .42], sourceType: 'platform' }),
  asset('kitchen-island', 'furniture', '石材中岛', { category: 'kitchen', primitive: 'cabinet', color: '#bfc0b9', accent: '#7d817a', dimensions: [1.55, .92, .78], sourceType: 'platform' }),
  asset('kitchen-stool', 'furniture', '吧台高凳', { category: 'kitchen', primitive: 'chair', color: '#a56e4b', accent: '#e3c49c', dimensions: [.45, 1.02, .45], sourceType: 'platform' }),
  asset('bath-vanity', 'furniture', '悬浮浴室柜', { category: 'bathroom', primitive: 'cabinet', color: '#d9d6ce', accent: '#7e9081', dimensions: [1.1, .82, .46], sourceType: 'platform' }),
  asset('bath-stool', 'furniture', '浴室边凳', { category: 'bathroom', primitive: 'chair', color: '#9b8d78', accent: '#ede7dc', dimensions: [.48, .52, .34], sourceType: 'platform' }),
  asset('storage-ladder', 'furniture', '梯形收纳架', { category: 'storage', primitive: 'cabinet', color: '#b9a98e', accent: '#eee4d1', dimensions: [.78, 1.65, .36], sourceType: 'platform' }),
  asset('storage-basket', 'furniture', '藤编收纳篮', { category: 'storage', primitive: 'plant', color: '#b98c5c', accent: '#e6c99d', dimensions: [.54, .48, .54], sourceType: 'platform' }),
  ...FURNITURE_CATEGORIES.flatMap((category, categoryIndex) => Array.from({ length: 11 }, (_, itemIndex) => {
    const names = {
      table: ['方几', '边桌', '岩板餐桌', '长桌', '折叠桌', '矮圆几', '书桌', '实木桌', '岛台桌', '玻璃边几', '藤编小几'],
      seating: ['藤编椅', '弧形单椅', '软包餐椅', '低背椅', '靠窗椅', '皮质扶手椅', '折叠椅', '长凳', '阅读椅', '布艺椅', '圆墩'],
      sofa: ['弧形沙发', '奶油双人沙发', '皮质躺椅', '直排沙发', '木框沙发', '格纹双人沙发', '深绿沙发', '米白单椅', '围合沙发', '软垫长椅', '转角沙发'],
      lighting: ['纸灯笼吊灯', '玻璃壁灯', '蘑菇台灯', '黄铜吊灯', '线性灯', '贝壳壁灯', '小圆台灯', '方形落地灯', '布罩台灯', '极简吊灯', '烛台壁灯'],
      decor: ['木雕摆件', '抽象挂画', '枝形花器', '石材托盘', '香薰烛台', '陶瓷盘', '编织挂饰', '岩石书挡', '玻璃器皿', '画框组合', '干枝花器'],
      bed: ['藤编床', '软包大床', '原木矮床', '四柱床', '储物床', '格栅床', '儿童床', '圆角床', '皮质床', '榻榻米床', '靠窗单床'],
      bedding: ['条纹床品', '苔藓绿床品', '暖白被褥', '石灰灰床品', '碎花床品', '格纹毯', '针织盖毯', '麻棉枕套', '深蓝床品', '软垫床尾凳', '奶油床幔'],
      cabinet: ['格栅边柜', '藤编斗柜', '窄玄关柜', '玻璃书柜', '高脚边柜', '木质衣柜', '悬浮隔板', '低矮斗柜', '餐边柜', '转角柜', '滑门柜'],
      kitchen: ['木质餐边柜', '嵌入式烤箱柜', '不锈钢置物架', '石材水槽柜', '双门冰箱', '开放式层架', '早餐台', '胡桃高柜', '调味收纳架', '原木碗柜', '窄吧台'],
      bathroom: ['圆镜洗手台', '浴缸边几', '壁挂毛巾架', '石材洗手盆', '淋浴凳', '收纳镜柜', '磨砂置物架', '圆角浴缸', '竹质脏衣篮', '挂墙马桶', '香薰托盘'],
      storage: ['抽屉收纳柜', '墙面挂架', '藤编收纳筐', '移动边车', '储物长凳', '衣帽架', '透明抽屉盒', '壁挂置物盒', '模块收纳柜', '布艺收纳袋', '窄缝收纳架'],
    }[category.id];
    const primitives = ['table', 'chair', 'sofa', 'lamp', 'plant', 'bed', 'cabinet'];
    const palette = [
      ['#b98d61', '#e5c89f'], ['#839778', '#d7e2d1'], ['#85705d', '#d9c7ae'], ['#c78368', '#f0d0ae'], ['#75816f', '#e0e8da'], ['#9a7962', '#d7c0a1'],
    ];
    const [color, accent] = palette[(categoryIndex + itemIndex) % palette.length];
    return asset(`${category.id}-catalog-${itemIndex + 1}`, 'furniture', names[itemIndex], { category: category.id, primitive: primitives[(categoryIndex + itemIndex) % primitives.length], color, accent, dimensions: [1, .8, .6], sourceType: 'platform' });
  })),
];

export const ASSET_BY_ID = new Map(COMPONENT_ASSETS.map((item) => [item.id, item]));

function readCrafted() {
  try {
    const stored = JSON.parse(localStorage.getItem(CRAFTED_KEY) || '{}');
    return Array.isArray(stored.items) ? stored.items : [];
  } catch {
    return [];
  }
}

function writeCrafted(items) {
  localStorage.setItem(CRAFTED_KEY, JSON.stringify({ version: 1, items }));
}

function registerCrafted(item) {
  if (ASSET_BY_ID.has(item.id)) return;
  COMPONENT_ASSETS.unshift(item);
  ASSET_BY_ID.set(item.id, item);
}

export function getCraftedAssets() {
  return readCrafted();
}

export function addCraftedAsset(item) {
  const crafted = { kind: 'furniture', source: 'discover', sourceType: 'discover', isNew: true, createdAt: Date.now(), dimensions: [1, .8, .6], ...item };
  writeCrafted([crafted, ...readCrafted()]);
  registerCrafted(crafted);
  return crafted;
}

export function markCraftedSeen(id) {
  writeCrafted(readCrafted().map((item) => (item.id === id ? { ...item, isNew: false } : item)));
  const registered = ASSET_BY_ID.get(id);
  if (registered) registered.isNew = false;
}

// 模块加载即把已打造资产并入目录(倒序遍历保证最新的排最前)
readCrafted().slice().reverse().forEach(registerCrafted);

export function getAssets(kind, category) {
  return COMPONENT_ASSETS.filter((item) => item.kind === kind && (!category || item.category === category));
}

export function getAsset(id) {
  return ASSET_BY_ID.get(id) || null;
}

export function getFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}');
    const ids = Array.isArray(stored.ids) ? stored.ids : [];
    return new Set(ids.filter((id) => ASSET_BY_ID.has(id)));
  } catch {
    return new Set();
  }
}

export function setFavorites(ids) {
  const known = [...new Set(ids)].filter((id) => ASSET_BY_ID.has(id));
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
