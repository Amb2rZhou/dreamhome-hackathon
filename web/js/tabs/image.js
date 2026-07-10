// 图生3D：选文件 / 拖拽 / 粘贴 → 缩图 → TRELLIS → 组件库
import { downscale, fileToDataURL } from '../imgutil.js';
import { imageToComponent } from '../pipeline.js';
import { toast } from '../toast.js';
import { cachedGlbUrl } from '../glbcache.js';

let cleanups = [];
let dragDepth = 0;
let currentUri = null;

function on(target, ev, fn, opts) {
  target.addEventListener(ev, fn, opts);
  cleanups.push(() => target.removeEventListener(ev, fn, opts));
}

export async function mount(view) {
  view.innerHTML = `
    <div class="view-pad stack">
      <div>
        <div class="section-title">🖼️ 图生 3D · 从任意图片摘抄家具</div>
        <div class="hint">刷到好看的家具，截图扔进来，AI 会把它变成真实的 3D 组件。</div>
      </div>

      <div class="dropzone" id="dz">
        <div class="dz-ico">📥</div>
        <div class="dz-title">把图片扔进来</div>
        <div class="dz-sub">点击选文件 · 拖拽 · 粘贴（⌘/Ctrl + V）</div>
      </div>
      <input type="file" id="file" accept="image/*" hidden>

      <div id="stage" hidden class="stack">
        <img id="preview" class="preview-img" alt="待摘抄">
        <input id="name" class="name-input" placeholder="给它起个名，如：绿色天鹅绒沙发">
        <div class="btn-row">
          <button class="btn" id="gen">生成 3D 组件</button>
          <button class="btn subtle" id="reset">换一张</button>
        </div>
      </div>

      <div id="result" hidden class="stack">
        <div class="section-title">✓ 已生成</div>
        <div class="inline-mv" id="mvwrap"></div>
        <div class="btn-row">
          <button class="btn ghost" id="toLib">在组件库查看</button>
          <button class="btn subtle" id="again">再摘一件</button>
        </div>
      </div>
    </div>`;

  // 名称输入框样式（复用 card 观感，避免额外 CSS 文件）
  const nameEl = view.querySelector('#name');
  nameEl.style.cssText = 'width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--paper-2);font:inherit;color:var(--ink);';

  const dz = view.querySelector('#dz');
  const file = view.querySelector('#file');
  const stage = view.querySelector('#stage');
  const preview = view.querySelector('#preview');
  const result = view.querySelector('#result');

  const showStage = (uri) => {
    currentUri = uri;
    preview.src = uri;
    stage.hidden = false;
    result.hidden = true;
    dz.hidden = true;
  };
  const resetAll = () => {
    currentUri = null; file.value = '';
    stage.hidden = true; result.hidden = true; dz.hidden = false;
    nameEl.value = '';
  };

  async function accept(fileObj) {
    if (!fileObj || !fileObj.type.startsWith('image/')) { toast('请提供图片文件', 'err'); return; }
    try {
      const raw = await fileToDataURL(fileObj);
      const uri = await downscale(raw, 1280, 0.92);
      showStage(uri);
    } catch (e) { toast('读取图片失败：' + (e.message || e), 'err'); }
  }

  // 选文件
  on(dz, 'click', () => file.click());
  on(file, 'change', () => { if (file.files[0]) accept(file.files[0]); });

  // 生成
  on(view.querySelector('#gen'), 'click', async () => {
    if (!currentUri) return;
    const btn = view.querySelector('#gen'); btn.disabled = true;
    try {
      const rec = await imageToComponent(currentUri, { name: nameEl.value });
      await showResult(view, rec.glb);
    } catch (e) { /* pipeline 已 toast */ }
    finally { btn.disabled = false; }
  });
  on(view.querySelector('#reset'), 'click', resetAll);
  on(view.querySelector('#again'), 'click', resetAll);
  on(view.querySelector('#toLib'), 'click', () => {
    document.querySelector('.tab[data-tab="library"]').click();
  });

  // ── document 级拖拽（坑：拖拽必须绑 document，否则浏览器默认行为吃掉文件）──
  const onDragEnter = (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onDragLeave = (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); };
  const onDrop = (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) accept(f); else toast('没读到图片，换一张试试', 'err');
  };
  on(document, 'dragenter', onDragEnter);
  on(document, 'dragover', onDragOver);
  on(document, 'dragleave', onDragLeave);
  on(document, 'drop', onDrop);

  // ── 粘贴 ──
  on(document, 'paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { accept(it.getAsFile()); e.preventDefault(); return; }
    }
  });
}

async function showResult(view, glbUrl) {
  const result = view.querySelector('#result');
  const wrap = view.querySelector('#mvwrap');
  const stage = view.querySelector('#stage');
  const src = await cachedGlbUrl(glbUrl);
  wrap.innerHTML = `<model-viewer src="${src}" camera-controls auto-rotate touch-action="pan-y"
      loading="eager" shadow-intensity="1" exposure="1" ar ar-modes="webxr scene-viewer quick-look"
      environment-image="neutral"></model-viewer>`;
  stage.hidden = true;
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function unmount() {
  cleanups.forEach(fn => fn()); cleanups = [];
  document.body.classList.remove('dragging'); dragDepth = 0; currentUri = null;
}
