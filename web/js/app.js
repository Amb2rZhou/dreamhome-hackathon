// 应用入口：key 注入/reset、预热、Service Worker、底部 tab 路由
import { ingestKeyFromUrl, handleReset, hasKey } from './config.js';
import { prewarm } from './fal.js';
import { toast } from './toast.js';

const TABS = {
  image:   () => import('./tabs/image.js'),
  photo:   () => import('./tabs/photo.js'),
  sketch:  () => import('./tabs/sketch.js'),
  library: () => import('./tabs/library.js'),
  room:    () => import('./tabs/room.js'),
};

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = null;      // 当前 tab 模块实例
let currentId = null;

async function switchTab(id) {
  if (id === currentId) return;
  if (!TABS[id]) id = 'image';
  try { current && current.unmount && current.unmount(); } catch (e) {}
  view.innerHTML = '';
  currentId = id;
  [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  history.replaceState(null, '', '#' + id);
  try {
    const mod = await TABS[id]();
    current = mod;
    await mod.mount(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">该页面加载失败：${(e && e.message) || e}</div>`;
  }
}

function updateKeyState() {
  const el = document.getElementById('keyState');
  if (!el) return;
  if (hasKey()) { el.className = 'key-state ok'; el.textContent = 'fal 已连接'; }
  else { el.className = 'key-state off'; el.textContent = '未注入 key'; }
}

async function init() {
  ingestKeyFromUrl();
  const didReset = await handleReset();
  updateKeyState();
  if (didReset) toast('已重置演示数据', 'ok');

  // tab 交互
  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  // 启动 tab：来自 hash（key 已抹除后剩下的），否则默认 image
  const start = (location.hash || '').replace('#', '');
  await switchTab(TABS[start] ? start : 'image');

  // 静默预热 TRELLIS（有 key 才发）
  prewarm();

  // Service Worker：离线可演（网络优先，离线回退缓存）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
