// 全局配置、fal key 注入/抹除、演示数据重置
export const STORE = {
  key: 'dh_fal_key',
  library: 'dh_library',
  room: 'dh_room',
};

export const GLB_CACHE = 'dh-glb-v1';

export const FAL = {
  base: 'https://queue.fal.run',
  trellis: 'fal-ai/trellis',
  fluxI2I: 'fal-ai/flux/dev/image-to-image',
  fluxCanny: 'fal-ai/flux-control-lora-canny',
};

// ── fal key ────────────────────────────────────────────────
// 首次通过 URL `#key=xxx` 注入 localStorage，随后从地址栏抹掉，避免泄露/被分享。
export function ingestKeyFromUrl() {
  try {
    const h = location.hash || '';
    const m = h.match(/(?:^|[#&])key=([^&]+)/);
    if (m && m[1]) {
      localStorage.setItem(STORE.key, decodeURIComponent(m[1]).trim());
      // 抹掉地址栏里的 key（保留其余 hash 片段）
      const rest = h.replace(/(?:^|[#&])key=[^&]+/, '').replace(/^#?&?/, '');
      const url = location.pathname + location.search + (rest ? '#' + rest : '');
      history.replaceState(null, '', url);
    }
  } catch (e) { /* 隐私模式等，忽略 */ }
}

export function getKey() {
  try { return localStorage.getItem(STORE.key) || ''; } catch (e) { return ''; }
}
export function hasKey() { return !!getKey(); }

// ── 演示数据重置 ────────────────────────────────────────────
// ?reset=1  清演示数据（保留 key）
// ?reset=all 全清（含 key + GLB 缓存）
export async function handleReset() {
  const p = new URLSearchParams(location.search);
  const mode = p.get('reset');
  if (!mode) return false;
  try {
    if (mode === 'all') {
      localStorage.clear();
      if (window.caches) { try { await caches.delete(GLB_CACHE); } catch (e) {} }
    } else {
      localStorage.removeItem(STORE.library);
      localStorage.removeItem(STORE.room);
    }
  } catch (e) {}
  // 去掉 reset 参数，避免刷新反复清
  p.delete('reset');
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  return true;
}

// 品类先验：从名字/文本猜家具类型（用于 3D 归一化尺寸 & 语音匹配）
export function guessKind(text) {
  const t = (text || '').toLowerCase();
  const map = [
    ['sofa', ['沙发', 'sofa', 'couch']],
    ['bed', ['床', 'bed']],
    ['cabinet', ['柜', 'cabinet', 'wardrobe', 'shelf', '书架', '架']],
    ['table', ['桌', 'table', 'desk']],
    ['chair', ['椅', 'chair', 'armchair', '扶手椅']],
    ['stool', ['凳', 'stool']],
    ['lamp', ['灯', 'lamp', 'light']],
    ['plant', ['植物', '盆栽', '绿植', 'plant', '多肉']],
  ];
  for (const [kind, kws] of map) if (kws.some(k => t.includes(k))) return kind;
  return 'default';
}
