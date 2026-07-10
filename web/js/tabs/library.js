// 组件库：网格卡片 → 点开全屏 model-viewer 预览（带 AR）→ 可删除
import { list, remove } from '../library.js';
import { cachedGlbUrl } from '../glbcache.js';
import { toast } from '../toast.js';

let cleanups = [];
let overlay = null;

export async function mount(view) {
  render(view);
  const onChange = () => render(view);
  window.addEventListener('library:changed', onChange);
  cleanups.push(() => window.removeEventListener('library:changed', onChange));
}

function render(view) {
  const items = list();
  if (!items.length) {
    view.innerHTML = `
      <div class="view-pad">
        <div class="section-title">📦 组件库</div>
        <div class="empty">
          还没有摘抄任何家具。<br>去「图生3D / 拍照 / 画画」摘一件回来吧。
        </div>
      </div>`;
    return;
  }
  view.innerHTML = `
    <div class="view-pad">
      <div class="section-title">📦 组件库 · ${items.length} 件</div>
      <div class="lib-grid">
        ${items.map(it => `
          <div class="lib-card" data-id="${it.id}">
            <img class="lib-thumb" loading="lazy" src="${it.img || ''}" alt="${escapeHtml(it.name)}">
            <div class="lib-meta">
              <div class="lib-name">${escapeHtml(it.name)}</div>
              <div class="lib-kind">${it.kind}${it.preset ? ' · 预置' : ''}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  view.querySelectorAll('.lib-card').forEach(card => {
    card.addEventListener('click', () => openViewer(card.dataset.id));
  });
}

async function openViewer(id) {
  const item = list().find(x => x.id === id);
  if (!item) return;
  closeViewer();
  overlay = document.createElement('div');
  overlay.className = 'mv-overlay';
  overlay.innerHTML = `
    <div class="mv-bar">
      <div class="mv-title">${escapeHtml(item.name)}</div>
      <button class="icon-btn" id="mvClose" aria-label="关闭">✕</button>
    </div>
    <model-viewer id="mv" camera-controls auto-rotate touch-action="pan-y" loading="eager"
      shadow-intensity="1" exposure="1" environment-image="neutral"
      ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed"></model-viewer>
    <div class="mv-actions">
      <button class="btn ghost" id="mvAr">在 AR 中查看</button>
      <button class="btn subtle" id="mvDel" style="flex:0 0 auto;color:var(--err);border-color:transparent">删除</button>
    </div>`;
  document.body.appendChild(overlay);

  const mv = overlay.querySelector('#mv');
  mv.src = await cachedGlbUrl(item.glb);

  overlay.querySelector('#mvClose').onclick = closeViewer;
  overlay.querySelector('#mvAr').onclick = () => {
    if (mv.canActivateAR) mv.activateAR();
    else toast('当前设备/浏览器不支持 AR', '', 2200);
  };
  overlay.querySelector('#mvDel').onclick = () => {
    remove(id);
    closeViewer();
    toast('已删除', 'ok');
  };
}

function closeViewer() {
  if (overlay) { overlay.remove(); overlay = null; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function unmount() {
  cleanups.forEach(fn => fn()); cleanups = [];
  closeViewer();
}
